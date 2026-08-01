import * as cheerio from "cheerio";
import { TEAM_MASCOT_HINT, TEAM_NAME_HINT } from "../config.js";
import {
  ParseSource,
  absoluteUrl,
  asNumber,
  asString,
  deepFindObjects,
  extractJsonSources,
  pick,
} from "./nextdata.js";
import { dateFromDateTime, normalizeTimeText, timeFromDateTime } from "./datetime.js";
import { domText } from "./domtext.js";

export interface ParsedGame {
  isoDate: string; // 'YYYY-MM-DD'
  timeText: string | null;
  opponent: string;
  homeAway: "home" | "away" | "neutral";
  isConference: boolean;
  isPlayoff: boolean;
  isTournament: boolean;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
  matchUrl: string; // unique per game — used as the dedupe key in the DB
}

export interface ScheduleParseResult {
  games: ParsedGame[];
  source: ParseSource;
}

/**
 * Parse a MaxPreps schedule page. Strategy:
 *   1. Embedded JSON — __NEXT_DATA__, the App Router flight payload, JSON-LD,
 *      any other JSON island — searched for contest-shaped objects (a date
 *      field + an opponent field). Survives any CSS/markup redesign.
 *   2. DOM fallback — game rows keyed off links to match pages. This layer
 *      is a guess: it infers opponent, venue and score from row text, so it
 *      is the one that produces subtly-wrong rows when the markup drifts.
 *
 * If EVERY layer returns nothing on a page that visibly has games, run
 * `npm run verify` — it prints which layer matched what, and dumps the
 * embedded-JSON shapes so the predicate below is easy to re-aim.
 */
export function parseSchedulePage(html: string, seasonSlug: string): ScheduleParseResult {
  for (const { kind, root } of extractJsonSources(html)) {
    // MaxPreps' own shape first: positional contest tuples (see below).
    const tuples = parseContestTuples(root);
    if (tuples.length > 0) return { games: tuples, source: kind };
    const games = parseFromNextData(root, seasonSlug);
    if (games.length > 0) return { games, source: kind };
  }
  const games = parseFromDom(html, seasonSlug);
  return { games, source: games.length > 0 ? "dom" : "none" };
}

// ------------------------------------------------------------ contest tuples

/**
 * MaxPreps ships `pageProps.contests` as positional ARRAYS, not objects:
 *
 *   [[teamRowA, teamRowB], contestId, updatedAt, …, "2025-08-16T11:50:00",
 *    …, "https://…/match/northwood-vs-wawasee/8-16-2025/?c=…", …]
 *
 * There is no `date` key and no `opponent` key anywhere in it, which is why
 * the object-shaped predicate below never matched and every schedule page
 * fell through to the DOM guesser. Each team row states its OWN score and
 * venue, so nothing has to be inferred from row text — no winner-first
 * ordering to undo, no asterisks to count, no "@"/"vs" to detect.
 *
 * Within a team row, everything is at a fixed offset from the result letter:
 *
 *   +0 "W"|"L"|"T"   +1 score   +6 venue   +7 type   +8 team url   +9 name
 *
 * venue: 0 home, 1 away, 2 neutral.  type: 0 conference, 1 non-conference,
 * 2 tournament, 4 playoff. Anchoring on the letter rather than a hardcoded
 * index means leading fields can shift without breaking this.
 */
const RESULT_LETTERS = new Set(["W", "L", "T"]);

interface TupleTeam {
  name: string;
  result: "W" | "L" | "T";
  score: number | null;
  venue: number | null;
  type: number | null;
}

function readTeamRow(row: unknown[]): TupleTeam | null {
  const at = row.findIndex((v) => typeof v === "string" && RESULT_LETTERS.has(v));
  if (at === -1) return null;
  const url = row[at + 8];
  const name = row[at + 9];
  // Both must be present and well-formed, or this isn't the layout we think.
  if (typeof url !== "string" || !/^https?:/.test(url)) return null;
  if (typeof name !== "string" || name.trim() === "") return null;
  const score = row[at + 1];
  const venue = row[at + 6];
  const type = row[at + 7];
  return {
    name: name.trim(),
    result: row[at] as "W" | "L" | "T",
    score: typeof score === "number" ? score : null,
    venue: typeof venue === "number" ? venue : null,
    type: typeof type === "number" ? type : null,
  };
}

