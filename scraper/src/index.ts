import cron from "node-cron";
import {
  TEAM_LEVELS,
  TEAM_LEVEL_SET,
  TEAM_NAME_HINT,
  TeamLevel,
  currentSeasonSlug,
  previousSeasonSlug,
  rosterUrl,
  scheduleUrl,
  statsUrl,
  seasonSlugs,
} from "./config.js";
import { teamHomeUrl } from "./config.js";
import { fetchHtml } from "./http.js";
import { DiscoveredSeason, pageUrlFor, parseSeasonPicker } from "./parse/seasons.js";
import type { ParseSource } from "./parse/nextdata.js";
import { parseSchedulePage } from "./parse/schedule.js";
import { parseRosterPage } from "./parse/roster.js";
import { parseStatsPage } from "./parse/stats.js";
import { parseBoxScorePage } from "./parse/boxscore.js";
import {
  gameNeedsBoxScore,
  pool,
  saveBoxScore,
  saveSeasonStats,
  upsertGame,
  pruneSeason,
  upsertRosterEntry,
  upsertSeason,
} from "./db.js";

const BACKFILL = process.argv.includes("--backfill");
const SKIP_BOX_SCORES = process.argv.includes("--no-box-scores");
// Reconcile instead of merely upserting: after a season scrapes cleanly,
// delete its rows that this run did not see. Use it to repair a season that
// imported badly — plain re-runs can correct a row but never remove one.
const PRUNE = process.argv.includes("--prune");

function seasonLabel(slug: string): string {
  return `Fall 20${slug.split("-")[0]}`;
}

/**
 * The DOM layer infers opponent, venue and score from row text. It is a
 * guess, and when the markup drifts it does not fail — it quietly produces
 * plausible-looking wrong rows. Say so, every time, so a bad import is
 * visible in the log instead of only in the dashboard.
 */
function warnIfGuessing(what: string, source: ParseSource): void {
  if (source !== "dom") return;
  console.warn(
    `[scrape]   WARNING: ${what} came from the DOM fallback — every embedded-JSON layer missed, ` +
      `so these rows are inferred from markup and may be wrong. Run \`npm run verify\`.`
  );
}

/** A season+level to scrape, with the exact URLs for its three pages. */
interface ScrapeTarget {
  level: string;
  seasonSlug: string;
  schedule: string;
  roster: string;
  stats: string;
}

/** null for a level this build doesn't know — see planRun, which warns. */
function targetFromDiscovery(s: DiscoveredSeason): ScrapeTarget | null {
  // An unrecognized level would be stored in a column the dashboard filters
  // on, so it would import and then be invisible. Skip it loudly instead.
  if (!TEAM_LEVEL_SET.has(s.level)) return null;
  return {
    level: s.level,
    seasonSlug: s.seasonSlug,
    schedule: pageUrlFor(s, "schedule"),
    roster: pageUrlFor(s, "roster"),
    stats: pageUrlFor(s, "stats"),
  };
}

function targetFromConfig(level: TeamLevel, seasonSlug: string): ScrapeTarget {
  return {
    level,
    seasonSlug,
    schedule: scheduleUrl(level, seasonSlug),
    roster: rosterUrl(level, seasonSlug),
    stats: statsUrl(level, seasonSlug),
  };
}

