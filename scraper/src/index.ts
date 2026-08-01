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
  upsertRosterEntry,
  upsertSeason,
} from "./db.js";

const BACKFILL = process.argv.includes("--backfill");
const SKIP_BOX_SCORES = process.argv.includes("--no-box-scores");

function seasonLabel(slug: string): string {
  return `Fall 20${slug.split("-")[0]}`;
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

  const seasonId = await upsertSeason(seasonSlug, seasonLabel(seasonSlug), level);

  for (const g of games) {
    // One unusable game must not take the season down with it — the rest of
    // the schedule, plus the roster and stats below, still need to be scraped.
    try {
      const gameId = await upsertGame(seasonId, seasonSlug, g);
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
  const rosterHtml = await fetchHtml(rosterUrl(level, seasonSlug));
  if (rosterHtml) {
    const roster = parseRosterPage(rosterHtml);
    for (const entry of roster.entries) await upsertRosterEntry(seasonId, entry);
    console.log(`[scrape] ${level} ${seasonSlug}: ${roster.entries.length} roster entries via ${roster.source}`);
  }

  // Season aggregate stats
  const statsHtml = await fetchHtml(statsUrl(level, seasonSlug));
  if (statsHtml) {
    const stats = parseStatsPage(statsHtml);
    if (stats.lines.length > 0) await saveSeasonStats(seasonId, stats.lines);
    if (stats.unmappedHeaders.length > 0) {
      console.log(`[scrape]   unmapped stat columns (add to STAT_COLUMN_MAP?): ${stats.unmappedHeaders.join(", ")}`);
    }
    console.log(`[scrape] ${level} ${seasonSlug}: ${stats.lines.length} stat lines via ${stats.source}`);
  }
}

async function runFullScrape(): Promise<void> {
  const slugs = BACKFILL ? SEASON_SLUGS : [CURRENT_SEASON_SLUG];
  console.log(
    `[run] scraping ${TEAM_LEVELS.join("+")} x ${slugs.length} season(s)${BACKFILL ? " (backfill)" : ""}`
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
