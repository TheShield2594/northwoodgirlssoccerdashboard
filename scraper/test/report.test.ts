import { describe, expect, it } from "vitest";
import { SeasonReport, findRegressions, newSeasonReport, summarize } from "../src/report.js";

function report(over: Partial<SeasonReport> = {}): SeasonReport {
  return {
    ...newSeasonReport("varsity", "25-26", { games: 0, rosterEntries: 0, statLines: 0 }),
    ...over,
  };
}

describe("findRegressions", () => {
  it("flags stats that existed yesterday and parsed zero today", () => {
    const r = report({ games: 18, rosterEntries: 22, statLines: 0, before: { games: 18, rosterEntries: 22, statLines: 22 } });
    expect(findRegressions(r)).toEqual(["stat lines: had 22, parsed 0 this run"]);
  });

  // The August case: a brand-new season with nothing entered yet must not
  // alert, or the alert fires every day until the coach uploads a roster and
  // stops being read long before it matters.
  it("stays quiet for a season that never had data", () => {
    const r = report({ games: 0, rosterEntries: 0, statLines: 0 });
    expect(findRegressions(r)).toEqual([]);
  });

  it("stays quiet when the counts held up", () => {
    const r = report({ games: 18, rosterEntries: 22, statLines: 22, before: { games: 18, rosterEntries: 22, statLines: 22 } });
    expect(findRegressions(r)).toEqual([]);
  });

  // A partial parse is a different (quieter) problem than a total one; only
  // dropping to zero is unambiguous enough to wake someone for.
  it("does not flag a merely smaller count", () => {
    const r = report({ statLines: 20, before: { games: 0, rosterEntries: 0, statLines: 22 } });
    expect(findRegressions(r)).toEqual([]);
  });

  it("flags games and roster the same way as stats", () => {
    const r = report({ before: { games: 18, rosterEntries: 22, statLines: 0 } });
    expect(findRegressions(r)).toEqual([
      "games: had 18, parsed 0 this run",
      "roster entries: had 22, parsed 0 this run",
    ]);
  });
});

describe("summarize", () => {
  // The July case: a published schedule with nothing played yet has no stats
  // and no roster, and must not alarm — a daily false alarm from the first
  // week of July until the first whistle is how alerting gets muted.
  it("stays quiet for a season that has not been played yet", () => {
    const s = summarize([report({ games: 18, gamesPlayed: 0, rosterEntries: 0, statLines: 0, sources: { schedule: "flight" } })]);
    expect(s.alarming).toBe(false);
  });

  it("marks a clean run not alarming", () => {
    const s = summarize([report({ games: 18, rosterEntries: 22, statLines: 22, sources: { stats: "flight" } })]);
    expect(s.alarming).toBe(false);
    expect(s.text).toContain("all clean");
  });

  it("is alarming when a parser reports trouble, even with no regression", () => {
    const s = summarize([report({ games: 18, sources: { schedule: "dom" }, problems: ["schedule fell back to the DOM — rows may be wrong"] })]);
    expect(s.alarming).toBe(true);
    expect(s.text).toContain("dom!");
  });

  it("names the regressed target in the alert body", () => {
    const s = summarize([
      report({ level: "jv", seasonSlug: "24-25", games: 16, statLines: 0, before: { games: 16, rosterEntries: 19, statLines: 19 } }),
    ]);
    expect(s.alarming).toBe(true);
    expect(s.text).toContain("REGRESSION jv 24-25 stat lines: had 19, parsed 0 this run");
  });

  it("counts every problem across targets in the header", () => {
    const s = summarize([
      report({ problems: ["a"] }),
      report({ level: "jv", problems: ["b", "c"] }),
    ]);
    expect(s.text).toContain("3 problem(s) across 2 season/level target(s)");
  });
});
