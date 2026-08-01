import { asString, deepFindObjects, extractJsonSources, pick } from "./nextdata.js";

/**
 * Read the season picker MaxPreps embeds in every team page, rather than
 * guessing which season/level combinations exist.
 *
 * Guessing was the source of two separate bugs. Slugs generated from a
 * calendar formula have to decide which season is "current", because only the
 * current one is served from the bare URL — get that wrong and the new
 * season's page is fetched and stored under the old season's row. And a
 * hardcoded level list silently misses a squad the school adds (NorthWood
 * fielded a freshman team in 26-27).
 *
 * The picker states all of it as fact: every level, every year, and the
 * canonical URL for each. `pageUrlFor` derives the schedule/roster/stats
 * URLs from that, so the bare-vs-slugged distinction stops mattering.
 */
export interface DiscoveredSeason {
  level: string; // 'varsity' | 'jv' | 'freshman'
  seasonSlug: string; // '26-27'
  baseUrl: string; // '…/soccer/girls/' or '…/soccer/girls/25-26/'
  isPublished: boolean;
}

const SEASON_SLUG = /^\d{2}-\d{2}$/;

/** A picker entry names a year, a level, and where to find that team. */
function looksLikeSeasonEntry(obj: Record<string, unknown>): boolean {
  const year = asString(pick(obj, "year"));
  if (!year || !SEASON_SLUG.test(year)) return false;
  if (asString(pick(obj, "teamLevel", "level")) === null) return false;
  return asString(pick(obj, "canonicalUrl")) !== null;
}

export function parseSeasonPicker(html: string): DiscoveredSeason[] {
  const seasons: DiscoveredSeason[] = [];
  const seen = new Set<string>();

  for (const { root } of extractJsonSources(html)) {
    for (const { value: obj } of deepFindObjects(root, looksLikeSeasonEntry)) {
      const seasonSlug = asString(pick(obj, "year"))!;
      const level = asString(pick(obj, "teamLevel", "level"))!.toLowerCase();
      const canonicalUrl = asString(pick(obj, "canonicalUrl"))!;

      const key = `${level}:${seasonSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      seasons.push({
        level,
        seasonSlug,
        // Entries point at either the team home ('…/girls/jv/') or a specific
        // page ('…/girls/jv/25-26/schedule/'); normalize to the directory
        // both forms share.
        // Anchored on the leading slash so a segment like "team-stats" keeps
        // its prefix; an optional extension covers "…/schedule.aspx".
        baseUrl: canonicalUrl.replace(/\/(schedule|roster|stats)(\.[a-z]+)?\/?$/i, "/"),
        // Absent means published — only the picker's own entries carry it.
        isPublished: pick(obj, "isPublished") !== false,
      });
    }
    if (seasons.length > 0) break;
  }

  return seasons;
}

/** '…/girls/25-26/' + 'roster' -> '…/girls/25-26/roster/' */
export function pageUrlFor(season: DiscoveredSeason, page: string): string {
  const base = season.baseUrl.endsWith("/") ? season.baseUrl : `${season.baseUrl}/`;
  return `${base}${page}/`;
}
