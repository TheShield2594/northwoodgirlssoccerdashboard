/**
 * What a run did, and whether anything about it should worry you.
 *
 * The scraper has always logged its problems — DOM fallbacks, unmapped stat
 * columns, zero-row parses. But those logs go to stdout inside a container,
 * so in practice a broken parser was discovered by opening the dashboard
 * weeks later and finding a page blank. This module turns each run into one
 * summary and, when something regressed, pushes it somewhere a human reads.
 *
 * Set SCRAPE_WEBHOOK_URL to a Discord or Slack incoming webhook. Unset, the
 * whole thing is a no-op and only the console summary prints.
 */
import type { SeasonCounts } from "./db.js";
import type { ParseSource } from "./parse/nextdata.js";

/** One season/level's outcome, as this run saw it. */
export interface SeasonReport {
  level: string;
  seasonSlug: string;
  /** Row counts already in the DB when this season's scrape began. */
  before: SeasonCounts;
  games: number;
  /** Games with a result. A season can have a full schedule and no stats
   *  simply because none of it has been played yet. */
  gamesPlayed: number;
  rosterEntries: number;
  /** What the roster page says it has, when it says — see roster.ts. */
  rosterExpected: number | null;
  statLines: number;
  /** Which layer each parser came out of; "dom" means it was guessing. */
  sources: Partial<Record<"schedule" | "roster" | "stats", ParseSource>>;
  boxScores: number;
  /** Anything that went wrong, in the words the alert should carry. */
  problems: string[];
}

export function newSeasonReport(
  level: string,
  seasonSlug: string,
  before: SeasonCounts
): SeasonReport {
  return {
    level,
    seasonSlug,
    before,
    games: 0,
    gamesPlayed: 0,
    rosterEntries: 0,
    rosterExpected: null,
    statLines: 0,
    sources: {},
    boxScores: 0,
    problems: [],
  };
}

/**
 * Regressions — data we used to have and this run did not reproduce.
 *
 * This is the signal worth waking someone for, and it is deliberately
 * narrower than "something looks off". A season that never had stats stays
 * quiet (a new season in August legitimately has none); a season that had 22
 * stat lines yesterday and none today is a parser that stopped matching, and
 * is exactly the failure that hid for weeks. Recorded on the report so a run
 * where nothing regressed can stay silent.
 */
export function findRegressions(r: SeasonReport): string[] {
  const lost: string[] = [];
  const check = (what: string, now: number, before: number) => {
    if (before > 0 && now === 0) lost.push(`${what}: had ${before}, parsed 0 this run`);
  };
  check("stat lines", r.statLines, r.before.statLines);
  check("games", r.games, r.before.games);
  check("roster entries", r.rosterEntries, r.before.rosterEntries);
  return lost;
}

function statusLine(r: SeasonReport): string {
  const lost = findRegressions(r);
  // Fixed width, so the columns after it line up down the message.
  const mark = (lost.length > 0 ? "!!" : r.problems.length > 0 ? "?" : "ok").padEnd(2);
  const src = (k: "schedule" | "roster" | "stats") => {
    const s = r.sources[k];
    return s === undefined ? "-" : s === "dom" ? "dom!" : s;
  };
  return (
    `${mark}  ${r.level.padEnd(8)} ${r.seasonSlug}  ` +
    `games ${String(r.games).padStart(3)} (${src("schedule")})  ` +
    `roster ${String(r.rosterEntries).padStart(3)} (${src("roster")})  ` +
    `stats ${String(r.statLines).padStart(3)} (${src("stats")})  ` +
    `box ${r.boxScores}`
  );
}

export interface RunSummary {
  text: string;
  /** True when anything regressed or a parser reported trouble. */
  alarming: boolean;
}

export function summarize(reports: SeasonReport[]): RunSummary {
  const lines: string[] = [];
  const alarms: string[] = [];

  for (const r of reports) {
    lines.push(statusLine(r));
    const label = `${r.level} ${r.seasonSlug}`;
    for (const lost of findRegressions(r)) alarms.push(`REGRESSION ${label} ${lost}`);
    for (const p of r.problems) alarms.push(`${label}: ${p}`);
  }

  const header =
    alarms.length > 0
      ? `northwood scrape: ${alarms.length} problem(s) across ${reports.length} season/level target(s)`
      : `northwood scrape: ${reports.length} target(s), all clean`;

  const text = [header, "", ...lines, ...(alarms.length ? ["", ...alarms] : [])].join("\n");
  return { text, alarming: alarms.length > 0 };
}

/**
 * Post a summary to the configured webhook.
 *
 * Only alarming runs are sent by default: an alert that arrives every single
 * day is an alert nobody reads, and the whole point is that the bad days
 * stand out. SCRAPE_WEBHOOK_ALWAYS=1 sends the clean ones too.
 *
 * Never throws. A webhook that is down must not take the scrape with it —
 * the data is already committed by the time this runs.
 */
export async function postSummary(summary: RunSummary): Promise<void> {
  const url = process.env.SCRAPE_WEBHOOK_URL;
  if (!url) return;
  if (!summary.alarming && process.env.SCRAPE_WEBHOOK_ALWAYS !== "1") return;

  // Discord reads `content`, Slack reads `text`. Sending both keys satisfies
  // either without needing to know which one the URL belongs to.
  const body = JSON.stringify({
    content: "```\n" + truncate(summary.text) + "\n```",
    text: summary.text,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[notify] webhook returned ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`[notify] webhook post failed:`, err instanceof Error ? err.message : err);
  }
}

/** Discord rejects messages over 2000 characters outright, so a long bad run
 *  would post nothing at all — trim to fit, leaving room for the code fence. */
function truncate(text: string, limit = 1900): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 20) + "\n… (truncated)";
}
