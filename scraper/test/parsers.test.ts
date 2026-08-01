import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchedulePage, normalizeDate, resolveGameDate } from "../src/parse/schedule.js";
import { parseRosterPage } from "../src/parse/roster.js";
import { normalizePlayerName } from "../src/parse/names.js";
import { currentSeasonSlug, previousSeasonSlug, seasonSlugs } from "../src/config.js";
import { pageUrlFor, parseSeasonPicker } from "../src/parse/seasons.js";
import { normalizeTimeText, timeFromDateTime } from "../src/parse/datetime.js";
import { parseStatsPage, parseTablesFromDom } from "../src/parse/stats.js";
import { parseBoxScorePage } from "../src/parse/boxscore.js";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("schedule parser — __NEXT_DATA__ layer", () => {
  const { games, source } = parseSchedulePage(fixture("schedule-nextdata.html"), "25-26");

  it("uses the nextdata layer and finds all contests", () => {
    expect(source).toBe("nextdata");
    expect(games).toHaveLength(3);
  });

  it("parses a result-string game (W 8-0, home)", () => {
    const g = games.find((g) => g.opponent === "Lakeland")!;
    expect(g.isoDate).toBe("2025-08-16");
    expect(g.homeAway).toBe("home");
    expect(g.result).toBe("W");
    expect(g.teamScore).toBe(8);
    expect(g.opponentScore).toBe(0);
    expect(g.matchUrl).toMatch(/^https:\/\/www\.maxpreps\.com\/games/);
  });

  it("parses explicit score fields and conference flag (@ Warsaw)", () => {
    const g = games.find((g) => g.opponent === "Warsaw")!;
    expect(g.homeAway).toBe("away");
    expect(g.isConference).toBe(true);
    expect(g.result).toBe("L");
    expect(g.teamScore).toBe(1);
    expect(g.opponentScore).toBe(2);
  });

  it("parses an unplayed playoff game with no score", () => {
    const g = games.find((g) => g.opponent === "Penn")!;
    expect(g.result).toBeNull();
    expect(g.teamScore).toBeNull();
    expect(g.isPlayoff).toBe(true);
    expect(g.homeAway).toBe("neutral");
  });
});

