import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchedulePage, normalizeDate, resolveGameDate } from "../src/parse/schedule.js";
import { parseRosterPage } from "../src/parse/roster.js";
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