async function scrapeSeason(target: ScrapeTarget): Promise<void> {
  const { level, seasonSlug } = target;
  const schedUrl = target.schedule;
  const schedHtml = await fetchHtml(schedUrl);
  if (!schedHtml) {
    console.log(
      `[scrape] ${level} ${seasonSlug}: no schedule page at ${schedUrl} (season/level likely doesn't exist), skipping`
    );
    return;
  }

  const { games, source } = parseSchedulePage(schedHtml, seasonSlug);
  if (games.length === 0) {
    console.log(
      `[scrape] ${level} ${seasonSlug}: 0 games parsed — run \`npm run verify\` against this page to re-aim the parser`
    );
    return;
  }
  console.log(`[scrape] ${level} ${seasonSlug}: ${games.length} games via ${source} (${schedUrl})`);
  warnIfGuessing(`${level} ${seasonSlug} schedule`, source);
  const withTimes = games.filter((g) => g.timeText !== null).length;
  if (withTimes === 0) {
    console.warn(
      `[scrape]   WARNING: no kickoff times on any of the ${games.length} games — the page's time field has moved; run \`npm run verify\``
    );
  }

  const seasonId = await upsertSeason(seasonSlug, seasonLabel(seasonSlug), level);

  const keptGameUrls: string[] = [];
  let gameErrors = 0;
  for (const g of games) {
    // One unusable game must not take the season down with it — the rest of
    // the schedule, plus the roster and stats below, still need to be scraped.
    try {
      const gameId = await upsertGame(seasonId, seasonSlug, g);
      keptGameUrls.push(g.matchUrl);
      if (!SKIP_BOX_SCORES && !g.matchUrl.startsWith("synthetic:") && (await gameNeedsBoxScore(gameId))) {
        const boxHtml = await fetchHtml(g.matchUrl);
        if (boxHtml) {
          const box = parseBoxScorePage(boxHtml, TEAM_NAME_HINT);
          if (box.lines.length > 0) {
            await saveBoxScore(gameId, box.lines);
            console.log(`[scrape]   box score: ${g.opponent} (${box.lines.length} players, via ${box.source})`);
          }
        }
      }
    } catch (err) {
      gameErrors++;
      console.error(
        `[scrape]   skipping game ${g.isoDate} vs ${g.opponent} (${g.matchUrl}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Roster
  const keptPlayerSeasonIds: number[] = [];
  let rosterOk = false;
  let statsOk = false;
  const rosterUrlForSeason = target.roster;
  const rosterHtml = await fetchHtml(rosterUrlForSeason);
  if (!rosterHtml) {
    console.warn(`[scrape] ${level} ${seasonSlug}: roster page unreachable (${rosterUrlForSeason})`);
  } else {
    // Isolated: a roster failure must not cost this season its stats too.
    try {
      const roster = parseRosterPage(rosterHtml);
      for (const entry of roster.entries) {
        keptPlayerSeasonIds.push(await upsertRosterEntry(seasonId, entry));
      }
      const expected = roster.expectedCount;
      console.log(
        `[scrape] ${level} ${seasonSlug}: ${roster.entries.length} roster entries via ${roster.source}` +
          (expected !== null ? ` (page reports ${expected} athletes)` : "")
      );
      // Distinguish the two ways a roster comes back empty. Only one is a bug.
      if (expected === 0) {
        console.log(
          `[scrape]   note: MaxPreps lists no athletes for this team yet — nothing to import, not a parser failure`
        );
      } else if (roster.entries.length === 0) {
        console.error(
          `[scrape]   ERROR: roster page fetched but 0 players parsed (${rosterUrlForSeason})` +
            (expected !== null ? ` while the page reports ${expected} athletes` : "") +
            ` — the parser needs re-aiming; run \`npm run inspect\` on this page`
        );
      } else if (expected !== null && roster.entries.length !== expected) {
        console.warn(
          `[scrape]   WARNING: parsed ${roster.entries.length} players but the page reports ${expected}`
        );
      }
      warnIfGuessing(`${level} ${seasonSlug} roster`, roster.source);
      // Only a roster we actually believe may drive a prune. Parsing zero
      // players off a page that claims some is a failure, not an empty squad.
      rosterOk = !(roster.entries.length === 0 && expected !== 0);
    } catch (err) {
      console.error(
        `[scrape] ${level} ${seasonSlug}: roster failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Season aggregate stats
  const statsHtml = await fetchHtml(target.stats);
  if (statsHtml) {
    try {
      const stats = parseStatsPage(statsHtml);
      if (stats.lines.length > 0) {
        keptPlayerSeasonIds.push(...(await saveSeasonStats(seasonId, stats.lines)));
      }
      if (stats.unmappedHeaders.length > 0) {
        console.log(`[scrape]   unmapped stat columns (add to STAT_COLUMN_MAP?): ${stats.unmappedHeaders.join(", ")}`);
      }
      console.log(`[scrape] ${level} ${seasonSlug}: ${stats.lines.length} stat lines via ${stats.source}`);
      warnIfGuessing(`${level} ${seasonSlug} stats`, stats.source);
      statsOk = true;
    } catch (err) {
      console.error(
        `[scrape] ${level} ${seasonSlug}: stats failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (PRUNE) {
    // Prune only what this run fully accounted for. A partial pass is a
    // scraper failure, not evidence that the missing rows should go.
    if (gameErrors > 0) {
      console.warn(`[scrape]   skipping game prune: ${gameErrors} game(s) errored this run`);
    }
    // Stats creates roster rows too (for players who appear only there), so
    // its ids are part of the kept set — pruning without them would delete
    // every stats-only player.
    if (!rosterOk || !statsOk) {
      console.warn(
        `[scrape]   skipping roster prune: ${!rosterOk ? "the roster" : "the stats page"} did not scrape cleanly`
      );
    }
    const removed = await pruneSeason(
      seasonId,
      gameErrors > 0 ? null : keptGameUrls,
      rosterOk && statsOk ? keptPlayerSeasonIds : null
    );
    if (removed.games || removed.rosterEntries || removed.players) {
      console.log(
        `[scrape] ${level} ${seasonSlug}: pruned ${removed.games} stale game(s), ` +
          `${removed.rosterEntries} roster row(s), ${removed.players} orphan player(s)`
      );
    }
  }
}

/**
 * What to scrape this run. Preferred source is the site's own season picker,
 * which states every level and year that actually exists (and their URLs);
 * the generated slug list is only the fallback for when that page can't be
 * read. Either way it is resolved per run, never at import — this process
 * outlives the July 1 rollover.
 */
async function planRun(): Promise<ScrapeTarget[]> {
  const current = currentSeasonSlug();
  const wanted = new Set([current, previousSeasonSlug()]);

  const homeHtml = await fetchHtml(teamHomeUrl());
  const discovered = homeHtml ? parseSeasonPicker(homeHtml) : [];

  if (discovered.length > 0) {
    const usable = discovered.filter((s) => s.isPublished);
    const chosen = BACKFILL ? usable : usable.filter((s) => wanted.has(s.seasonSlug));
    const levels = [...new Set(usable.map((s) => s.level))].sort();
    console.log(
      `[run] discovered ${usable.length} published season/level combos from the site's season picker ` +
        `(levels: ${levels.join(", ")}); scraping ${chosen.length}`
    );
    const unknown = [...new Set(chosen.map((s) => s.level))].filter((l) => !TEAM_LEVEL_SET.has(l));
    if (unknown.length > 0) {
      console.warn(
        `[run] skipping unrecognized team level(s): ${unknown.join(", ")} — ` +
          `add them to TEAM_LEVELS in config.ts (and the dashboard's level list) to import them`
      );
    }
    const targets = chosen.map(targetFromDiscovery).filter((t): t is ScrapeTarget => t !== null);
    if (targets.length > 0) return targets;
    console.warn(`[run] discovery found nothing matching ${[...wanted].join(", ")}; using generated slugs`);
  } else {
    console.warn(
      `[run] could not read the season picker from ${teamHomeUrl()} — falling back to generated season slugs`
    );
  }

  const slugs = BACKFILL ? seasonSlugs() : [...wanted];
  return TEAM_LEVELS.flatMap((level) => slugs.map((slug) => targetFromConfig(level, slug)));
}

async function runFullScrape(): Promise<void> {
  const targets = await planRun();
  console.log(
    `[run] scraping ${targets.length} season/level target(s)` +
      `${BACKFILL ? " (backfill)" : ""}${PRUNE ? " (prune)" : ""}; current season is ${currentSeasonSlug()}`
  );
  for (const target of targets) {
    try {
      await scrapeSeason(target);
    } catch (err) {
      console.error(`[run] failed on ${target.level} ${target.seasonSlug}:`, err);
    }
  }
  console.log("[run] done");
}

async function main() {
  if (BACKFILL) {
    await runFullScrape();
    await pool.end();
    return;
  }
  // Normal mode: current season for both levels now, then daily at 6am.
  await runFullScrape();
  cron.schedule("0 6 * * *", () => {
    runFullScrape().catch((err) => console.error("[cron] scrape failed:", err));
  });
  console.log("[run] daily cron scheduled for 6:00am; container stays running");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
