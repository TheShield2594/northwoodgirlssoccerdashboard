import { TEAM_TIMEZONE } from "../config.js";

/**
 * Date/time normalization shared by the schedule parsers.
 *
 * Two things make kickoff times easy to lose, and both cost us a whole
 * column of the schedule:
 *
 *   1. The time is usually not in a "time" field at all — it is the time
 *      component of the contest's datetime ("2025-08-16T17:30:00"). A parser
 *      that only reads `time`/`displayTime` throws it away.
 *   2. When the datetime carries a zone ("…T22:00:00Z"), the raw leading
 *      YYYY-MM-DD is the *UTC* date. For an evening game that is tomorrow's
 *      date, so the whole row lands on the wrong day.
 *
 * Everything here therefore resolves against the team's own timezone.
 */

/** Zone-aware date/time parts for a real instant. */
function partsInTeamZone(d: Date): { date: string; hour: number; minute: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // hourCycle h23 still renders midnight as "24" in some ICU versions.
    hour: parseInt(parts.hour, 10) % 24,
    minute: parts.minute,
  };
}

/** "2025-08-16T22:00:00Z" / "…-04:00" — an absolute instant, not a wall clock. */
const ZONED_ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;

/** "2025-08-16T17:30:00" — a wall clock already in local terms. */
const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/;

export function to12Hour(hour24: number, minute: string): string {
  const suffix = hour24 < 12 ? "am" : "pm";
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}:${minute}${suffix}`;
}

/**
 * The clock time carried by a datetime string, as display text ("7:15pm"),
 * or null when there isn't one.
 *
 * Exact midnight is treated as "no time given": feeds emit T00:00:00 for
 * date-only contests constantly, and showing every unscheduled game as
 * "12:00am" is worse than showing nothing.
 */
export function timeFromDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const zoned = text.match(ZONED_ISO);
  if (zoned) {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return null;
    const { hour, minute } = partsInTeamZone(d);
    if (hour === 0 && minute === "00") return null;
    return to12Hour(hour, minute);
  }

  const naive = text.match(NAIVE_ISO);
  if (naive && naive[4] !== undefined) {
    const hour = parseInt(naive[4], 10);
    if (hour > 23) return null;
    if (hour === 0 && naive[5] === "00") return null;
    return to12Hour(hour, naive[5]);
  }

  return null;
}

/**
 * The calendar date carried by a datetime string, resolved in the team's
 * timezone so a zoned evening kickoff doesn't roll onto the next day.
 * Returns null when `raw` isn't an ISO-ish datetime.
 */
export function dateFromDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const zoned = text.match(ZONED_ISO);
  if (zoned) {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return null;
    return partsInTeamZone(d).date;
  }

  const naive = text.match(NAIVE_ISO);
  return naive ? `${naive[1]}-${naive[2]}-${naive[3]}` : null;
}

// "7:15pm", "7:15 PM", "7:15 p.m." — minutes present, meridiem optional-ish.
const HH_MM_MERIDIEM = /(?<![\d:])(\d{1,2}):([0-5]\d)\s*([ap])(?:\.?\s?m\.?)?(?![a-z])/i;
// "7pm", "7 p.m." — no minutes, so the "m" is required. Without it a stat
// cell like "5 A" (five assists) would read as 5:00am.
const HH_MERIDIEM = /(?<![\d:.])(\d{1,2})\s*([ap])\.?\s?m\.?(?![a-z])/i;
// "19:15" — a bare 24-hour clock, unambiguous above 12 but accepted for all.
const HH_MM_24 = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/;

/**
 * Normalize any display time we scraped into one house format ("7:15pm").
 * Returns null for "TBA"/"TBD" and for anything that isn't a real clock
 * reading, so those stay NULL in the database rather than becoming a
 * plausible-looking wrong time.
 */
export function normalizeTimeText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text || /^(tba|tbd|n\/?a|-{1,2})$/i.test(text)) return null;

  // An ISO datetime that reached here (some feeds put one in `time`).
  const fromIso = timeFromDateTime(text);
  if (fromIso) return fromIso;

  let m = text.match(HH_MM_MERIDIEM);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 1 && h <= 12) return `${h}:${m[2]}${m[3].toLowerCase()}m`;
  }

  m = text.match(HH_MERIDIEM);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 1 && h <= 12) return `${h}:00${m[2].toLowerCase()}m`;
  }

  m = text.match(HH_MM_24);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h === 0 && m[2] === "00") return null;
    return to12Hour(h, m[2]);
  }

  return null;
}
