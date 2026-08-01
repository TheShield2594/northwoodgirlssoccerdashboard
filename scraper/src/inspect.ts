/**
 * Parse a page of HTML that is already on disk and print what came out.
 * No network, no database — the fastest way to find out whether a parser
 * or the page is at fault.
 *
 *   npm run inspect -- /cache/<file>.html            # auto-detect the page
 *   npm run inspect -- ./roster.html roster
 *   npm run inspect -- ./schedule.html schedule 25-26
 *
 * The scraper caches every page it fetches under SCRAPE_CACHE_DIR (the
 * `scrapecache` volume, mounted at /cache), so a page that imported badly
 * can be re-examined exactly as the parser saw it:
 *
 *   docker exec <scraper> ls /cache
 *   docker exec <scraper> npm run inspect -- /cache/<file>.html
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { currentSeasonSlug, TEAM_NAME_HINT } from "./config.js";
import { extractJsonSources } from "./parse/nextdata.js";
import { parseSchedulePage } from "./parse/schedule.js";
import { parseRosterPage } from "./parse/roster.js";
import { parseStatsPage } from "./parse/stats.js";
import { parseBoxScorePage } from "./parse/boxscore.js";

type Kind = "schedule" | "roster" | "stats" | "boxscore";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const file = args[0];
if (!file) {
  console.error("usage: npm run inspect -- <file.html> [schedule|roster|stats|boxscore] [season-slug]");
  process.exit(1);
}
const season = args[2] ?? currentSeasonSlug();

/** Cache filenames are the URL with punctuation flattened, so the page kind
 *  is usually right there in the name. */
function detectKind(path: string, html: string): Kind {
  const name = basename(path).toLowerCase();
  if (/roster/.test(name)) return "roster";
  if (/stats/.test(name)) return "stats";
  if (/schedule/.test(name)) return "schedule";
  if (/games?_|contest|_vs_/.test(name)) return "boxscore";
  if (/<title>[^<]*roster/i.test(html)) return "roster";
  if (/<title>[^<]*stats/i.test(html)) return "stats";
  return "schedule";
}

const html = readFileSync(file, "utf8");
const kind = (args[1] as Kind) ?? detectKind(file, html);

console.log(`== inspect ${file} as ${kind} ==`);
console.log(`   ${(html.length / 1024).toFixed(0)} KB`);

const sources = extractJsonSources(html);
console.log(
  `   embedded JSON layers: ${
    sources.length ? sources.map((s) => s.kind).join(", ") : "NONE — DOM fallback is the only layer"
  }`
);

if (kind === "schedule") {
  const { games, source } = parseSchedulePage(html, season);
  const timed = games.filter((g) => g.timeText !== null).length;
  console.log(`   ${games.length} games via ${source}; ${timed} with a kickoff time`);
  for (const g of games.slice(0, 10)) {
    console.log(
      `     ${g.isoDate} ${(g.timeText ?? "--:--").padStart(7)} ` +
        `${g.homeAway === "away" ? "@" : g.homeAway === "neutral" ? "N" : "vs"} ${g.opponent}` +
        (g.result ? ` — ${g.result} ${g.teamScore}-${g.opponentScore}` : " (unplayed)")
    );
  }
  if (games.length > 10) console.log(`     … ${games.length - 10} more`);
} else if (kind === "roster") {
  const { entries, source } = parseRosterPage(html);
  console.log(`   ${entries.length} roster entries via ${source}`);
  for (const e of entries) {
    console.log(`     #${e.jerseyNumber ?? "?"} ${e.fullName} ${e.position ?? ""} ${e.grade ?? ""}`);
  }
} else {
  const res = kind === "stats" ? parseStatsPage(html) : parseBoxScorePage(html, TEAM_NAME_HINT);
  console.log(`   ${res.lines.length} stat lines via ${res.source}`);
  for (const l of res.lines.slice(0, 10)) console.log(`     ${l.playerName}:`, l.stats);
  if (res.unmappedHeaders.length) console.log(`   unmapped headers: ${res.unmappedHeaders.join(", ")}`);
}

if (sources.length === 0) {
  console.log("\n   No embedded JSON at all — the parser is guessing from markup.");
} else if (kind === "roster" && parseRosterPage(html).entries.length === 0) {
  console.log("\n   JSON is present but no players matched — the shape predicate in");
  console.log("   src/parse/roster.ts needs re-aiming against this page.");
}
