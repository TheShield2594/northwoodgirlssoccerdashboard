import { extractNextData } from "./nextdata.js";
import { parseTablesFromDom, ParsedStatLine, StatsParseResult } from "./stats.js";
import { deepFindObjects, asString, asNumber, pick } from "./nextdata.js";

/**
 * Parse a match/box-score page for OUR team's per-player stat lines.
 * Box scores on MaxPreps are entered by coaches and are the flakiest data
 * source in this project: many games simply have none, and the ones that
 * exist show both teams. Strategy mirrors the other parsers — JSON first,
 * then DOM tables filtered to our team's section.
 */
export function parseBoxScorePage(html: string, teamNameHint: string): StatsParseResult {
  const next = extractNextData(html);
  if (next) {
    const lines = parseFromNextData(next, teamNameHint);
    if (lines.length > 0) return { lines, source: "nextdata", unmappedHeaders: [] };
  }
  return parseTablesFromDom(html, teamNameHint);
}

const JSON_STAT_FIELDS: Record<string, string> = {
  goals: "goals",
  assists: "assists",
  shots: "shots",
  shotsongoal: "shots_on_goal",
  saves: "saves",
  goalsagainst: "goals_against",
  yellowcards: "yellow_cards",
  redcards: "red_cards",
};

function parseFromNextData(root: unknown, teamNameHint: string): ParsedStatLine[] {
  // Look for team-sections that contain player stat arrays; keep only the
  // section whose team name matches ours, so we don't ingest the opponent.
  const sections = deepFindObjects(root, (obj) => {
    const name = asString(pick(obj, "teamName", "schoolName", "name"));
    if (!name || !name.includes(teamNameHint)) return false;
    return Object.values(obj).some((v) => Array.isArray(v) && v.length > 0);
  });

  const byName = new Map<string, ParsedStatLine>();
  for (const { value: section } of sections) {
    const rows = deepFindObjects(section, (obj) => {
      const hasName = asString(pick(obj, "athleteName", "playerName", "fullName", "name")) !== null;
      return hasName && Object.keys(obj).some((k) => JSON_STAT_FIELDS[k.toLowerCase()]);
    });
    for (const { value: obj } of rows) {
      const playerName = asString(pick(obj, "athleteName", "playerName", "fullName", "name"));
      if (!playerName || playerName.includes(teamNameHint)) continue;
      const line: ParsedStatLine = byName.get(playerName) ?? {
        playerName,
        jerseyNumber: asString(pick(obj, "jersey", "jerseyNumber")),
        stats: {},
      };
      for (const [key, value] of Object.entries(obj)) {
        const statName = JSON_STAT_FIELDS[key.toLowerCase()];
        if (!statName) continue;
        const n = asNumber(value);
        if (n !== null) line.stats[statName] = n;
      }
      if (Object.keys(line.stats).length > 0) byName.set(playerName, line);
    }
  }
  return [...byName.values()];
}
