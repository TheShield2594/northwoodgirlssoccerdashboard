/**
 * Deterministic sample dataset so the dashboard is fully explorable before
 * the scraper has ever run (and in local dev without Postgres).
 *
 * Every player here is FICTIONAL — names are generated from a word list and
 * do not correspond to real NorthWood athletes. Opponent school names are
 * real NLC-area schools purely so the schedule reads naturally. The UI
 * shows a "sample data" banner whenever this dataset is being served.
 *
 * Internally consistent by construction: per-game player stat lines are
 * generated first, and season aggregates are summed from them.
 */
import type {
  Game,
  Level,
  PlayerDetail,
  RosterPlayer,
  SeasonBundle,
  SeasonInfo,
} from "./types";

// Small seeded PRNG (mulberry32) so every render sees identical data.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Avery", "Brynn", "Cora", "Delaney", "Elise", "Fiona", "Greta", "Hadley",
  "Isla", "Juniper", "Kendra", "Lyla", "Maren", "Nova", "Opal", "Piper",
  "Quinn", "Rowan", "Sage", "Tessa", "Una", "Vera", "Willa", "Xiomara",
  "Yara", "Zoe", "Adair", "Blair", "Cleo", "Dara", "Emery", "Frankie",
];
const LAST = [
  "Ashford", "Birchwood", "Calloway", "Danvers", "Ellsworth", "Fairbanks",
  "Greenley", "Halloran", "Ivers", "Juneau", "Kestrel", "Larkspur",
  "Merriweather", "Northgate", "Oakhurst", "Pemberly", "Quillen", "Redfern",
  "Silverton", "Thornbury", "Underhill", "Vandermeer", "Wystan", "Yarrow",
];

const NLC_OPPONENTS = ["Warsaw", "Concord", "Goshen", "Wawasee", "Plymouth", "Northridge", "Elkhart"];
const NON_CONF = ["Lakeland", "Westview", "Fairfield", "Bethany Christian", "Mishawaka Marian", "South Bend Saint Joseph", "Bremen", "Tippecanoe Valley", "Jimtown", "West Noble"];
const PLAYOFF = ["Penn", "Elkhart", "Northridge"];

interface DemoSeason {
  info: SeasonInfo;
  games: Game[];
  roster: RosterPlayer[];
  // per-game stat lines: gameId -> playerId -> stats
  gameStats: Map<number, Map<number, Record<string, number>>>;
}

interface DemoPlayer {
  playerId: number;
  name: string;
  role: "GK" | "D" | "M" | "F";
  startSeason: number; // index into varsity slugs from oldest
  careerLen: number;
  quality: number; // 0..1 scoring instinct
}

