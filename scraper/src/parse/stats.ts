import * as cheerio from "cheerio";
import { cleanNameCell, toGivenNameOrder } from "./names.js";
import {
  ParseSource,
  asNumber,
  asString,
  deepFindObjects,
  extractJsonSources,
  pick,
} from "./nextdata.js";

export interface ParsedStatLine {
  playerName: string;
  jerseyNumber: string | null;
  stats: Record<string, number>; // canonical stat_name -> value
}

export interface StatsParseResult {
  lines: ParsedStatLine[];
  source: ParseSource;
  /** Column headers seen but not mapped — surfaced by verify so the map can grow. */
  unmappedHeaders: string[];
}

/**
 * Header abbreviations seen on MaxPreps soccer stat tables mapped to the
 * canonical stat_name we store. Grow this list as `npm run verify` reports
 * unmapped headers — unknown columns are skipped, never guessed.
 */
export const STAT_COLUMN_MAP: Record<string, string> = {
  GP: "games_played",
  GS: "games_started",
  G: "goals",
  GLS: "goals",
  GOALS: "goals",
  A: "assists",
  AST: "assists",
  ASSISTS: "assists",
  PTS: "points",
  POINTS: "points",
  SH: "shots",
  SHOTS: "shots",
  SOG: "shots_on_goal",
  GWG: "game_winning_goals",
  PPG: "points_per_game", // some seasons show per-game averages
  "G/G": "goals_per_game",
  "A/G": "assists_per_game",
  SV: "saves",
  SAVES: "saves",
  SVS: "saves",
  GA: "goals_against",
  GAA: "goals_against_average",
  SO: "shutouts",
  SHO: "shutouts",
  MIN: "minutes",
  MINS: "minutes",
  "SV%": "save_percentage",
  YC: "yellow_cards",
  RC: "red_cards",
  FLS: "fouls",
  CK: "corner_kicks",
  PK: "penalty_kicks",
  PKG: "penalty_kick_goals",
};

// JSON field names (camelCase, from __NEXT_DATA__) → canonical stat_name.
// Exported so the box-score parser shares the same mapping.
export const JSON_FIELD_MAP: Record<string, string> = {
  gamesplayed: "games_played",
  gamesstarted: "games_started",
  goals: "goals",
  assists: "assists",
  points: "points",
  shots: "shots",
  shotsongoal: "shots_on_goal",
  gamewinninggoals: "game_winning_goals",
  saves: "saves",
  goalsagainst: "goals_against",
  goalsagainstaverage: "goals_against_average",
  shutouts: "shutouts",
  minutes: "minutes",
  savepercentage: "save_percentage",
  yellowcards: "yellow_cards",
  redcards: "red_cards",
  fouls: "fouls",
  cornerkicks: "corner_kicks",
  penaltykicks: "penalty_kicks",
};

/** Parse a team season-stats page (aggregate per-player stat lines). */
export function parseStatsPage(html: string): StatsParseResult {
  for (const { kind, root } of extractJsonSources(html)) {
    // Labelled tuples first — MaxPreps ships most page data as positional
    // arrays rather than objects (see schedule.ts / roster.ts).
    const tuples = parseLabelledTuples(root);
    if (tuples.lines.length > 0) return { ...tuples, source: kind };
    const lines = parseFromNextData(root);
    if (lines.length > 0) return { lines, source: kind, unmappedHeaders: [] };
  }
  return parseTablesFromDom(html);
}

// ----------------------------------------------------------- labelled tuples

/**
 * A stats grid shipped as `{ columns: ["GP","G","A",…], rows: [[…],[…]] }`,
 * under whatever key names the build happens to use.
 *
 * Unlike the roster and schedule tuples, a stat tuple is all numbers, so its
 * columns cannot be identified from the values — 14 could be games played,
 * goals, or a jersey. This parser therefore only runs when the payload also
 * ships the column labels, and it reads the labels rather than assuming an
 * order. If MaxPreps ships headerless stat tuples, nothing matches here and
 * we fall through rather than invent a mapping; `npm run inspect` prints the
 * tuple shape so the offsets can be read off a real page.
 */
