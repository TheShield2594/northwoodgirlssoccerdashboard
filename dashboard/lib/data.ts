/**
 * Single data-access layer for every page. Reads Postgres when it's
 * populated; otherwise serves the deterministic demo dataset so the UI is
 * always explorable. Every accessor returns `{ demo }` alongside the data
 * and pages surface a banner when demo is true.
 */
import { getPool } from "./db";
import { demoListSeasons, demoPlayerDetail, demoSeasonBundle } from "./demo";
import type { Game, Level, PlayerDetail, RosterPlayer, SeasonBundle, SeasonInfo } from "./types";

const FORCE_DEMO = process.env.DEMO_MODE === "1";

async function dbHasData(): Promise<boolean> {
  if (FORCE_DEMO) return false;
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(`SELECT 1 FROM games LIMIT 1`);
    return res.rowCount === 1;
  } catch {
    return false;
  }
}

export async function listSeasons(): Promise<{ seasons: SeasonInfo[]; demo: boolean }> {
  if (await dbHasData()) {
    const pool = getPool()!;
    const res = await pool.query(`
      SELECT season_slug, label, level, wins, losses, ties,
             conf_wins, conf_losses, conf_ties, goals_for, goals_against,
             (wins + losses + ties) AS games_played
      FROM season_record
      ORDER BY season_slug DESC, level ASC
    `);
    const seasons = res.rows.map(rowToSeason).filter((s) => s.gamesPlayed > 0 || true);
    if (seasons.length > 0) return { seasons, demo: false };
  }
  return { seasons: demoListSeasons(), demo: true };
}

export async function getSeasonBundle(
  level: Level,
  slug: string
): Promise<{ bundle: SeasonBundle | null; demo: boolean }> {
  if (await dbHasData()) {
    const pool = getPool()!;
    const seasonRes = await pool.query(
      `SELECT s.id, r.season_slug, r.label, r.level, r.wins, r.losses, r.ties,
              r.conf_wins, r.conf_losses, r.conf_ties, r.goals_for, r.goals_against,
              (r.wins + r.losses + r.ties) AS games_played
       FROM seasons s JOIN season_record r ON r.season_id = s.id
       WHERE s.season_slug = $1 AND s.level = $2`,
      [slug, level]
    );
    if (seasonRes.rowCount === 1) {
      const seasonId = seasonRes.rows[0].id;
      const season = rowToSeason(seasonRes.rows[0]);

      const gamesRes = await pool.query(
        `SELECT id, game_date, game_time, opponent, home_away, is_conference,
                is_playoff, is_tournament, team_score, opponent_score, result
         FROM games WHERE season_id = $1 ORDER BY game_date ASC`,
        [seasonId]
      );
      const games: Game[] = gamesRes.rows.map((r) => ({
        id: r.id,
        date: toIso(r.game_date),
        time: r.game_time,
        opponent: r.opponent,
        homeAway: r.home_away ?? "home",
        isConference: r.is_conference,
        isPlayoff: r.is_playoff,
        isTournament: r.is_tournament,
        teamScore: r.team_score,
        opponentScore: r.opponent_score,
        result: r.result,
      }));

      const rosterRes = await pool.query(
        `SELECT ps.id AS player_season_id, p.id AS player_id, p.full_name,
                ps.jersey_number, ps.position, ps.grade
         FROM player_seasons ps JOIN players p ON p.id = ps.player_id
         WHERE ps.season_id = $1
         ORDER BY p.full_name`,
        [seasonId]
      );
      const statsRes = await pool.query(
        `SELECT ps.player_id, pss.stat_name, pss.stat_value
         FROM player_season_stats pss
         JOIN player_seasons ps ON ps.id = pss.player_season_id
         WHERE ps.season_id = $1`,
        [seasonId]
      );
      // If the stats page never parsed, fall back to summing box scores.
      const boxRes = await pool.query(
        `SELECT gps.player_id, gps.stat_name, SUM(gps.stat_value) AS stat_value
         FROM game_player_stats gps
         JOIN games g ON g.id = gps.game_id
         WHERE g.season_id = $1
         GROUP BY gps.player_id, gps.stat_name`,
        [seasonId]
      );

      const statMap = new Map<number, Record<string, number>>();
      for (const src of [boxRes.rows, statsRes.rows]) {
        for (const r of src) {
          const m = statMap.get(r.player_id) ?? {};
          m[r.stat_name] = Number(r.stat_value);
          statMap.set(r.player_id, m);
        }
      }

      const roster: RosterPlayer[] = rosterRes.rows.map((r) => ({
        playerId: r.player_id,
        name: r.full_name,
        jersey: r.jersey_number,
        position: r.position,
        grade: r.grade,
        stats: statMap.get(r.player_id) ?? {},
      }));

      return { bundle: { season, games, roster }, demo: false };
    }
    // The DB is populated but has no such season/level — that's a real
    // "not found", not a reason to serve demo data.
    return { bundle: null, demo: false };
  }
  return { bundle: demoSeasonBundle(level, slug), demo: true };
}

