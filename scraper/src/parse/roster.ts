import * as cheerio from "cheerio";
import { absoluteUrl, asString, deepFindObjects, extractNextData, pick } from "./nextdata.js";

export interface ParsedRosterEntry {
  fullName: string;
  jerseyNumber: string | null;
  position: string | null;
  grade: string | null; // 'Fr' | 'So' | 'Jr' | 'Sr' or whatever the page shows
  athleteUrl: string | null;
}

export interface RosterParseResult {
  entries: ParsedRosterEntry[];
  source: "nextdata" | "dom" | "none";
}

/** Parse a MaxPreps roster page: __NEXT_DATA__ first, DOM table fallback. */
export function parseRosterPage(html: string): RosterParseResult {
  const next = extractNextData(html);
  if (next) {
    const entries = parseFromNextData(next);
    if (entries.length > 0) return { entries, source: "nextdata" };
  }
  const entries = parseFromDom(html);
  return { entries, source: entries.length > 0 ? "dom" : "none" };
}

// ---------------------------------------------------------------- nextdata

/** A roster entry has a person-name shape plus at least one athlete field. */
function looksLikeRosterEntry(obj: Record<string, unknown>): boolean {
  const hasName =
    asString(pick(obj, "athleteName", "fullName", "name")) !== null ||
    (asString(pick(obj, "firstName")) !== null && asString(pick(obj, "lastName")) !== null);
  if (!hasName) return false;
  return (
    pick(obj, "jersey", "jerseyNumber", "uniform", "number") !== undefined ||
    pick(obj, "position", "positions", "positionShort") !== undefined ||
    pick(obj, "grade", "gradeClass", "classYear", "year") !== undefined
  );
}

function parseFromNextData(root: unknown): ParsedRosterEntry[] {
  const found = deepFindObjects(root, looksLikeRosterEntry);
  const entries: ParsedRosterEntry[] = [];
  const seen = new Set<string>();

  for (const { value: obj } of found) {
    let fullName = asString(pick(obj, "athleteName", "fullName", "name"));
    if (!fullName) {
      const first = asString(pick(obj, "firstName"));
      const last = asString(pick(obj, "lastName"));
      if (first && last) fullName = `${first} ${last}`;
    }
    if (!fullName || seen.has(fullName)) continue;
    // Filter out non-athlete objects that happened to match (coaches lists
    // use similar shapes but carry role/title/coachType fields). Presence
    // of any such field — string, number, or nested object — disqualifies.
    if (pick(obj, "role", "title", "coachType") !== undefined) continue;
    seen.add(fullName);

    let position = asString(pick(obj, "position", "positionShort"));
    const positions = pick(obj, "positions");
    if (!position && Array.isArray(positions)) {
      position = positions.map((p) => asString(p) ?? "").filter(Boolean).join("/") || null;
    }

    const url = asString(pick(obj, "athleteUrl", "careerUrl", "canonicalUrl", "url"));
    entries.push({
      fullName,
      jerseyNumber: asString(pick(obj, "jersey", "jerseyNumber", "uniform", "number")),
      position,
      grade: normalizeGrade(asString(pick(obj, "grade", "gradeClass", "classYear", "year"))),
      athleteUrl: absoluteUrl(url),
    });
  }
  return entries;
}

// --------------------------------------------------------------------- dom

function parseFromDom(html: string): ParsedRosterEntry[] {
  const $ = cheerio.load(html);
  const entries: ParsedRosterEntry[] = [];
  const seen = new Set<string>();

  // Roster rows link to athlete pages (/athletes/ or /career/).
  $("a[href*='/athletes/'], a[href*='/career/']").each((_, el) => {
    const name = $(el).text().replace(/\s+/g, " ").trim();
    // Anchor text must look like a person's name, not "View Profile" etc.
    // First and last tokens start uppercase (interior caps like McKenna or
    // O'Brien are fine); middle tokens may be lowercase particles (van, de).
    if (
      !name ||
      !/^[A-Z][A-Za-z'.-]*(\s+[A-Za-z'.-]+)*\s+[A-Z][A-Za-z'.-]*$/.test(name)
    ) {
      return;
    }
    if (seen.has(name)) return;
    seen.add(name);

    const href = $(el).attr("href") || null;
    const row = $(el).closest("tr, li, [class*='row' i], [class*='card' i]");
    const text = (row.length ? row : $(el).parent()).text().replace(/\s+/g, " ").trim();

    const jersey = (text.match(/#\s?(\d{1,2})\b/) || text.match(/^(\d{1,2})\s/) || [])[1] ?? null;
    const gradeMatch = text.match(/\b(Fr|So|Jr|Sr|Freshman|Sophomore|Junior|Senior)\b\.?/i);
    // Full position words match case-insensitively; bare abbreviations only
    // as standalone UPPERCASE tokens so a stray "D" inside other prose (or a
    // lowercase "d") can't be mistaken for a position.
    const posMatch =
      text.match(/\b(Goalkeeper|Keeper|Defender|Defense|Midfielder|Midfield|Forward|Striker)\b/i) ||
      text.match(/(?:^|\s)(GK|D|MF?|FW?)(?:\s|$)/);

    entries.push({
      fullName: name,
      jerseyNumber: jersey,
      position: posMatch ? posMatch[1] : null,
      grade: gradeMatch ? normalizeGrade(gradeMatch[1]) : null,
      athleteUrl: absoluteUrl(href),
    });
  });

  return entries;
}

export function normalizeGrade(g: string | null): string | null {
  if (!g) return null;
  const map: Record<string, string> = {
    freshman: "Fr", fr: "Fr", "9": "Fr",
    sophomore: "So", so: "So", "10": "So",
    junior: "Jr", jr: "Jr", "11": "Jr",
    senior: "Sr", sr: "Sr", "12": "Sr",
  };
  return map[g.trim().toLowerCase().replace(/\.$/, "")] ?? g.trim();
}