const SEASON_START_YEARS = Array.from({ length: 16 }, (_, i) => 10 + i); // 10..25 -> 10-11..25-26
const slugOf = (y: number) => `${String(y).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;
const labelOf = (y: number) => `Fall 20${String(y).padStart(2, "0")}`;

class DemoDB {
  seasons = new Map<string, DemoSeason>(); // key: `${level}:${slug}`
  players = new Map<number, DemoPlayer>();

  constructor() {
    const rng = mulberry32(20251031);

    // ---- player pool: rolling 4-year careers so career pages have arcs
    let pid = 1;
    const pool: DemoPlayer[] = [];
    for (let start = -3; start < SEASON_START_YEARS.length; start++) {
      const cohortSize = 9 + Math.floor(rng() * 3); // 9-11 per incoming class (varsity + JV)
      for (let i = 0; i < cohortSize; i++) {
        const name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;
        if (pool.some((p) => p.name === name)) continue;
        const roleRoll = rng();
        pool.push({
          playerId: pid++,
          name,
          role: roleRoll < 0.12 ? "GK" : roleRoll < 0.42 ? "D" : roleRoll < 0.74 ? "M" : "F",
          startSeason: start,
          careerLen: rng() < 0.75 ? 4 : 3,
          quality: 0.25 + rng() * 0.75,
        });
      }
    }
    pool.forEach((p) => this.players.set(p.playerId, p));

    // ---- program trajectory: win probability drifts up over the years
    SEASON_START_YEARS.forEach((year, idx) => {
      const strength = 0.34 + 0.026 * idx + (rng() - 0.5) * 0.12; // ~.3 → ~.75
      this.buildSeason("varsity", year, idx, strength, pool, rng);
      // JV squads only listed on MaxPreps from 2018 on (mirrors reality
      // that JV history is shallower).
      if (year >= 18) this.buildSeason("jv", year, idx, strength - 0.05, pool, rng);
    });
  }

  private buildSeason(
    level: Level,
    year: number,
    idx: number,
    strength: number,
    pool: DemoPlayer[],
    rng: () => number
  ) {
    const slug = slugOf(year);

    // ---- schedule
    const games: Game[] = [];
    const nGames = 15 + Math.floor(rng() * 4);
    const opponents: { name: string; conf: boolean; playoff: boolean }[] = [];
    NLC_OPPONENTS.forEach((o) => opponents.push({ name: o, conf: true, playoff: false }));
    while (opponents.length < nGames - 2) {
      const o = NON_CONF[Math.floor(rng() * NON_CONF.length)];
      if (opponents.filter((x) => x.name === o).length < 2) {
        opponents.push({ name: o, conf: false, playoff: false });
      }
    }
    // sectional at the end (varsity only)
    if (level === "varsity") {
      opponents.push({ name: PLAYOFF[Math.floor(rng() * PLAYOFF.length)], conf: false, playoff: true });
      if (rng() < strength) {
        opponents.push({ name: PLAYOFF[Math.floor(rng() * PLAYOFF.length)], conf: false, playoff: true });
      }
    }

    // spread games Aug 15 – mid Oct (day counter = days after Aug 1, capped
    // so we never roll past Oct 31)
    const dates: string[] = [];
    let day = 14 + Math.floor(rng() * 3);
    const step = Math.max(2, Math.floor(66 / opponents.length));
    for (let i = 0; i < opponents.length; i++) {
      const d = Math.min(day, 91);
      const month = d <= 31 ? 8 : d <= 61 ? 9 : 10;
      const dom = d <= 31 ? d : d <= 61 ? d - 31 : d - 61;
      dates.push(`20${year}-${String(month).padStart(2, "0")}-${String(dom).padStart(2, "0")}`);
      day += step + Math.floor(rng() * 2);
    }

    let gid = (level === "jv" ? 100000 : 0) + year * 1000;
    opponents.forEach((opp, i) => {
      const roll = rng();
      const winP = opp.playoff ? strength - 0.15 : strength;
      const result: "W" | "L" | "T" = roll < winP ? "W" : roll < winP + 0.12 ? "T" : "L";
      let teamScore: number, oppScore: number;
      if (result === "W") {
        teamScore = 1 + Math.floor(rng() * 5) + (rng() < strength ? Math.floor(rng() * 4) : 0);
        oppScore = Math.floor(rng() * Math.min(teamScore, 3));
      } else if (result === "L") {
        oppScore = 1 + Math.floor(rng() * 4);
        teamScore = Math.floor(rng() * Math.min(oppScore, 3));
      } else {
        teamScore = oppScore = Math.floor(rng() * 3);
      }
      games.push({
        id: gid + i,
        date: dates[i],
        time: rng() < 0.5 ? "7:00pm" : "5:30pm",
        opponent: opp.name,
        homeAway: opp.playoff ? "neutral" : rng() < 0.5 ? "home" : "away",
        isConference: opp.conf,
        isPlayoff: opp.playoff,
        isTournament: false,
        teamScore,
        opponentScore: oppScore,
        result,
      });
    });

    // ---- roster: players whose career covers this season index
    const eligible = pool.filter(
      (p) => idx >= p.startSeason && idx < p.startSeason + p.careerLen
    );
    // Varsity takes upperclass + best; JV gets the younger half.
    const ranked = [...eligible].sort(
      (a, b) => (idx - b.startSeason) + b.quality - ((idx - a.startSeason) + a.quality)
    );
    const squad = level === "varsity" ? ranked.slice(0, 18) : ranked.slice(18, 34);

    const grades = ["Fr", "So", "Jr", "Sr"];
    const usedJerseys = new Set<string>();
    const roster: RosterPlayer[] = squad.map((p) => {
      let jersey = String(1 + Math.floor(rng() * 30));
      while (usedJerseys.has(jersey)) jersey = String(1 + Math.floor(rng() * 40));
      usedJerseys.add(jersey);
      return {
        playerId: p.playerId,
        name: p.name,
        jersey,
        position: p.role === "GK" ? "GK" : p.role === "D" ? "D" : p.role === "M" ? "M" : "F",
        grade: grades[Math.min(3, Math.max(0, idx - p.startSeason + (p.careerLen === 3 ? 1 : 0)))],
        stats: {},
      };
    });
    if (!roster.some((r) => r.position === "GK") && roster.length > 0) roster[0].position = "GK";

    // ---- per-game stat lines -> season aggregates
    const gameStats = new Map<number, Map<number, Record<string, number>>>();
    const keeper = roster.find((r) => r.position === "GK");
    const field = roster.filter((r) => r.position !== "GK");
    const weight = (r: RosterPlayer) => {
      const p = this.players.get(r.playerId)!;
      const posW = p.role === "F" ? 1.0 : p.role === "M" ? 0.55 : 0.12;
      return posW * (0.3 + p.quality);
    };
    const totalW = field.reduce((s, r) => s + weight(r), 0) || 1;

    for (const g of games) {
      const perPlayer = new Map<number, Record<string, number>>();
      // distribute team goals
      for (let sc = 0; sc < (g.teamScore ?? 0); sc++) {
        let pick = rng() * totalW;
        let scorer = field[0];
        for (const r of field) {
          pick -= weight(r);
          if (pick <= 0) { scorer = r; break; }
        }
        if (!scorer) continue;
        const line = perPlayer.get(scorer.playerId) ?? {};
        line.goals = (line.goals ?? 0) + 1;
        perPlayer.set(scorer.playerId, line);
        // ~2/3 of goals are assisted
        const others = field.filter((r) => r.playerId !== scorer.playerId);
        if (rng() < 0.68 && others.length > 0) {
          const assister = others[Math.floor(rng() * others.length)];
          const aLine = perPlayer.get(assister.playerId) ?? {};
          aLine.assists = (aLine.assists ?? 0) + 1;
          perPlayer.set(assister.playerId, aLine);
        }
      }
      // shots roughly proportional to goals+noise for the forwards
      for (const r of field) {
        const line = perPlayer.get(r.playerId) ?? {};
        const sh = Math.round((line.goals ?? 0) * (1.6 + rng()) + weight(r) * 3 * rng());
        if (sh > 0) {
          line.shots = sh;
          line.shots_on_goal = Math.max(line.goals ?? 0, Math.round(sh * (0.45 + rng() * 0.3)));
          perPlayer.set(r.playerId, line);
        }
      }
      // keeper line
      if (keeper) {
        const shotsFaced = (g.opponentScore ?? 0) + 2 + Math.floor(rng() * 7);
        perPlayer.set(keeper.playerId, {
          saves: shotsFaced - (g.opponentScore ?? 0),
          goals_against: g.opponentScore ?? 0,
          shutouts: (g.opponentScore ?? 0) === 0 ? 1 : 0,
        });
      }
      gameStats.set(g.id, perPlayer);
    }

    // aggregate
    for (const r of roster) {
      const agg: Record<string, number> = { games_played: 0 };
      for (const g of games) {
        const line = gameStats.get(g.id)?.get(r.playerId);
        const played = line || rng() < 0.9;
        if (played) agg.games_played += 1;
        if (!line) continue;
        for (const [k, v] of Object.entries(line)) agg[k] = (agg[k] ?? 0) + v;
      }
      if (agg.goals || agg.assists) agg.points = (agg.goals ?? 0) * 2 + (agg.assists ?? 0);
      r.stats = agg;
    }

    // ---- season info
    const wins = games.filter((g) => g.result === "W").length;
    const losses = games.filter((g) => g.result === "L").length;
    const ties = games.filter((g) => g.result === "T").length;
    const conf = games.filter((g) => g.isConference);
    const info: SeasonInfo = {
      slug,
      label: labelOf(year),
      level,
      wins,
      losses,
      ties,
      confWins: conf.filter((g) => g.result === "W").length,
      confLosses: conf.filter((g) => g.result === "L").length,
      confTies: conf.filter((g) => g.result === "T").length,
      goalsFor: games.reduce((s, g) => s + (g.teamScore ?? 0), 0),
      goalsAgainst: games.reduce((s, g) => s + (g.opponentScore ?? 0), 0),
      gamesPlayed: games.length,
    };

    this.seasons.set(`${level}:${slug}`, { info, games, roster, gameStats });
  }
}

let db: DemoDB | null = null;
function demoDb(): DemoDB {
  if (!db) db = new DemoDB();
  return db;
}

export function demoListSeasons(): SeasonInfo[] {
  return [...demoDb().seasons.values()]
    .map((s) => s.info)
    .sort((a, b) => (a.slug < b.slug ? 1 : -1));
}

export function demoSeasonBundle(level: Level, slug: string): SeasonBundle | null {
  const s = demoDb().seasons.get(`${level}:${slug}`);
  if (!s) return null;
  return { season: s.info, games: s.games, roster: s.roster };
}

export function demoPlayerDetail(playerId: number): PlayerDetail | null {
  const d = demoDb();
  const p = d.players.get(playerId);
  if (!p) return null;

  const seasons: PlayerDetail["seasons"] = [];
  const gameLog: PlayerDetail["gameLog"] = [];
  for (const s of d.seasons.values()) {
    const rosterRow = s.roster.find((r) => r.playerId === playerId);
    if (!rosterRow) continue;
    seasons.push({
      seasonSlug: s.info.slug,
      seasonLabel: s.info.label,
      level: s.info.level,
      jersey: rosterRow.jersey,
      position: rosterRow.position,
      grade: rosterRow.grade,
      stats: rosterRow.stats,
    });
    for (const g of s.games) {
      const line = s.gameStats.get(g.id)?.get(playerId);
      if (line && Object.values(line).some((v) => v > 0)) {
        gameLog.push({
          date: g.date,
          opponent: g.opponent,
          result: g.result,
          teamScore: g.teamScore,
          opponentScore: g.opponentScore,
          stats: line,
        });
      }
    }
  }
  seasons.sort((a, b) => (a.seasonSlug < b.seasonSlug ? -1 : 1));
  gameLog.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { playerId, name: p.name, seasons, gameLog };
}
