import * as cheerio from "cheerio";
import { cleanNameCell, normalizePlayerName, toGivenNameOrder } from "./names.js";
import {
  ParseSource,
  absoluteUrl,
  asString,
  deepFindObjects,
  extractJsonSources,
  pick,
} from "./nextdata.js";

export interface ParsedRosterEntry {
  fullName: string;
  jerseyNumber: string | null;
  position: string | null;
  grade: string | null; // 'Fr' | 'So' | 'Jr' | 'Sr' or whatever the page shows
  athleteUrl: string | null;
}

export interface RosterParseResult {
  entries: ParsedRosterEntry[];
  source: ParseSource;
  /**
   * How many athletes the page itself says it has, when it says so.
   *
   * MaxPreps ships a `countData.athleteCount` alongside the roster. It is the
   * difference between the two ways a roster comes back empty: 0 means the
   * coach has not entered a roster yet (a 26-27 page in August legitimately
   * has none), while a positive number we failed to match means the parser
   * is broken. Without it, both look identical in the logs.
   */
  expectedCount: number | null;
}

/** Parse a MaxPreps roster page: every embedded-JSON layer first, then the
 *  DOM table fallback. */
export function parseRosterPage(html: string): RosterParseResult {
  const sources = extractJsonSources(html);

  let expectedCount: number | null = null;
  for (const { root } of sources) {
    expectedCount = findAthleteCount(root);
    if (expectedCount !== null) break;
  }

  for (const { kind, root } of sources) {
    const entries = parseFromNextData(root);
    if (entries.length > 0) return { entries, source: kind, expectedCount };
  }
  const entries = parseFromDom(html);
  return { entries, source: entries.length > 0 ? "dom" : "none", expectedCount };
}

/** The page's own athlete tally, from its `countData` block. */
function findAthleteCount(root: unknown): number | null {
  const found = deepFindObjects(root, (obj) => {
    const v = pick(obj, "athleteCount");
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
  });
  return found.length > 0 ? (pick(found[0].value, "athleteCount") as number) : null;
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

/** One list, used by both the JSON filter and the table-row filter — they
 *  drifted apart, so "Statistician" was dropped from JSON but kept in HTML. */
const STAFF_TITLE = /coach|manager|trainer|director|staff|statistician/i;

/** A staff-ish word in a role/title/position value means this isn't a player. */
function looksLikeStaff(obj: Record<string, unknown>): boolean {
  for (const key of ["role", "title", "coachType", "jobTitle", "position", "staffType"]) {
    const value = asString(pick(obj, key));
    if (value && STAFF_TITLE.test(value)) return true;
  }
  return false;
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
    // JSON is trusted enough to keep even an odd-looking name, but the
    // ORDER still has to be canonical so it joins to the stats pages.
    if (fullName) fullName = toGivenNameOrder(cleanNameCell(fullName));
    if (!fullName || seen.has(fullName)) continue;
    // Filter out non-athlete objects that happened to match — coaches and
    // staff use the same shape. Judge the VALUE, not the presence of the
    // key: athlete records routinely carry an SEO `title`, and treating any
    // `title` as a coach marker drops the entire roster.
    if (looksLikeStaff(obj)) continue;
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
  const fromLinks = parseRosterLinks($);
  // A roster page whose names stopped being links still renders a table.
  return fromLinks.length > 0 ? fromLinks : parseRosterTable($);
}

function parseRosterLinks($: cheerio.CheerioAPI): ParsedRosterEntry[] {
  const entries: ParsedRosterEntry[] = [];
  const seen = new Set<string>();

  // Roster rows link to athlete pages, under any of the URL shapes MaxPreps
  // has used for them.
  $(
    "a[href*='/athletes/'], a[href*='/athlete/'], a[href*='/career/'], a[href*='careerid=']"
  ).each((_, el) => {
    const name = normalizePlayerName($(el).text());
    if (!name || seen.has(name)) return;
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

/**
 * Header-driven table fallback, for a roster whose player names are plain
 * text rather than links. Columns are located by their header, so column
 * order can change without breaking anything.
 */
function parseRosterTable($: cheerio.CheerioAPI): ParsedRosterEntry[] {
  const entries: ParsedRosterEntry[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    const $table = $(table);
    let headers = $table
      .find("thead th, thead td")
      .map((__, th) => $(th).text().trim().toUpperCase())
      .get();
    // Remember which row the headers came from when there's no <thead>: the
    // row loop below walks every <tr>, and a header row built from <td> cells
    // would otherwise be read as a player ("Player Name" passes as a name).
    let headerRow: unknown = null;
    if (headers.length === 0) {
      const first = $table.find("tr").first();
      headerRow = first.get(0) ?? null;
      headers = first
        .find("th, td")
        .map((__, c) => $(c).text().trim().toUpperCase())
        .get();
    }

    const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
    const nameIdx = find(/^(NAME|PLAYER|ATHLETE)S?$|NAME/);
    if (nameIdx === -1) return;
    const numIdx = find(/^#$|^NO\.?$|JERSEY|NUMBER|^UNI/);
    const gradeIdx = find(/GRADE|^YR$|YEAR|CLASS|^GR$/);
    const posIdx = find(/^POS|POSITION/);

    $table.find("tbody tr, tr").each((__, tr) => {
      if (headerRow !== null && tr === headerRow) return;
      const cells = $(tr)
        .find("td")
        .map((___, td) => $(td).text().replace(/\s+/g, " ").trim())
        .get();
      if (cells.length <= nameIdx) return;

      const name = normalizePlayerName(cells[nameIdx]);
      if (!name || seen.has(name)) return;
      const rowText = cells.join(" ");
      if (STAFF_TITLE.test(rowText)) return;
      seen.add(name);

      const href = $(tr).find("a[href]").first().attr("href") || null;
      const jerseyCell = numIdx >= 0 ? cells[numIdx] : "";
      const jersey =
        (jerseyCell.match(/\d{1,2}/) || cells[nameIdx].match(/#\s?(\d{1,2})/) || [])[0] ?? null;

      entries.push({
        fullName: name,
        jerseyNumber: jersey ? jersey.replace(/^#\s?/, "") : null,
        position: posIdx >= 0 && cells[posIdx] ? cells[posIdx] : null,
        grade: gradeIdx >= 0 ? normalizeGrade(cells[gradeIdx] ?? null) : null,
        athleteUrl: absoluteUrl(href),
      });
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
