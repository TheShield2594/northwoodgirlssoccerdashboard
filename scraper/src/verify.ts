/**
 * Live-parse diagnostic: fetches one season's pages and prints exactly
 * what each parser layer found, WITHOUT writing to the database. Run this
 * from a machine that can reach maxpreps.com before trusting a backfill:
 *
 *   npm run verify                 # current season, varsity
 *   npm run verify -- jv           # current season, JV
 *   npm run verify -- varsity 24-25
 *
 * If a parser returns 0 rows, this prints the top-level __NEXT_DATA__
 * keys and a few candidate arrays so re-aiming the shape predicates in
 * src/parse/*.ts is quick.
 */
import { TEAM_NAME_HINT, TeamLevel, currentSeasonSlug, rosterUrl, scheduleUrl, statsUrl } from "./config.js";
import { fetchHtml } from "./http.js";
import { extractJsonSources, extractNextData } from "./parse/nextdata.js";
import { parseSchedulePage } from "./parse/schedule.js";
import { parseRosterPage } from "./parse/roster.js";
import { parseStatsPage } from "./parse/stats.js";
import { parseBoxScorePage } from "./parse/boxscore.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const level: TeamLevel =
  args[0] === "jv" ? "jv" : args[0] === "freshman" ? "freshman" : "varsity";
const season = args[1] ?? currentSeasonSlug();

/** Always worth printing: which embedded-JSON layers the page even has.
 *  "flight" means App Router; "NONE" means the DOM fallback is guessing. */
function dumpLayers(html: string) {
  const kinds = extractJsonSources(html).map((s) => s.kind);
  console.log(`  embedded JSON layers: ${kinds.length ? kinds.join(", ") : "NONE — DOM fallback is the only layer"}`);
}

function dumpNextDataShape(html: string) {
  const next = extractNextData(html) as Record<string, unknown> | null;
  if (!next) {
    console.log("  __NEXT_DATA__: NOT FOUND (Pages Router only) — see the layer list above");
    return;
  }
  console.log("  __NEXT_DATA__ top-level keys:", Object.keys(next).join(", "));
  const props = (next as any)?.props?.pageProps;
  if (props && typeof props === "object") {
    console.log(
      "  pageProps keys:",
      Object.keys(props)
        .map((k) => {
          const v = (props as any)[k];
          const tag = Array.isArray(v) ? `[${v.length}]` : typeof v === "object" && v ? "{…}" : typeof v;
          return `${k}:${tag}`;
        })
        .join(", ")
    );
  }
}

async function main() {
  console.log(`== verify ${level} ${season} ==\n`);

  // --- schedule
  const schedUrl = scheduleUrl(level, season);
  console.log(`SCHEDULE ${schedUrl}`);
  const schedHtml = await fetchHtml(schedUrl);
  if (!schedHtml) {
    console.log("  fetch failed (404 or network) — check the URL in a browser\n");
  } else {
    dumpLayers(schedHtml);
    const sched = parseSchedulePage(schedHtml, season);
    console.log(`  parsed ${sched.games.length} games via ${sched.source}`);
    const timed = sched.games.filter((g) => g.timeText !== null).length;
    console.log(`  kickoff times present on ${timed}/${sched.games.length} games`);
    for (const g of sched.games.slice(0, 5)) {
      console.log(
        `    ${g.isoDate} ${g.timeText ?? "--:--"} ${g.homeAway === "away" ? "@" : "vs"} ${g.opponent}` +
          (g.result ? ` — ${g.result} ${g.teamScore}-${g.opponentScore}` : " (unplayed)") +
          (g.isConference ? " [conf]" : "")
      );
    }
    if (sched.games.length > 5) console.log(`    … ${sched.games.length - 5} more`);
    if (sched.games.length === 0) dumpNextDataShape(schedHtml);

    // --- box score for the first played game with a real URL
    const played = sched.games.find((g) => g.result && !g.matchUrl.startsWith("synthetic:"));
    if (played) {
      console.log(`\nBOX SCORE ${played.matchUrl}`);
      const boxHtml = await fetchHtml(played.matchUrl);
      if (boxHtml) {
        dumpLayers(boxHtml);
        const box = parseBoxScorePage(boxHtml, TEAM_NAME_HINT);
        console.log(`  parsed ${box.lines.length} player lines via ${box.source}`);
        for (const l of box.lines.slice(0, 5)) console.log(`    ${l.playerName}:`, l.stats);
        if (box.unmappedHeaders.length) console.log("  unmapped headers:", box.unmappedHeaders.join(", "));
        if (box.lines.length === 0) {
          dumpNextDataShape(boxHtml);
          console.log("  (many games legitimately have no box score entered — try another matchUrl)");
        }
      }
    }
  }

  // --- roster
  const rUrl = rosterUrl(level, season);
  console.log(`\nROSTER ${rUrl}`);
  const rosterHtml = await fetchHtml(rUrl);
  if (rosterHtml) {
    dumpLayers(rosterHtml);
    const roster = parseRosterPage(rosterHtml);
    console.log(
      `  parsed ${roster.entries.length} entries via ${roster.source}` +
        (roster.expectedCount !== null ? `; page reports ${roster.expectedCount} athletes` : "")
    );
    for (const e of roster.entries.slice(0, 5)) {
      console.log(`    #${e.jerseyNumber ?? "?"} ${e.fullName} ${e.position ?? ""} ${e.grade ?? ""}`);
    }
    if (roster.expectedCount === 0) {
      console.log("  MaxPreps lists no athletes for this team — nothing to import, not a parser failure");
    } else if (roster.entries.length === 0) {
      console.log("  0 parsed — the shape predicate needs re-aiming:");
      dumpNextDataShape(rosterHtml);
    } else if (roster.expectedCount !== null && roster.entries.length !== roster.expectedCount) {
      console.log(`  MISMATCH: parsed ${roster.entries.length}, page reports ${roster.expectedCount}`);
    }
  } else {
    console.log("  fetch failed");
  }

  // --- season stats
  const sUrl = statsUrl(level, season);
  console.log(`\nSTATS ${sUrl}`);
  const statsHtml = await fetchHtml(sUrl);
  if (statsHtml) {
    dumpLayers(statsHtml);
    const stats = parseStatsPage(statsHtml);
    console.log(`  parsed ${stats.lines.length} stat lines via ${stats.source}`);
    for (const l of stats.lines.slice(0, 5)) console.log(`    ${l.playerName}:`, l.stats);
    if (stats.unmappedHeaders.length) console.log("  unmapped headers:", stats.unmappedHeaders.join(", "));
    if (stats.lines.length === 0) dumpNextDataShape(statsHtml);
  } else {
    console.log("  fetch failed");
  }

  console.log("\n== verify done ==");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