describe("schedule parser — DOM fallback layer", () => {
  const { games, source } = parseSchedulePage(fixture("schedule-dom.html"), "25-26");

  it("falls back to DOM when there is no __NEXT_DATA__", () => {
    expect(source).toBe("dom");
    expect(games).toHaveLength(3);
  });

  it("dedupes multiple links to the same match", () => {
    const urls = games.map((g) => g.matchUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("parses scores, home/away, and the conference asterisk", () => {
    const warsaw = games.find((g) => g.opponent === "Warsaw")!;
    expect(warsaw.homeAway).toBe("away");
    expect(warsaw.result).toBe("L");
    expect(warsaw.teamScore).toBe(1);
    expect(warsaw.opponentScore).toBe(2);
    expect(warsaw.isConference).toBe(true);
  });

  it("leaves unplayed games without a result and flags playoffs", () => {
    const penn = games.find((g) => g.opponent === "Penn")!;
    expect(penn.result).toBeNull();
    expect(penn.isPlayoff).toBe(true);
  });
});

describe("schedule parser — cells with no whitespace between them", () => {
  const { games } = parseSchedulePage(fixture("schedule-dom-nowhitespace.html"), "19-20");

  it("does not run a date cell into the next cell (9/5 + 6-2, not 9/56)", () => {
    const goshen = games.find((g) => g.opponent === "Goshen")!;
    expect(goshen.isoDate).toBe("2019-09-05");
    expect(goshen.teamScore).toBe(6);
    expect(goshen.opponentScore).toBe(2);
    expect(goshen.result).toBe("W");
  });

  it("does not run a date cell into a time cell (9/12 + 7:15pm, not 27:15pm)", () => {
    const concord = games.find((g) => g.opponent === "Concord")!;
    expect(concord.isoDate).toBe("2019-09-12");
    expect(concord.timeText).toBe("7:15pm");
    expect(concord.homeAway).toBe("away");
    expect(concord.isConference).toBe(true);
  });

  it("drops a game whose date is not a real calendar day (2/30)", () => {
    expect(games.map((g) => g.opponent)).toEqual(["Goshen", "Concord"]);
    expect(games.every((g) => !Number.isNaN(Date.parse(`${g.isoDate}T00:00:00Z`)))).toBe(true);
  });

  it("never emits an out-of-range day or hour for any parsed game", () => {
    for (const g of games) {
      const [, , day] = g.isoDate.split("-").map(Number);
      expect(day).toBeLessThanOrEqual(31);
      if (g.timeText) expect(parseInt(g.timeText, 10)).toBeLessThanOrEqual(12);
    }
  });
});

describe("roster parser", () => {
  const { entries, source } = parseRosterPage(fixture("roster-nextdata.html"));

  it("finds athletes via nextdata and skips coaches", () => {
    expect(source).toBe("nextdata");
    expect(entries.map((e) => e.fullName).sort()).toEqual(["Avery Miller", "Quinn Roswell"]);
  });

  it("normalizes grades and joins position arrays", () => {
    const avery = entries.find((e) => e.fullName === "Avery Miller")!;
    expect(avery.grade).toBe("Sr");
    expect(avery.jerseyNumber).toBe("9");
    const quinn = entries.find((e) => e.fullName === "Quinn Roswell")!;
    expect(quinn.grade).toBe("Jr");
    expect(quinn.position).toBe("GK");
    expect(quinn.jerseyNumber).toBe("1");
  });
});

describe("stats table parser (DOM)", () => {
  const result = parseStatsPage(fixture("stats-dom.html"));

  it("parses field-player and goalkeeper tables, skipping Totals rows", () => {
    expect(result.source).toBe("dom");
    const names = result.lines.map((l) => l.playerName).sort();
    expect(names).toEqual(["Avery Miller", "Kai Bennett", "Quinn Roswell"]);
  });

  it("maps headers through STAT_COLUMN_MAP and strips grade suffixes", () => {
    const avery = result.lines.find((l) => l.playerName === "Avery Miller")!;
    expect(avery.stats.goals).toBe(14);
    expect(avery.stats.assists).toBe(5);
    expect(avery.stats.points).toBe(33);
    expect(avery.stats.shots_on_goal).toBe(41);
    expect(avery.stats.games_played).toBe(18);
  });

  it("parses the keeper table", () => {
    const quinn = result.lines.find((l) => l.playerName === "Quinn Roswell")!;
    expect(quinn.stats.saves).toBe(61);
    expect(quinn.stats.goals_against).toBe(19);
    expect(quinn.stats.shutouts).toBe(6);
  });

  it("reports unmapped headers instead of guessing", () => {
    expect(result.unmappedHeaders).toContain("XYZ");
  });

  it("filters to the named team's tables when a hint is given", () => {
    const filtered = parseTablesFromDom(fixture("stats-dom.html"), "SomeOtherSchool");
    expect(filtered.lines).toHaveLength(0);
  });

  it("keeps tables when the hint matches, case-insensitively", () => {
    const matched = parseTablesFromDom(fixture("stats-dom.html"), "NORTHWOOD");
    expect(matched.lines.length).toBeGreaterThan(0);
  });
});

describe("box score parser — __NEXT_DATA__ layer", () => {
  const result = parseBoxScorePage(fixture("boxscore-nextdata.html"), "NorthWood");

  it("returns only our team's players, not the opponent's", () => {
    expect(result.source).toBe("nextdata");
    expect(result.lines.map((l) => l.playerName).sort()).toEqual([
      "Avery Miller",
      "Kai Bennett",
      "Quinn Roswell",
    ]);
  });

  it("maps JSON stat fields for field players and keepers", () => {
    const avery = result.lines.find((l) => l.playerName === "Avery Miller")!;
    expect(avery.stats.goals).toBe(2);
    expect(avery.stats.shots).toBe(5);
    const quinn = result.lines.find((l) => l.playerName === "Quinn Roswell")!;
    expect(quinn.stats.saves).toBe(6);
    expect(quinn.stats.goals_against).toBe(1);
  });
});

describe("box score parser — DOM fallback layer", () => {
  const result = parseBoxScorePage(fixture("boxscore-dom.html"), "NorthWood");

  it("parses only the section belonging to our team", () => {
    expect(result.source).toBe("dom");
    expect(result.lines.map((l) => l.playerName).sort()).toEqual(["Avery Miller", "Kai Bennett"]);
  });

  it("keeps jersey numbers and skips the Totals row", () => {
    const avery = result.lines.find((l) => l.playerName === "Avery Miller")!;
    expect(avery.jerseyNumber).toBe("9");
    expect(avery.stats.goals).toBe(2);
  });
});

describe("date helpers", () => {
  it("resolves fall-sport short dates against the season", () => {
    expect(resolveGameDate("25-26", "8/18")).toBe("2025-08-18");
    expect(resolveGameDate("25-26", "3/2")).toBe("2026-03-02");
  });
  it("normalizes ISO, US, and short date formats", () => {
    expect(normalizeDate("2025-08-18T19:15:00", "25-26")).toBe("2025-08-18");
    expect(normalizeDate("8/18/2025", "25-26")).toBe("2025-08-18");
    expect(normalizeDate("8/18", "25-26")).toBe("2025-08-18");
    expect(normalizeDate("garbage", "25-26")).toBeNull();
  });
});

describe("schedule parser — App Router flight payload", () => {
  const { games, source } = parseSchedulePage(fixture("schedule-flight.html"), "25-26");

  it("reads page data when there is no __NEXT_DATA__ at all", () => {
    expect(source).toBe("flight");
    expect(games).toHaveLength(3);
  });

  it("reassembles a contest split across two push() chunks", () => {
    const g = games.find((g) => g.opponent === "Lakeland")!;
    expect(g.matchUrl).toContain("lakeland-vs-northwood.htm?c=f-1");
    expect(g.result).toBe("W");
    expect(g.teamScore).toBe(8);
  });

  it("takes the kickoff time from the contest datetime", () => {
    expect(games.find((g) => g.opponent === "Lakeland")!.timeText).toBe("5:30pm");
  });

  it("resolves a zoned datetime in the team's timezone, not UTC", () => {
    // 2025-08-22T00:15Z is 8:15pm on the 21st in Indiana — the naive read
    // would file this game a day late with no time at all.
    const g = games.find((g) => g.opponent.startsWith("Warsaw"))!;
    expect(g.isoDate).toBe("2025-08-21");
    expect(g.timeText).toBe("8:15pm");
  });

  it("treats midnight as 'no time given' rather than 12:00am", () => {
    const g = games.find((g) => g.opponent === "Penn")!;
    expect(g.isoDate).toBe("2025-10-09");
    expect(g.timeText).toBeNull();
  });

  it("is not confused by a bracket inside a JSON string", () => {
    expect(games.map((g) => g.opponent)).toContain("Warsaw [not a bracket bug]");
  });
});

describe("schedule parser — kickoff times in the DOM fallback", () => {
  const { games } = parseSchedulePage(fixture("schedule-dom.html"), "25-26");

  it("keeps the times the rows show", () => {
    expect(games.some((g) => g.timeText !== null)).toBe(true);
  });
});

describe("time normalization", () => {
  it("accepts the display formats MaxPreps prints", () => {
    expect(normalizeTimeText("7:15pm")).toBe("7:15pm");
    expect(normalizeTimeText("7:15 PM")).toBe("7:15pm");
    expect(normalizeTimeText("7:15 p.m.")).toBe("7:15pm");
    expect(normalizeTimeText("7 pm")).toBe("7:00pm");
    expect(normalizeTimeText("10:00AM")).toBe("10:00am");
    expect(normalizeTimeText("19:15")).toBe("7:15pm");
  });

  it("returns null rather than inventing a time", () => {
    expect(normalizeTimeText("TBA")).toBeNull();
    expect(normalizeTimeText("TBD")).toBeNull();
    expect(normalizeTimeText("")).toBeNull();
    expect(normalizeTimeText(null)).toBeNull();
    // "5 A" is five assists, and "Sep 5 at Penn" is a fixture line — neither
    // is 5:00am.
    expect(normalizeTimeText("5 A")).toBeNull();
    expect(normalizeTimeText("Sep 5 at Penn")).toBeNull();
    expect(normalizeTimeText("W 8-0")).toBeNull();
  });

  it("pulls the clock out of a datetime", () => {
    expect(timeFromDateTime("2025-08-16T17:30:00")).toBe("5:30pm");
    expect(timeFromDateTime("2025-08-16T00:00:00")).toBeNull();
    expect(timeFromDateTime("2025-08-16")).toBeNull();
    expect(timeFromDateTime("not a date")).toBeNull();
  });
});

describe("roster parser — App Router flight payload", () => {
  const { entries, source } = parseRosterPage(fixture("roster-flight.html"));

  it("imports the roster when there is no __NEXT_DATA__", () => {
    expect(source).toBe("flight");
    expect(entries).toHaveLength(2);
  });

  it("keeps an athlete that carries an SEO title", () => {
    const avery = entries.find((e) => e.fullName === "Avery Miller")!;
    expect(avery).toBeDefined();
    expect(avery.jerseyNumber).toBe("9");
    expect(avery.grade).toBe("Sr");
  });

  it("still drops the coach", () => {
    expect(entries.map((e) => e.fullName)).not.toContain("Dana Whitfield");
  });
});

describe("roster parser — plain table, surname-first names", () => {
  const { entries, source } = parseRosterPage(fixture("roster-dom-table.html"));

  it("reads a roster whose names are not links", () => {
    expect(source).toBe("dom");
    expect(entries).toHaveLength(3);
  });

  it("flips 'Miller, Avery' into 'Avery Miller'", () => {
    const avery = entries.find((e) => e.fullName === "Avery Miller")!;
    expect(avery.jerseyNumber).toBe("9");
    expect(avery.position).toBe("Forward");
    expect(avery.grade).toBe("Sr");
  });

  it("handles a particled surname", () => {
    expect(entries.map((e) => e.fullName)).toContain("Ruby van Dyke");
  });

  it("skips the coaching-staff row and the 'View Schedule' link", () => {
    const names = entries.map((e) => e.fullName);
    expect(names).not.toContain("Dana Whitfield");
    expect(names).not.toContain("View Schedule");
  });
});

describe("player-name canonicalization", () => {
  it("joins the same athlete across pages that spell her differently", () => {
    expect(normalizePlayerName("Miller, Avery")).toBe("Avery Miller");
    expect(normalizePlayerName("#9 Avery Miller")).toBe("Avery Miller");
    expect(normalizePlayerName("Avery Miller Sr.")).toBe("Avery Miller");
  });

  it("rejects link text that merely looks like a name", () => {
    expect(normalizePlayerName("View Profile")).toBeNull();
    expect(normalizePlayerName("Full Roster")).toBeNull();
    expect(normalizePlayerName("Avery")).toBeNull();
    expect(normalizePlayerName("")).toBeNull();
  });
});

describe("season rollover", () => {
  const jun30 = new Date("2026-06-30T12:00:00");
  const jul01 = new Date("2026-07-01T12:00:00");

  it("rolls the current season over on July 1", () => {
    expect(currentSeasonSlug(jun30)).toBe("25-26");
    expect(currentSeasonSlug(jul01)).toBe("26-27");
  });

  it("keeps the previous season available across the rollover", () => {
    expect(previousSeasonSlug(jul01)).toBe("25-26");
  });

  it("lists every season, newest first, back to 10-11", () => {
    const slugs = seasonSlugs(jul01);
    expect(slugs[0]).toBe("26-27");
    expect(slugs[slugs.length - 1]).toBe("10-11");
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("recomputes rather than freezing a value at import time", () => {
    // The scraper is one long-lived process with a daily cron. If these were
    // constants, a container started in June would still call 25-26 the
    // current season in August — fetching the new season's page from the
    // bare URL and filing its games under the old season.
    expect(currentSeasonSlug(jun30)).not.toBe(currentSeasonSlug(jul01));
  });
});

describe("roster parser — a genuinely empty roster (real 26-27 page)", () => {
  const { entries, expectedCount } = parseRosterPage(fixture("roster-empty-real.html"));

  it("reports the page's own athlete count", () => {
    // 0 parsed AND 0 expected is "no roster entered yet", not a broken
    // parser. Without the count the two are indistinguishable in the log.
    expect(expectedCount).toBe(0);
    expect(entries).toHaveLength(0);
  });

  it("does not mistake the Staff (4) tab for players", () => {
    expect(entries).toHaveLength(0);
  });
});

describe("season discovery from the site's own picker", () => {
  const seasons = parseSeasonPicker(fixture("roster-empty-real.html"));

  it("finds every level, including a freshman squad we never hardcoded", () => {
    const levels = [...new Set(seasons.map((s) => s.level))].sort();
    expect(levels).toEqual(["freshman", "jv", "varsity"]);
  });

  it("keeps one entry per level+season", () => {
    const keys = seasons.map((s) => `${s.level}:${s.seasonSlug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("builds page URLs for the current season off the bare team URL", () => {
    const v2627 = seasons.find((s) => s.level === "varsity" && s.seasonSlug === "26-27")!;
    expect(pageUrlFor(v2627, "roster")).toBe(
      "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/roster/"
    );
  });

  it("builds page URLs for a historical season off its slugged URL", () => {
    const v2526 = seasons.find((s) => s.level === "varsity" && s.seasonSlug === "25-26")!;
    // The picker points at .../25-26/schedule/; roster must not become
    // .../25-26/schedule/roster/.
    expect(pageUrlFor(v2526, "roster")).toBe(
      "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/25-26/roster/"
    );
    expect(pageUrlFor(v2526, "stats")).toBe(
      "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/25-26/stats/"
    );
  });

  it("handles the JV level's extra path segment", () => {
    const jv = seasons.find((s) => s.level === "jv" && s.seasonSlug === "25-26")!;
    expect(pageUrlFor(jv, "roster")).toBe(
      "https://www.maxpreps.com/in/nappanee/northwood-panthers/soccer/girls/jv/25-26/roster/"
    );
  });
});
