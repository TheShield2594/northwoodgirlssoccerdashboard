import * as cheerio from "cheerio";
import { asNumber, asString, deepFindObjects, extractNextData, pick } from "./nextdata.js";

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
  source: "nextdata" | "dom" | "none";
}

/**
 * Parse a MaxPreps schedule page. Strategy:
 *   1. __NEXT_DATA__ JSON — find contest-shaped objects (a date field +
 *      an opponent field). Survives any CSS/markup redesign.
 *   2. DOM fallback — game rows keyed off links to match pages.
 *
 * If BOTH layers return nothing on a page that visibly has games, run
 * `npm run verify` — it prints which layer matched what, and dumps the
 * top-level __NEXT_DATA__ keys so the predicate below is easy to re-aim.
 */
export function parseSchedulePage(html: string, seasonSlug: string): ScheduleParseResult {
  const next = extractNextData(html);
  if (next) {
    const games = parseFromNextData(next, seasonSlug);
    if (games.length > 0) return { games, source: "nextdata" };
  }
  const games = parseFromDom(html, seasonSlug);
  return { games, source: games.length > 0 ? "dom" : "none" };
}

// ---------------------------------------------------------------- nextdata

/** A contest object has some kind of date plus some kind of opponent. */
function looksLikeContest(obj: Record<string, unknown>): boolean {
  const date = pick(obj, "date", "contestDate", "eventDate", "dateString", "startDate");
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

    const dateRaw = asString(
      pick(obj, "date", "contestDate", "eventDate", "dateString", "startDate")
    );
    const isoDate = normalizeDate(dateRaw, seasonSlug);
    if (!isoDate) continue;

    const url = asString(
      pick(obj, "canonicalUrl", "contestUrl", "matchUrl", "url", "webUrl", "boxScoreUrl")
    );
    const matchUrl = url
      ? url.startsWith("http")
        ? url
        : `https://www.maxpreps.com${url}`
      : // No URL in the object — synthesize a stable key so the DB can
        // still dedupe on re-scrape.
        `synthetic:${seasonSlug}:${isoDate}:${opponent}`;
    if (seenUrls.has(matchUrl)) continue;
    seenUrls.add(matchUrl);

    const haRaw = (asString(pick(obj, "homeAway", "homeAwayType", "location")) || "").toLowerCase();
    const homeAway: ParsedGame["homeAway"] = haRaw.startsWith("a")
      ? "away"
      : haRaw.startsWith("h")
      ? "home"
      : haRaw.startsWith("n")
      ? "neutral"
      : "home";

    let teamScore = asNumber(pick(obj, "teamScore", "score", "homeScore", "pointsFor"));
    let opponentScore = asNumber(pick(obj, "opponentScore", "awayScore", "pointsAgainst"));
    let result = normalizeResult(asString(pick(obj, "result", "resultString", "outcome")));

    // Some shapes pack everything into one display string like "W 3-1".
    if (result === null || teamScore === null) {
      const rs = asString(pick(obj, "resultString", "score", "scoreString", "resultScore"));
      if (rs) {
        const m = rs.match(/([WLT])?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/i);
        if (m) {
          const a = parseInt(m[2], 10);
          const b = parseInt(m[3], 10);
          // MaxPreps writes the team's own score first in result strings.
          if (teamScore === null) teamScore = a;
          if (opponentScore === null) opponentScore = b;
          if (result === null && m[1]) result = normalizeResult(m[1]);
        }
      }
    }
    if (result === null && teamScore !== null && opponentScore !== null) {
      result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";
    }

    const contextText = JSON.stringify(obj).toLowerCase();
    games.push({
      isoDate,
      timeText: asString(pick(obj, "time", "timeString", "displayTime")),
      opponent: opponent.replace(/\*\s*$/, "").trim(),
      homeAway,
      isConference:
        pick(obj, "isConference", "conferenceGame", "isLeague") === true ||
        /"conference(game)?":true/.test(contextText) ||
        /\*\s*$/.test(opponent),
      isPlayoff:
        pick(obj, "isPlayoff", "isPostSeason", "postSeason") === true ||
        /playoff|sectional|regional|semi-?state|state final/i.test(contextText),
      isTournament: pick(obj, "isTournament", "tournament") === true || contextText.includes('"tournament"'),
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
    const matchUrl = href.startsWith("http") ? href : `https://www.maxpreps.com${href}`;
    if (seenUrls.has(matchUrl)) return;

    const row = $(el).closest("tr, li, [class*='row' i], [class*='contest' i], [class*='game' i]");
    const rowEl = row.length ? row : $(el).parent();
    const text = rowEl.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!dateMatch) return;
    seenUrls.add(matchUrl);

    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);

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
      .replace(/\*\s*$/, "")
      .trim();
    if (!opponent) {
      const m = text.match(/(?:vs\.?|@)\s*([A-Za-z][A-Za-z .'&()-]+?)(?=\s*(?:\d|W\b|L\b|T\b|Preview|Box|$))/i);
      opponent = m ? m[1].trim().replace(/\*\s*$/, "") : "";
    }
    if (!opponent) return;

    let teamScore: number | null = null;
    let opponentScore: number | null = null;
    let result: ParsedGame["result"] = normalizeResult(
      (text.match(/\b([WLT])\b\s*\d{1,2}\s*[-–]/i) || [])[1] ?? null
    );
    const scoreMatch = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/);
    if (scoreMatch && timeIsNotScore(scoreMatch[0])) {
      teamScore = parseInt(scoreMatch[1], 10);
      opponentScore = parseInt(scoreMatch[2], 10);
      if (result === null) {
        result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";
      }
    }

    games.push({
      isoDate: resolveGameDate(seasonSlug, `${dateMatch[1]}/${dateMatch[2]}`),
      timeText: timeMatch ? timeMatch[1] : null,
      opponent,
      homeAway,
      isConference: /\*/.test(text),
      isPlayoff: /playoff|sectional|regional|semi-?state|state final/i.test(text),
      isTournament: /tournament|invitational/i.test(text),
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

// ----------------------------------------------------------------- helpers

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
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
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
    return parsed.toISOString().slice(0, 10);
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
