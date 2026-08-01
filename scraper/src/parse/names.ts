/**
 * Player-name normalization, shared by every parser.
 *
 * Players are keyed by `full_name` in the database (see db/schema.sql), so
 * the roster page, the stats page and box scores must all spell a player the
 * same way or she splits into two people. MaxPreps has shipped names both as
 * "Avery Miller" and as "Miller, Avery", sometimes on different pages of the
 * same season — normalizing here is what keeps those joined.
 */

/** Two capitalized words is also the shape of "View Profile"/"Full Roster". */
const UI_WORDS =
  /\b(view|profile|roster|schedule|stats|standings|rankings|photos?|more|full|team|varsity|coach|staff|home|away|next|previous|season)\b/i;

/** First and last tokens start uppercase (interior caps like McKenna or
 *  O'Brien are fine); middle tokens may be lowercase particles (van, de). */
const PERSON_NAME = /^\p{Lu}[\p{L}'’.-]*(\s+[\p{L}'’.-]+)*\s+\p{Lu}[\p{L}'’.-]*$/u;

/** Strip decorations a name cell carries: jersey number, trailing grade. */
export function cleanNameCell(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#?\s*\d{1,2}\s+/, "")
    .replace(/#\s?\d{1,2}\s*$/, "")
    .replace(/\s+(Fr|So|Jr|Sr)\.?$/i, "")
    .trim();
}

/** "Miller, Avery" -> "Avery Miller"; anything already in given-name order
 *  is returned unchanged. */
export function toGivenNameOrder(name: string): string {
  // The surname side allows spaces so particled names ("van Dyke, Ruby")
  // survive; exactly one comma, so "Smith, A., Jones, B." is left alone.
  const comma = name.match(/^([\p{L}'’. -]+),\s*([\p{L}'’. -]+)$/u);
  return comma ? `${comma[2].trim()} ${comma[1].trim()}` : name;
}

/**
 * A cell's text as a canonical "First Last", or null when it isn't a
 * person's name. Use where a false positive is worse than a miss (link text,
 * roster rows); use `cleanNameCell` + `toGivenNameOrder` directly where the
 * cell is known to hold a name and dropping it would lose a stat line.
 */
export function normalizePlayerName(raw: string): string | null {
  const cleaned = cleanNameCell(raw);
  if (!cleaned) return null;
  const name = toGivenNameOrder(cleaned);
  if (!PERSON_NAME.test(name)) return null;
  if (UI_WORDS.test(name)) return null;
  return name;
}
