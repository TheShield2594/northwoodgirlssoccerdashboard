import cron from "node-cron";
import {
  CURRENT_SEASON_SLUG,
  SEASON_SLUGS,
  TEAM_LEVELS,
  TEAM_NAME_HINT,
  TeamLevel,
  rosterUrl,
  scheduleUrl,
  statsUrl,
} from "./config.js";
import { fetchHtml } from "./http.js";
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

async function scrapeSeason(level: TeamLevel, seasonSlug: string): Promise<void> {
  const schedHtml = await fetchHtml(scheduleUrl(level, seasonSlug));
  if (!schedHtml) {
    console.log(`[scrape] ${level} ${seasonSlug}: no schedule page (season/level likely doesn't exist), skipping`);
    return;
  }

  const { games, source } = parseSchedulePage(schedHtml, seasonSlug);
  if (games.length === 0) {
    console.log(
      `[scrape] ${level} ${seasonSlug}: 0 games parsed — run \`npm run verify\` against this page to re-aim the parser`
    );
    return;
  }
  console.log(`[scrape] ${level} ${seasonSlug}: ${games.length} games via ${source}`);
  warnIfGuessing(`${level} ${seasonSlug} schedule`, source);
  const withTimes = games.filter((g) => g.timeText !== null).length;
  if (withTimes === 0) {
    console.warn(
      `[scrape]   WARNING: no kickoff times on any of the ${games.length} games — the page's time field has moved; run \`npm run verify\``
    );
  }

  const seasonId = await upsertSeason(seasonSlug, seasonLabel(seasonSlug), level);

  const keptGameUrls: string[] = [];
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
      console.error(
        `[scrape]   skipping game ${g.isoDate} vs ${g.opponent} (${g.matchUrl}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Roster
  const keptPlayerSeasonIds: number[] = [];
  const rosterUrlForSeason = rosterUrl(level, seasonSlug);
  const rosterHtml = await fetchHtml(rosterUrlForSeason);
  if (!rosterHtml) {
    console.warn(`[scrape] ${level} ${seasonSlug}: roster page unreachable (${rosterUrlForSeason})`);
  } else {
    const roster = parseRosterPage(rosterHtml);
    for (const entry of roster.entries) {
      keptPlayerSeasonIds.push(await upsertRosterEntry(seasonId, entry));
    }
    console.log(`[scrape] ${level} ${seasonSlug}: ${roster.entries.length} roster entries via ${roster.source}`);
    if (roster.entries.length === 0) {
      // Silent zero here is what let an entire season import with no players.
      console.warn(
        `[scrape]   WARNING: roster page fetched but 0 players parsed (${rosterUrlForSeason}) — run \`npm run verify ${level} ${seasonSlug}\``
      );
    }
    warnIfGuessing(`${level} ${seasonSlug} roster`, roster.source);
  }

  // Season aggregate stats
  const statsHtml = await fetchHtml(statsUrl(level, seasonSlug));
  if (statsHtml) {
    const stats = parseStatsPage(statsHtml);
    if (stats.lines.length > 0) {
      keptPlayerSeasonIds.push(...(await saveSeasonStats(seasonId, stats.lines)));
    }
    if (stats.unmappedHeaders.length > 0) {
      console.log(`[scrape]   unmapped stat columns (add to STAT_COLUMN_MAP?): ${stats.unmappedHeaders.join(", ")}`);
    }
    console.log(`[scrape] ${level} ${seasonSlug}: ${stats.lines.length} stat lines via ${stats.source}`);
    warnIfGuessing(`${level} ${seasonSlug} stats`, stats.source);
  }

  if (PRUNE) {
    const removed = await pruneSeason(seasonId, keptGameUrls, keptPlayerSeasonIds);
    if (removed.games || removed.rosterEntries || removed.players) {
      console.log(
        `[scrape] ${level} ${seasonSlug}: pruned ${removed.games} stale game(s), ` +
          `${removed.rosterEntries} roster row(s), ${removed.players} orphan player(s)`
      );
    }
  }
}

async function runFullScrape(): Promise<void> {
  const slugs = BACKFILL ? SEASON_SLUGS : [CURRENT_SEASON_SLUG];
  console.log(
    `[run] scraping ${TEAM_LEVELS.join("+")} x ${slugs.length} season(s)` +
      `${BACKFILL ? " (backfill)" : ""}${PRUNE ? " (prune)" : ""}`
  );
  for (const level of TEAM_LEVELS) {
    for (const slug of slugs) {
      try {
        await scrapeSeason(level, slug);
      } catch (err) {
        console.error(`[run] failed on ${level} ${slug}:`, err);
      }
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