function findHeaderRow(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  if (!value.every((v) => typeof v === "string")) return null;
  const headers = (value as string[]).map((h) => h.trim().toUpperCase());
  const mapped = headers.filter((h) => STAT_COLUMN_MAP[h] !== undefined).length;
  // Two recognised abbreviations is enough to be a stat header and far too
  // specific to hit by accident on a list of names or positions.
  return mapped >= 2 ? headers : null;
}

const NAME_HEADER = /^(NAME|PLAYER|ATHLETE)S?$|NAME$/;

function parseLabelledTuples(root: unknown): { lines: ParsedStatLine[]; unmappedHeaders: string[] } {
  const byName = new Map<string, ParsedStatLine>();
  const unmapped = new Set<string>();

  for (const { value: holder } of deepFindObjects(root, (o) =>
    Object.values(o).some((v) => findHeaderRow(v) !== null)
  )) {
    const headers = Object.values(holder).map(findHeaderRow).find((h) => h !== null);
    if (!headers) continue;

    // The data rows are the sibling array whose rows are exactly as wide as
    // the header. Anything narrower or wider is a different grid.
    const rows = Object.values(holder).find(
      (v): v is unknown[][] =>
        Array.isArray(v) &&
        v.length > 0 &&
        v.every((r) => Array.isArray(r) && r.length === headers.length)
    );
    if (!rows) continue;

    headers.forEach((h) => {
      if (h && !STAT_COLUMN_MAP[h] && !NAME_HEADER.test(h) && !/^#$|^NO\.?$/.test(h)) {
        unmapped.add(h);
      }
    });

    const nameIdx = headers.findIndex((h) => NAME_HEADER.test(h));
    for (const row of rows) {
      const raw =
        nameIdx >= 0
          ? asString(row[nameIdx])
          : asString(row.find((v) => typeof v === "string" && /[A-Za-z]{2,}\s+[A-Za-z]/.test(v)));
      if (!raw) continue;
      const playerName = toGivenNameOrder(cleanNameCell(raw));
      if (!playerName) continue;

      const line: ParsedStatLine = byName.get(playerName) ?? {
        playerName,
        jerseyNumber: null,
        stats: {},
      };
      headers.forEach((header, i) => {
        const statName = STAT_COLUMN_MAP[header];
        if (!statName) return;
        const n = asNumber(row[i]);
        if (n !== null) line.stats[statName] = n;
      });
      if (Object.keys(line.stats).length > 0) byName.set(playerName, line);
    }
  }

  return { lines: [...byName.values()], unmappedHeaders: [...unmapped] };
}

// ---------------------------------------------------------------- nextdata

function looksLikeStatRow(obj: Record<string, unknown>): boolean {
  // schema.org nodes (`@type: "ListItem"`, breadcrumbs) carry a `name` and
  // could only ever be false positives — see roster.ts, where they were
  // being imported as players.
  if ("@type" in obj || "@context" in obj) return false;
  const name =
    asString(pick(obj, "athleteName", "playerName", "fullName", "name")) !== null ||
    (asString(pick(obj, "firstName")) !== null && asString(pick(obj, "lastName")) !== null);
  if (!name) return false;
  // Needs at least one recognizable numeric stat field
  return Object.keys(obj).some((k) => JSON_FIELD_MAP[k.toLowerCase()] !== undefined);
}

function parseFromNextData(root: unknown): ParsedStatLine[] {
  const found = deepFindObjects(root, looksLikeStatRow);
  const byName = new Map<string, ParsedStatLine>();

  for (const { value: obj } of found) {
    let playerName = asString(pick(obj, "athleteName", "playerName", "fullName", "name"));
    if (!playerName) {
      const first = asString(pick(obj, "firstName"));
      const last = asString(pick(obj, "lastName"));
      if (first && last) playerName = `${first} ${last}`;
    }
    if (!playerName) continue;
    playerName = toGivenNameOrder(cleanNameCell(playerName));
    if (!playerName) continue;

    const line: ParsedStatLine = byName.get(playerName) ?? {
      playerName,
      jerseyNumber: asString(pick(obj, "jersey", "jerseyNumber", "uniform")),
      stats: {},
    };
    for (const [key, value] of Object.entries(obj)) {
      const statName = JSON_FIELD_MAP[key.toLowerCase()];
      if (!statName) continue;
      const n = asNumber(value);
      if (n !== null) line.stats[statName] = n;
    }
    if (Object.keys(line.stats).length > 0) byName.set(playerName, line);
  }
  return [...byName.values()];
}

