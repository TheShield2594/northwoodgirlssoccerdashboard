import * as cheerio from "cheerio";
import { domText } from "./domtext.js";
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

/** Which extraction actually produced the entries — `source` only says which
 *  JSON layer was read, and "nextdata" covered both the real athlete tuples
 *  and the shape-guessing fallback, so a bad run couldn't be told from a good
 *  one in the logs. */
export type RosterStrategy = "tuples" | "objects" | "dom" | "none";

export interface RosterParseResult {
  entries: ParsedRosterEntry[];
  source: ParseSource;
  strategy: RosterStrategy;
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

/**
 * The page's own `countData` block: how many athletes it claims, and the ids
 * of the exact team-season it is showing. Both ids matter — `athleteData`
 * carries them on every row, which is what lets us keep only the rows that
 * belong to THIS page (see `parseAthleteTuples`).
 */
interface RosterScope {
  athleteCount: number | null;
  teamId: string | null;
  sportSeasonId: string | null;
}

/** Parse a MaxPreps roster page: every embedded-JSON layer first, then the
 *  DOM table fallback. */
export function parseRosterPage(html: string): RosterParseResult {
  const sources = extractJsonSources(html);

  let scope: RosterScope = { athleteCount: null, teamId: null, sportSeasonId: null };
  for (const { root } of sources) {
    scope = findRosterScope(root);
    if (scope.athleteCount !== null) break;
  }
  const expectedCount = scope.athleteCount;

  // The page states its own athlete count, so a 0 is an answer, not a gap.
  // Running the shape-guessing fallbacks anyway is how "no roster yet" pages
  // ended up importing four or five players: the breadcrumb trail
  // ("MaxPreps.com", "Girls Soccer", "NorthWood", …) is a schema.org
  // ItemList whose entries carry a `name` and a `position`, which is exactly
  // what a roster entry looks like from the outside.
  if (expectedCount === 0) {
    return { entries: [], source: "none", strategy: "none", expectedCount };
  }

  for (const { kind, root } of sources) {
    // MaxPreps' own shape first: positional athlete tuples (see below).
    const tuples = parseAthleteTuples(root, scope);
    if (tuples.length > 0) {
      return { entries: tuples, source: kind, strategy: "tuples", expectedCount };
    }
    const entries = parseFromNextData(root);
    if (entries.length > 0) {
      return { entries, source: kind, strategy: "objects", expectedCount };
    }
  }
  const entries = parseFromDom(html);
  return {
    entries,
    source: entries.length > 0 ? "dom" : "none",
    strategy: entries.length > 0 ? "dom" : "none",
    expectedCount,
  };
}

/** The page's own `countData` block. */
function findRosterScope(root: unknown): RosterScope {
  const found = deepFindObjects(root, (obj) => {
    const v = pick(obj, "athleteCount");
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
  });
  if (found.length === 0) return { athleteCount: null, teamId: null, sportSeasonId: null };
  const obj = found[0].value;
  return {
    athleteCount: pick(obj, "athleteCount") as number,
    teamId: asString(pick(obj, "teamId")),
    sportSeasonId: asString(pick(obj, "sportSeasonId")),
  };
}

// ------------------------------------------------------------ athlete tuples

/**
 * `pageProps.athleteData` is an array of positional ARRAYS, the same as the
 * schedule's contests. It has no `name`, `jersey`, `position` or `grade` key,
 * so the object-shaped predicate below never saw a single player — the four
 * entries a run used to report came from unrelated objects elsewhere in the
 * payload that happened to fit the shape.
 *
 * Everything needed sits at a fixed offset from the athlete's profile url:
 *
 *   +0 url   +1 positions   +2 full name   +3 height   +4 height (in)   +5 grade
 *
 * The jersey is far earlier in the row, but it always directly follows the
 * numeric grade (9-12), which is a reliable enough pair to find on its own.
 */
const ATHLETE_URL = /\/athletes\/[^/]+\/?\?careerid=/i;

/** "GK, GK, GK" -> "GK"; "MF, D, D" -> "MF/D". MaxPreps repeats a player's
 *  primary position across all three slots when only one is set. */
function readPositions(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join("/") : null;
}

/**
 * The jersey is the digit string immediately after the numeric grade. A height
 * or weight could in principle form the same number-then-digit-string pair, so
 * the numeric grade must also agree with the athlete's textual one — 10 next
 * to "So." is the real pair, 11 next to "So." is a coincidence.
 */
function readJersey(row: unknown[], grade: string | null): string | null {
  for (let i = 0; i < row.length - 1; i++) {
    const gradeNum = row[i];
    const jersey = row[i + 1];
    if (
      typeof gradeNum === "number" &&
      Number.isInteger(gradeNum) &&
      gradeNum >= 9 &&
      gradeNum <= 12 &&
      typeof jersey === "string" &&
      /^\d{1,2}$/.test(jersey) &&
      (grade === null || normalizeGrade(String(gradeNum)) === grade)
    ) {
      return jersey;
    }
  }
  return null;
}

function readAthleteRow(row: unknown[]): ParsedRosterEntry | null {
  const at = row.findIndex((v) => typeof v === "string" && ATHLETE_URL.test(v));
  if (at === -1) return null;
  const fullName = row[at + 2];
  if (typeof fullName !== "string" || fullName.trim() === "") return null;
  const grade = normalizeGrade(typeof row[at + 5] === "string" ? (row[at + 5] as string) : null);

  return {
    fullName: toGivenNameOrder(cleanNameCell(fullName)),
    jerseyNumber: readJersey(row, grade),
    position: readPositions(row[at + 1]),
    grade,
    athleteUrl: absoluteUrl(row[at] as string),
  };
}

/**
 * Every athlete row carries the team and sport-season it belongs to, as the
 * same two guids the page publishes in `countData`:
 *
 *   … , teamId, sportSeasonId, null, …, url, positions, name, …
 *
 * They are load-bearing. `athleteData` is not always just this page's roster
 * — on several past seasons it came back with substantially more rows than
 * the page's own `athleteCount`, which is how 24-25 imported 38 players for
 * a 23-player team. Matching both ids keeps the rows this page is actually
 * about and drops whatever else is riding along. The check is by value, not
 * by index, so it survives a column being added to the tuple.
 */
function rowBelongsTo(row: unknown[], scope: RosterScope): boolean {
  if (scope.teamId === null && scope.sportSeasonId === null) return true; // nothing to check against
  for (const id of [scope.teamId, scope.sportSeasonId]) {
    if (id !== null && !row.includes(id)) return false;
  }
  return true;
}

export function parseAthleteTuples(
  root: unknown,
  scope: RosterScope = { athleteCount: null, teamId: null, sportSeasonId: null }
): ParsedRosterEntry[] {
  const entries: ParsedRosterEntry[] = [];
  const seen = new Set<string>();
  let outOfScope = 0;

  for (const { value } of deepFindObjects(root, (o) => Array.isArray(pick(o, "athleteData")))) {
    for (const row of pick(value, "athleteData") as unknown[]) {
      if (!Array.isArray(row)) continue;
      if (!rowBelongsTo(row, scope)) {
        outOfScope++;
        continue;
      }
      const entry = readAthleteRow(row);
      if (entry && !seen.has(entry.fullName)) {
        seen.add(entry.fullName);
        entries.push(entry);
      }
    }
  }

  // Silence here would hide a scope filter that had started eating the real
  // roster (say, if MaxPreps stopped stamping the ids on each row).
  if (outOfScope > 0) {
    console.log(
      `[roster] ignored ${outOfScope} athlete row(s) belonging to another team-season`
    );
  }
  return entries;
}

// ---------------------------------------------------------------- nextdata

/**
 * Structured-data nodes are not roster rows, however much they look like one.
 *
 * Every MaxPreps page embeds a schema.org BreadcrumbList, and each of its
 * crumbs is `{"@type":"ListItem","name":"NorthWood","item":…,"position":3}`.
 * A `name` plus a `position` is precisely the roster shape, so the crumbs
 * were being imported as players — four of them on a varsity page, five on a
 * JV page (the extra level segment), on every season whose real roster came
 * back empty. `@type` is the tell: no athlete record carries one.
 */
function isStructuredData(obj: Record<string, unknown>): boolean {
  return "@type" in obj || "@context" in obj;
}

/** A roster entry has a person-name shape plus at least one athlete field. */
function looksLikeRosterEntry(obj: Record<string, unknown>): boolean {
  if (isStructuredData(obj)) return false;
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
    // Same concatenation hazard as the schedule rows: "#9" and "Sr" sit in
    // their own elements, and .text() would glue them to their neighbours.
    const text = domText($, row.length ? row : $(el).parent());

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