export async function getPlayerDetail(
  playerId: number
): Promise<{ player: PlayerDetail | null; demo: boolean }> {
  if (await dbHasData()) {
    const pool = getPool()!;
    const pRes = await pool.query(`SELECT id, full_name FROM players WHERE id = $1`, [playerId]);
    if (pRes.rowCount === 1) {
      const seasonsRes = await pool.query(
        `SELECT s.season_slug, s.label, s.level, ps.id AS player_season_id,
                ps.jersey_number, ps.position, ps.grade
         FROM player_seasons ps JOIN seasons s ON s.id = ps.season_id
         WHERE ps.player_id = $1 ORDER BY s.season_slug ASC`,
        [playerId]
      );
      const statRes = await pool.query(
        `SELECT pss.player_season_id, pss.stat_name, pss.stat_value
         FROM player_season_stats pss
         JOIN player_seasons ps ON ps.id = pss.player_season_id
         WHERE ps.player_id = $1`,
        [playerId]
      );
      const statByPs = new Map<number, Record<string, number>>();
      for (const r of statRes.rows) {
        const m = statByPs.get(r.player_season_id) ?? {};
        m[r.stat_name] = Number(r.stat_value);
        statByPs.set(r.player_season_id, m);
      }

      const logRes = await pool.query(
        `SELECT g.game_date, g.opponent, g.result, g.team_score, g.opponent_score,
                gps.stat_name, gps.stat_value
         FROM game_player_stats gps JOIN games g ON g.id = gps.game_id
         WHERE gps.player_id = $1 ORDER BY g.game_date ASC`,
        [playerId]
      );
      const logByDate = new Map<string, PlayerDetail["gameLog"][number]>();
      for (const r of logRes.rows) {
        const key = `${toIso(r.game_date)}|${r.opponent}`;
        const entry: PlayerDetail["gameLog"][number] = logByDate.get(key) ?? {
          date: toIso(r.game_date),
          opponent: r.opponent,
          result: r.result,
          teamScore: r.team_score,
          opponentScore: r.opponent_score,
          stats: {},
        };
        entry.stats[r.stat_name] = Number(r.stat_value);
        logByDate.set(key, entry);
      }

      return {
        player: {
          playerId,
          name: pRes.rows[0].full_name,
          seasons: seasonsRes.rows.map((r) => ({
            seasonSlug: r.season_slug,
            seasonLabel: r.label,
            level: r.level,
            jersey: r.jersey_number,
            position: r.position,
            grade: r.grade,
            stats: statByPs.get(r.player_season_id) ?? {},
          })),
          gameLog: [...logByDate.values()],
        },
        demo: false,
      };
    }
    // Populated DB, unknown player id — real "not found".
    return { player: null, demo: false };
  }
  return { player: demoPlayerDetail(playerId), demo: true };
}

// ------------------------------------------------------------------ utils

function rowToSeason(r: any): SeasonInfo {
  return {
    slug: r.season_slug,
    label: r.label,
    level: r.level,
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    ties: Number(r.ties ?? 0),
    confWins: Number(r.conf_wins ?? 0),
    confLosses: Number(r.conf_losses ?? 0),
    confTies: Number(r.conf_ties ?? 0),
    goalsFor: Number(r.goals_for ?? 0),
    goalsAgainst: Number(r.goals_against ?? 0),
    gamesPlayed: Number(r.games_played ?? 0),
  };
}

function toIso(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  // pg parses DATE columns as local-midnight Dates; format with local
  // parts so the calendar day never shifts across the UTC boundary.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
