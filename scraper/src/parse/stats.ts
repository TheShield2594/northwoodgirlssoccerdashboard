import * as cheerio from "cheerio";
import { asNumber, asString, deepFindObjects, extractNextData, pick } from "./nextdata.js";

export interface ParsedStatLine {
  playerName: string;
  jerseyNumber: string | null;
  stats: Record<string, number>; // canonical stat_name -> value
}

export interface StatsParseResult {
  lines: ParsedStatLine[];
  source: "nextdata" | "dom" | "none";
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
const JSON_FIELD_MAP: Record<string, string> = {
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
  const next = extractNextData(html);
  if (next) {
    const lines = parseFromNextData(next);
    if (lines.length > 0) return { lines, source: "nextdata", unmappedHeaders: [] };
  }
  return parseTablesFromDom(html);
}

// ---------------------------------------------------------------- nextdata

function looksLikeStatRow(obj: Record<string, unknown>): boolean {
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
      // The team's name should appear in the table itself or a nearby
      // heading — check a wrapper a couple of levels up.
      const context = $table.closest("section, article, div").parent().text();
      if (!context.includes(teamNameHint) && !$table.text().includes(teamNameHint)) return;
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
      const playerName = nameCell
        .replace(/#\s?\d{1,2}/, "")
        .replace(/^\d{1,2}\s+/, "")
        .replace(/\b(Fr|So|Jr|Sr)\.?$/, "")
        .trim();
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
        const n = parseFloat(cell.replace(/[%,]/g, ""));
        if (!Number.isNaN(n)) line.stats[statName] = n;
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
