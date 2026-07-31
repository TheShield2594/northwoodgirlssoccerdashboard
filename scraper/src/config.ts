export type TeamLevel = "varsity" | "jv";

// The team's root page for each level. Varsity is the bare URL; JV lives
// under a /jv/ segment. If NorthWood ever fields a freshman squad, add
// "freshman" here and to TEAM_LEVELS — everything downstream treats level
// as data, not a hardcoded pair.
const LEVEL_BASE: Record<TeamLevel, string> = {
  varsity: "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls",
  jv: "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/jv",
};

export const TEAM_LEVELS: TeamLevel[] = ["varsity", "jv"];

// The school-name hint used to tell NorthWood's tables/rows apart from the
// opponent's on match pages.
export const TEAM_NAME_HINT = "NorthWood";

// Season slugs, current -> oldest, matching MaxPreps' URL scheme. The
// CURRENT season lives at the bare URL with no slug segment; historical
// seasons get the slug in the path. Girls soccer in Indiana is a fall
// sport, so the season starting in the fall of year Y is "Y-(Y+1)".
// A new slug becomes current on July 1 (MaxPreps rolls its "current
// season" over in the summer).
function currentSeasonStartYear(now = new Date()): number {
  const y = now.getFullYear() % 100;
  return now.getMonth() >= 6 ? y : y - 1; // July (month 6) or later = new season
}

function buildSeasonSlugs(): string[] {
  const slugs: string[] = [];
  for (let start = currentSeasonStartYear(); start >= 10; start--) {
    const end = (start + 1) % 100;
    slugs.push(`${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`);
  }
  return slugs;
}

export const SEASON_SLUGS = buildSeasonSlugs(); // e.g. ["26-27","25-26",...,"10-11"]
export const CURRENT_SEASON_SLUG = SEASON_SLUGS[0];

function pageUrl(level: TeamLevel, seasonSlug: string, page: string): string {
  const base = LEVEL_BASE[level];
  return seasonSlug === CURRENT_SEASON_SLUG
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
