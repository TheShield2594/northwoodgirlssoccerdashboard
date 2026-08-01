import { cleanNameCell, toGivenNameOrder } from "./names.js";
import { asNumber, asString, deepFindObjects, extractJsonSources, pick } from "./nextdata.js";
import { JSON_FIELD_MAP, parseTablesFromDom, ParsedStatLine, StatsParseResult } from "./stats.js";

/**
 * Parse a match/box-score page for OUR team's per-player stat lines.
 * Box scores on MaxPreps are entered by coaches and are the flakiest data
 * source in this project: many games simply have none, and the ones that
 * exist show both teams. Strategy mirrors the other parsers — JSON first,
 * then DOM tables filtered to our team's section. All team-name matching
 * is case-insensitive.
 */
export function parseBoxScorePage(html: string, teamNameHint: string): StatsParseResult {
  for (const { kind, root } of extractJsonSources(html)) {
    const lines = parseFromNextData(root, teamNameHint);
    if (lines.length > 0) return { lines, source: kind, unmappedHeaders: [] };
  }
  return parseTablesFromDom(html, teamNameHint);
}

function parseFromNextData(root: unknown, teamNameHint: string): ParsedStatLine[] {
  const hint = teamNameHint.toLowerCase();

  // Look for team-sections that contain player stat arrays; keep only the
  // section whose team name matches ours, so we don't ingest the opponent.
  const sections = deepFindObjects(root, (obj) => {
    const name = asString(pick(obj, "teamName", "schoolName", "name"));
    if (!name || !name.toLowerCase().includes(hint)) return false;
    return Object.values(obj).some((v) => Array.isArray(v) && v.length > 0);
  });

  const byName = new Map<string, ParsedStatLine>();
  for (const { value: section } of sections) {
    const rows = deepFindObjects(section, (obj) => {
      const hasName = asString(pick(obj, "athleteName", "playerName", "fullName", "name")) !== null;
      return hasName && Object.keys(obj).some((k) => JSON_FIELD_MAP[k.toLowerCase()]);
    });
    for (const { value: obj } of rows) {
      const rawName = asString(pick(obj, "athleteName", "playerName", "fullName", "name"));
      if (!rawName || rawName.toLowerCase().includes(hint)) continue;
      const playerName = toGivenNameOrder(cleanNameCell(rawName));
      if (!playerName) continue;
      const line: ParsedStatLine = byName.get(playerName) ?? {
        playerName,
        jerseyNumber: asString(pick(obj, "jersey", "jerseyNumber")),
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
  }
  return [...byName.values()];
}
