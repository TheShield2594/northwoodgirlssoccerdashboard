export type TeamLevel = "varsity" | "jv" | "freshman";

// The team's root page for each level. Varsity is the bare URL; the others
// live under a level segment. These are only the FALLBACK: the real list of
// levels and seasons is discovered from the site's own season picker (see
// parse/seasons.ts), which knows exactly which combinations exist.
const LEVEL_BASE: Record<TeamLevel, string> = {
  varsity: "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls",
  jv: "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/jv",
  freshman: "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/freshman",
};

// NorthWood fields a freshman squad as of 26-27. Levels that don't exist for
// a given season just 404 and are skipped, so listing all three is free.
export const TEAM_LEVELS: TeamLevel[] = ["varsity", "jv", "freshman"];

/** For validating a level discovered from the site against what we support. */
export const TEAM_LEVEL_SET: ReadonlySet<string> = new Set<string>(TEAM_LEVELS);

/** The varsity team's current-season home page — the one that carries the
 *  season picker every level and year is discovered from. */
export const teamHomeUrl = () => `${LEVEL_BASE.varsity}/`;

// The school-name hint used to tell NorthWood's tables/rows apart from the
// opponent's on match pages.
export const TEAM_NAME_HINT = "NorthWood";

// The mascot shows up in row text as often as the school name does, and an
// "opponent" matching either means the extraction grabbed the wrong side.
export const TEAM_MASCOT_HINT = "Panthers";

// Nappanee is in Indiana's Eastern-time zone. Kickoff datetimes that carry a
// UTC offset get resolved against this, so an evening game keeps its own
// calendar date instead of rolling forward with UTC.
export const TEAM_TIMEZONE = "America/Indiana/Indianapolis";

// Season slugs, current -> oldest, matching MaxPreps' URL scheme. The
// CURRENT season lives at the bare URL with no slug segment; historical
// seasons get the slug in the path. Girls soccer in Indiana is a fall
// sport, so the season starting in the fall of year Y is "Y-(Y+1)".
// A new slug becomes current on July 1 (MaxPreps rolls its "current
// season" over in the summer).
//
// These are FUNCTIONS, not constants, and that is load-bearing. The scraper
// runs as one long-lived process with a daily cron, so a value computed at
// import time is frozen for the container's whole life. A container started
// before July 1 would still call the old year "current" months later —
// and because the current season is the one served from the BARE url, that
// means fetching the new season's page and filing its games under the old
// season's row, while the new season never gets scraped at all.
//
export function currentSeasonStartYear(now = new Date()): number {
  const y = now.getFullYear() % 100;
  return now.getMonth() >= 6 ? y : y - 1; // July (month 6) or later = new season
}

function slugForStartYear(start: number): string {
  const end = (start + 1) % 100;
  return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`;
}

/** Every season slug, current -> oldest. e.g. ["26-27","25-26",...,"10-11"] */
export function seasonSlugs(now = new Date()): string[] {
  const slugs: string[] = [];
  for (let start = currentSeasonStartYear(now); start >= 10; start--) {
    slugs.push(slugForStartYear(start));
  }
  return slugs;
}

export function currentSeasonSlug(now = new Date()): string {
  return slugForStartYear(currentSeasonStartYear(now));
}

/** The season just ended. Still worth scraping daily for a while: box scores
 *  and final stat lines get entered days after the last whistle, and it
 *  covers the window where the new season's page doesn't exist yet. */
export function previousSeasonSlug(now = new Date()): string {
  return slugForStartYear(currentSeasonStartYear(now) - 1);
}

function pageUrl(level: TeamLevel, seasonSlug: string, page: string): string {
  const base = LEVEL_BASE[level];
  return seasonSlug === currentSeasonSlug()
    ? `${base}/${page}/`
    : `${base}/${seasonSlug}/${page}/`;
}

export const scheduleUrl = (l: TeamLevel, s: string) => pageUrl(l, s, "schedule");
export const rosterUrl = (l: TeamLevel, s: string) => pageUrl(l, s, "roster");
export const statsUrl = (l: TeamLevel, s: string) => pageUrl(l, s, "stats");

export const HTTP_HEADERS = {
  // A normal desktop UA. This is a personal, low-frequency job (daily
  // cron), not a crawler hammering the site — keep it that way.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

// Delay between live requests, in ms. Generous on purpose: with 2 levels x
// ~17 seasons x 3 pages plus box scores, a full backfill takes a few
// minutes, which is the right trade for staying polite.
export const REQUEST_DELAY_MS = 1500;