function readContestTuple(tuple: unknown[]): ParsedGame | null {
  const rows = tuple[0];
  if (!Array.isArray(rows)) return null;
  const teams = rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .map(readTeamRow)
    .filter((t): t is TupleTeam => t !== null);
  if (teams.length !== 2) return null;

  const ours = teams.find((t) => isOwnTeam(t.name));
  const them = teams.find((t) => !isOwnTeam(t.name));
  if (!ours || !them) return null;

  // A cancelled/deleted contest carries no match url — that is how we skip it.
  const matchUrl = tuple.find((v) => typeof v === "string" && /\/match\//.test(v));
  if (typeof matchUrl !== "string") return null;

  // The url embeds the date ("…/8-16-2025/"), which also disambiguates the
  // kickoff datetime from the row's last-updated timestamp: only the right
  // one agrees with it.
  const fromUrl = matchUrl.match(/\/(\d{1,2})-(\d{1,2})-(\d{4})\//);
  if (!fromUrl) return null;
  const isoDate = `${fromUrl[3]}-${fromUrl[1].padStart(2, "0")}-${fromUrl[2].padStart(2, "0")}`;
  if (!isValidIsoDate(isoDate)) return null;

  const kickoff = tuple.find(
    (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.slice(0, 10) === isoDate
  );

  return {
    isoDate,
    timeText: typeof kickoff === "string" ? timeFromDateTime(kickoff) : null,
    opponent: them.name,
    homeAway: ours.venue === 1 ? "away" : ours.venue === 2 ? "neutral" : "home",
    isConference: ours.type === 0,
    isTournament: ours.type === 2,
    isPlayoff: ours.type === 4,
    teamScore: ours.score,
    opponentScore: them.score,
    result: ours.result,
    matchUrl: absoluteUrl(matchUrl) ?? matchUrl,
  };
}

export function parseContestTuples(root: unknown): ParsedGame[] {
  const games: ParsedGame[] = [];
  const seen = new Set<string>();
  for (const { value } of deepFindObjects(root, (o) => Array.isArray(pick(o, "contests")))) {
    for (const entry of pick(value, "contests") as unknown[]) {
      if (!Array.isArray(entry)) continue;
      const game = readContestTuple(entry);
      if (game && !seen.has(game.matchUrl)) {
        seen.add(game.matchUrl);
        games.push(game);
      }
    }
  }
  return games;
}

// ---------------------------------------------------------------- nextdata

/** Every field name a contest's datetime has turned up under. */
const DATE_KEYS = [
  "date",
  "contestDate",
  "eventDate",
  "dateString",
  "startDate",
  "startDateTime",
  "gameDate",
  "scheduledDate",
];

/** …and its separate display time, when the feed splits them. */
const TIME_KEYS = [
  "time",
  "timeString",
  "displayTime",
  "startTime",
  "gameTime",
  "contestTime",
  "scheduledTime",
  "timeOfDay",
];

/** A contest object has some kind of date plus some kind of opponent. */
function looksLikeContest(obj: Record<string, unknown>): boolean {
  const date = pick(obj, ...DATE_KEYS);
  if (asString(date) === null) return false;
  const opp = pick(obj, "opponent", "opponentName", "opponentSchoolName", "opponentMascot");
  if (opp === undefined) return false;
  // Reject obviously-wrong matches (e.g. an ad config with a "date")
  return typeof opp === "string" || typeof opp === "object";
}

function parseFromNextData(root: unknown, seasonSlug: string): ParsedGame[] {
  const found = deepFindObjects(root, looksLikeContest);
  const games: ParsedGame[] = [];
  const seenUrls = new Set<string>();

  for (const { value: obj } of found) {
    // Opponent may be a plain string or a nested object with name fields.
    let opponent: string | null = null;
    const oppRaw = pick(obj, "opponent", "opponentName", "opponentSchoolName");
    if (typeof oppRaw === "string") opponent = oppRaw.trim() || null;
    else if (oppRaw && typeof oppRaw === "object") {
      opponent = asString(
        pick(oppRaw as Record<string, unknown>, "name", "schoolName", "formattedName", "mascotName")
      );
    }
    if (!opponent) continue;
    // Our own team is not an opponent. Some shapes list both sides of the
    // contest; taking the wrong one renames every game after ourselves.
    if (isOwnTeam(opponent)) continue;

    const dateRaw = asString(pick(obj, ...DATE_KEYS));
    const isoDate = normalizeDate(dateRaw, seasonSlug);
    if (!isoDate) continue;
    if (!isValidIsoDate(isoDate)) {
      console.warn(`[schedule] skipping ${opponent}: impossible date "${isoDate}" (from "${dateRaw}")`);
      continue;
    }

    const url = asString(
      pick(obj, "canonicalUrl", "contestUrl", "matchUrl", "url", "webUrl", "boxScoreUrl")
    );
    // No URL in the object — synthesize a stable key so the DB can still
    // dedupe on re-scrape (and upgrade to the real URL when one appears).
    const matchUrl = absoluteUrl(url) ?? `synthetic:${seasonSlug}:${isoDate}:${opponent}`;
    if (seenUrls.has(matchUrl)) continue;
    seenUrls.add(matchUrl);

    // homeAway comes from the dedicated fields only; free-text `location`
    // (a venue name like "Nappanee HS") must never drive the enum, so it
    // only counts when it IS exactly one of the enum words.
    const haRaw = (asString(pick(obj, "homeAway", "homeAwayType")) || "").toLowerCase();
    const locRaw = (asString(pick(obj, "location")) || "").trim().toLowerCase();
    const haSource = haRaw || (["home", "away", "neutral"].includes(locRaw) ? locRaw : "");
    const homeAway: ParsedGame["homeAway"] = haSource.startsWith("a")
      ? "away"
      : haSource.startsWith("n")
      ? "neutral"
      : "home";

    let teamScore = asNumber(pick(obj, "teamScore", "score", "pointsFor"));
    let opponentScore = asNumber(pick(obj, "opponentScore", "pointsAgainst"));
    // Some shapes only give home/away scores — orient them by venue.
    if (teamScore === null && opponentScore === null) {
      const homeScore = asNumber(pick(obj, "homeScore"));
      const awayScore = asNumber(pick(obj, "awayScore"));
      if (homeScore !== null && awayScore !== null) {
        teamScore = homeAway === "away" ? awayScore : homeScore;
        opponentScore = homeAway === "away" ? homeScore : awayScore;
      }
    }
    let result = normalizeResult(asString(pick(obj, "result", "resultString", "outcome")));

    // Some shapes pack everything into one display string like "W 3-1".
    if (result === null || teamScore === null) {
      const rs = asString(pick(obj, "resultString", "score", "scoreString", "resultScore"));
      if (rs) {
        const m = rs.match(/([WLT])?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/i);
        if (m) {
          const letter = m[1] ? normalizeResult(m[1]) : result;
          const oriented = orientScore(letter, parseInt(m[2], 10), parseInt(m[3], 10));
          if (teamScore === null) teamScore = oriented.teamScore;
          if (opponentScore === null) opponentScore = oriented.opponentScore;
          if (result === null && m[1]) result = normalizeResult(m[1]);
        }
      }
    }
    if (result === null && teamScore !== null && opponentScore !== null) {
      result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";
    }

    // Flag text comes only from name/type-ish STRING fields — never the
    // whole serialized object, where URLs and venue names would trigger
    // false positives (and key presence is not truth).
    const flagText = Object.entries(obj)
      .filter(([k, v]) => typeof v === "string" && /name|title|type|description|round|event/i.test(k))
      .map(([, v]) => v as string)
      .join(" ")
      .toLowerCase();
    // The kickoff is usually the time component of the contest datetime, not
    // a field of its own — read the explicit field first, then fall back to
    // the datetime rather than leaving the column empty.
    const timeText =
      normalizeTimeText(asString(pick(obj, ...TIME_KEYS))) ?? timeFromDateTime(dateRaw);

    games.push({
      isoDate,
      timeText,
      opponent: opponent.replace(/\*+\s*$/, "").trim(),
      homeAway,
      isConference:
        pick(obj, "isConference", "conferenceGame", "isLeague") === true ||
        starCount(opponent) === 1,
      isPlayoff:
        pick(obj, "isPlayoff", "isPostSeason", "postSeason") === true ||
        /playoff|sectional|regional|semi-?state|state final/.test(flagText),
      isTournament:
        pick(obj, "isTournament", "tournament") === true ||
        /tournament|invitational/.test(flagText),
      teamScore,
      opponentScore,
      result,
      matchUrl,
    });
  }

  return games;
}

// --------------------------------------------------------------------- dom

/**
 * DOM fallback. Game rows are identified by links to match/contest pages
 * ("/soccer/girls/...match..." or "/local/contests/"). Dedupe by URL since
 * a row usually carries 2-3 links to the same match.
 */
function parseFromDom(html: string, seasonSlug: string): ParsedGame[] {
  const $ = cheerio.load(html);
  const games: ParsedGame[] = [];
  const seenUrls = new Set<string>();

  $("a[href*='/games/'], a[href*='match'], a[href*='contest']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Only links that plausibly point at a specific game page
    // (modern: /games/10-14-2025/soccer-fall/a-vs-b.htm, older: .../match/...)
    if (!/\/games\/|match|contest/i.test(href) || /schedule|\/scores\b/.test(href)) return;
    const matchUrl = absoluteUrl(href);
    if (!matchUrl || seenUrls.has(matchUrl)) return;

    const row = $(el).closest("tr, li, [class*='row' i], [class*='contest' i], [class*='game' i]");
    const rowEl = row.length ? row : $(el).parent();
    // Never use rowEl.text(): adjacent nodes carry no whitespace between them,
    // so the date runs into the time ("9/3" + "6:45pm" -> "9/36:45pm"). Joining
    // only the row's immediate children isn't enough either — those two live in
    // the SAME cell — so domText walks down to the text nodes. See domtext.ts.
    const text = domText($, rowEl);
    if (!text) return;

    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!dateMatch) return;
    seenUrls.add(matchUrl);

    // Same defense for the clock, plus the formats MaxPreps actually prints:
    // "7:15pm", "7:15 PM", "7 p.m.", and the odd 24-hour "19:15".
    const timeText = normalizeTimeText(text);

    const isoDate =
      (dateMatch[3]
        ? normalizeDate(`${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`, seasonSlug)
        : null) ?? resolveGameDate(seasonSlug, `${dateMatch[1]}/${dateMatch[2]}`);
    if (!isValidIsoDate(isoDate)) {
      console.warn(`[schedule] skipping ${matchUrl}: impossible date "${isoDate}" (row: "${text}")`);
      return;
    }

    const homeAway: ParsedGame["homeAway"] = /(^|\s)@\s?/.test(text)
      ? "away"
      : /\bvs\.?\b/i.test(text)
      ? "home"
      : "neutral";

    // Opponent: prefer the anchor that links to another team's page.
    const oppLink = rowEl
      .find("a[href*='/soccer/girls']")
      .filter((__, a) => !/nappanee|northwood/i.test($(a).attr("href") || ""))
      .first();
    let opponent = oppLink
      .text()
      .trim()
      .replace(/^(?:vs\.?|@)\s*/i, "")
      .replace(/\*+\s*$/, "")
      .trim();
    if (!opponent) {
      const m = text.match(/(?:vs\.?|@)\s*([A-Za-z][A-Za-z .'&()-]+?)(?=\s*(?:\d|W\b|L\b|T\b|Preview|Box|$))/i);
      opponent = m ? m[1].trim().replace(/\*+\s*$/, "") : "";
    }
    if (!opponent || isOwnTeam(opponent)) return;

    let teamScore: number | null = null;
    let opponentScore: number | null = null;
    let result: ParsedGame["result"] = normalizeResult(
      (text.match(/\b([WLT])\b\s*\d{1,2}\s*[-–]/i) || [])[1] ?? null
    );
    const scoreMatch = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/);
    if (scoreMatch && timeIsNotScore(scoreMatch[0])) {
      const first = parseInt(scoreMatch[1], 10);
      const second = parseInt(scoreMatch[2], 10);
      ({ teamScore, opponentScore } = orientScore(result, first, second));
      if (result === null) {
        result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";
      }
    }

    const stars = starCount(text);
    games.push({
      // Prefer an explicit year when the row carries one ("8/18/2025");
      // only infer from the season slug for bare month/day dates.
      isoDate,
      timeText,
      opponent,
      homeAway,
      // Legend: * Conference, ** Playoffs, *** Tournament.
      isConference: stars === 1,
      isPlayoff: stars === 2 || /playoff|sectional|regional|semi-?state|state final/i.test(text),
      isTournament: stars === 3 || /tournament|invitational/i.test(text),
      teamScore,
      opponentScore,
      result,
      matchUrl,
    });
  });

  return games;
}

function timeIsNotScore(s: string): boolean {
  return !s.includes(":");
}

/**
 * MaxPreps prints the WINNER's score first: "L 2-0" is a 0-2 defeat, not a
 * 2-0 win. ("L 2-0" cannot mean we scored 2 and lost, which is what proves
 * the convention.) Reading the pair as ours-first credited us with the
 * opponent's goals on every loss AND recorded a clean sheet, so a real
 * 5-8-3 season with 36 GF / 23 GA imported as 4-5-2 with 32 scored, 5
 * conceded and 8 clean sheets.
 *
 * With no result letter there is nothing to orient by — some archived rows
 * show a bare "6-2" — so the pair is left in source order.
 */
function orientScore(
  result: ParsedGame["result"],
  first: number,
  second: number
): { teamScore: number; opponentScore: number } {
  return result === "L"
    ? { teamScore: second, opponentScore: first }
    : { teamScore: first, opponentScore: second };
}

/**
 * The schedule legend is "* Conference | ** Playoffs | *** Tournament", so
 * the COUNT carries the meaning. Treating any asterisk as conference filed
 * every playoff and tournament game as a conference game too.
 */
function starCount(text: string): number {
  return (text.match(/\*+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

/**
 * True when a scraped "opponent" is really us. Both the school name and the
 * mascot show up as row text, and a row that names ourselves means the
 * opponent extraction picked the wrong side.
 */
function isOwnTeam(name: string): boolean {
  // Both sides get the same treatment, or a hint containing a space or period
  // would never match the stripped name.
  const strip = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const n = strip(name);
  return n.includes(strip(TEAM_NAME_HINT)) || n.includes(strip(TEAM_MASCOT_HINT));
}

// ----------------------------------------------------------------- helpers

/**
 * True only for a real calendar date. Postgres rejects "2019-09-56" with
 * `date/time field value out of range`, which used to abort the whole season
 * (roster and stats included), so a malformed row is dropped here instead.
 */
function isValidIsoDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeResult(r: string | null): "W" | "L" | "T" | null {
  if (!r) return null;
  const c = r.trim().charAt(0).toUpperCase();
  return c === "W" || c === "L" || c === "T" ? (c as "W" | "L" | "T") : null;
}

/**
 * Normalize whatever date representation we found into ISO. Accepts full
 * ISO/RFC strings ("2025-08-18T00:00:00"), US dates ("8/18/2025"), or a
 * bare month/day ("8/18") resolved against the season.
 */
export function normalizeDate(raw: string | null, seasonSlug: string): string | null {
  if (!raw) return null;
  // ISO-ish datetimes resolve in the team's timezone: "…T22:00:00Z" is a
  // 6pm Eastern kickoff on the 16th, not a game on the 17th.
  const iso = dateFromDateTime(raw);
  if (iso) return iso;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? 2000 + parseInt(us[3], 10) : parseInt(us[3], 10);
    return `${year}-${String(parseInt(us[1], 10)).padStart(2, "0")}-${String(
      parseInt(us[2], 10)
    ).padStart(2, "0")}`;
  }
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) return resolveGameDate(seasonSlug, raw);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    // Local parts, not toISOString(): a bare date string parses to local
    // midnight, and the UTC conversion would shift it a day in some zones.
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
      parsed.getDate()
    ).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Season slug ("25-26") + short date ("8/18") -> ISO date. Fall sport:
 * month >= 7 belongs to the season's first calendar year, anything
 * earlier (rare spring makeup) to the second.
 */
export function resolveGameDate(seasonSlug: string, dateText: string): string {
  const [startYY] = seasonSlug.split("-");
  const [month, day] = dateText.split("/").map((n) => parseInt(n, 10));
  const startYear = 2000 + parseInt(startYY, 10);
  const year = month >= 7 ? startYear : startYear + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