// --------------------------------------------------------------------- dom

/**
 * Table fallback, also used for box scores. Walks every <table>, reads the
 * header row for stat abbreviations, and maps player rows through
 * STAT_COLUMN_MAP. `teamNameHint`, when given, keeps only tables inside a
 * section mentioning our team (needed on match pages that show both teams).
 */
export function parseTablesFromDom(html: string, teamNameHint?: string): StatsParseResult {
  const $ = cheerio.load(html);
  const byName = new Map<string, ParsedStatLine>();
  const unmapped = new Set<string>();

  $("table").each((_, table) => {
    const $table = $(table);
    if (teamNameHint) {
      // The team's name should appear in the table itself or its enclosing
      // section/heading. Prefer the nearest <section>/<article> (so the
      // opponent's identically-shaped table in a sibling section doesn't
      // match); only tableless-div layouts look one level further up.
      // Case-insensitive: MaxPreps styles names inconsistently.
      const hint = teamNameHint.toLowerCase();
      const section = $table.closest("section, article");
      const div = $table.closest("div");
      const context = (
        section.length ? section.text() : div.length ? div.parent().text() : $.root().text()
      ).toLowerCase();
      if (!context.includes(hint) && !$table.text().toLowerCase().includes(hint)) return;
    }

    const headerCells = $table
      .find("thead th, thead td")
      .map((__, th) => $(th).text().trim().toUpperCase())
      .get();
    if (headerCells.length === 0) {
      const firstRow = $table.find("tr").first();
      firstRow.find("th, td").each((__, c) => {
        headerCells.push($(c).text().trim().toUpperCase());
      });
    }
    // A stats table must have at least one mappable column.
    const hasStatCol = headerCells.some((h) => STAT_COLUMN_MAP[h] !== undefined);
    if (!hasStatCol) return;
    headerCells.forEach((h) => {
      if (h && !STAT_COLUMN_MAP[h] && !/NAME|PLAYER|ATHLETE|#|NO\.?|^$/.test(h)) unmapped.add(h);
    });

    $table.find("tbody tr, tr").each((__, tr) => {
      const cells = $(tr)
        .find("td")
        .map((___, td) => $(td).text().replace(/\s+/g, " ").trim())
        .get();
      if (cells.length < 2) return;

      // Find the name cell: first cell containing letters. It may be
      // "#9 Avery Miller", "Avery Miller #9", or just the name.
      let nameIdx = cells.findIndex((c) => /[A-Za-z]{2,}/.test(c));
      if (nameIdx === -1) return;
      const nameCell = cells[nameIdx];
      if (/total|opponent|team\b/i.test(nameCell)) return;

      const numMatch = nameCell.match(/#\s?(\d{1,2})/) || nameCell.match(/^(\d{1,2})\s+(?=[A-Z])/);
      // Canonical "First Last" so a stats page that prints "Miller, Avery"
      // joins to the roster's "Avery Miller" instead of forking the player.
      const playerName = toGivenNameOrder(cleanNameCell(nameCell));
      if (!playerName || !/[A-Za-z]/.test(playerName)) return;

      const line: ParsedStatLine = byName.get(playerName) ?? {
        playerName,
        jerseyNumber: numMatch ? numMatch[1] : null,
        stats: {},
      };

      // Header/cell alignment: headers may or may not include the leading
      // #/name columns, so align from the right edge (stat columns are
      // always the trailing ones).
      const offset = cells.length - headerCells.length;
      headerCells.forEach((header, i) => {
        const statName = STAT_COLUMN_MAP[header];
        if (!statName) return;
        const cell = cells[i + offset];
        if (cell === undefined) return;
        const n = asNumber(cell);
        if (n !== null) line.stats[statName] = n;
      });

      if (Object.keys(line.stats).length > 0) byName.set(playerName, line);
    });
  });

  const lines = [...byName.values()];
  return {
    lines,
    source: lines.length > 0 ? "dom" : "none",
    unmappedHeaders: [...unmapped],
  };
}
