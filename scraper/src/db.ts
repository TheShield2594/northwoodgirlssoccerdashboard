import pg from "pg";
import type { ParsedGame } from "./parse/schedule.js";
import type { ParsedRosterEntry } from "./parse/roster.js";
import type { ParsedStatLine } from "./parse/stats.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function upsertSeason(
  seasonSlug: string,
  label: string,
  level: string
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO seasons (season_slug, label, level)
     VALUES ($1, $2, $3)
     ON CONFLICT (season_slug, level)
     DO UPDATE SET label = EXCLUDED.label, scraped_at = now()
     RETURNING id`,
    [seasonSlug, label, level]
  );
  return res.rows[0].id;
}

export async function upsertGame(seasonId: number, g: ParsedGame): Promise<number> {
  const res = await pool.query(
    `INSERT INTO games (season_id, game_date, game_time, opponent, home_away,
                        is_conference, is_playoff, is_tournament,
                        team_score, opponent_score, result, maxpreps_url, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (maxpreps_url) DO UPDATE SET
       game_date = EXCLUDED.game_date,
       game_time = EXCLUDED.game_time,
       opponent = EXCLUDED.opponent,
       home_away = EXCLUDED.home_away,
       is_conference = EXCLUDED.is_conference,
       is_playoff = EXCLUDED.is_playoff,
       is_tournament = EXCLUDED.is_tournament,
       team_score = EXCLUDED.team_score,
       opponent_score = EXCLUDED.opponent_score,
       result = EXCLUDED.result,
       scraped_at = now()
     RETURNING id`,
    [
      seasonId,
      g.isoDate,
      g.timeText,
      g.opponent,
      g.homeAway,
      g.isConference,
      g.isPlayoff,
      g.isTournament,
      g.teamScore,
      g.opponentScore,
      g.result,
      g.matchUrl,
    ]
  );
  return res.rows[0].id;
}

export async function upsertPlayer(fullName: string, maxprepsUrl: string | null): Promise<number> {
  const res = await pool.query(
    `INSERT INTO players (full_name, maxpreps_url)
     VALUES ($1, $2)
     ON CONFLICT (full_name)
     DO UPDATE SET maxpreps_url = COALESCE(EXCLUDED.maxpreps_url, players.maxpreps_url)
     RETURNING id`,
    [fullName, maxprepsUrl]
  );
  return res.rows[0].id;
}

export async function upsertRosterEntry(
  seasonId: number,
  entry: ParsedRosterEntry
): Promise<number> {
  const playerId = await upsertPlayer(entry.fullName, entry.athleteUrl);
  const res = await pool.query(
    `INSERT INTO player_seasons (player_id, season_id, jersey_number, position, grade)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (player_id, season_id) DO UPDATE SET
       jersey_number = COALESCE(EXCLUDED.jersey_number, player_seasons.jersey_number),
       position = COALESCE(EXCLUDED.position, player_seasons.position),
       grade = COALESCE(EXCLUDED.grade, player_seasons.grade)
     RETURNING id`,
    [playerId, seasonId, entry.jerseyNumber, entry.position, entry.grade]
  );
  return res.rows[0].id;
}

/** Save aggregate season stat lines. Creates roster rows for any player
 *  who shows up on the stats page but wasn't on the roster page. */
export async function saveSeasonStats(seasonId: number, lines: ParsedStatLine[]): Promise<void> {
  for (const line of lines) {
    const playerSeasonId = await upsertRosterEntry(seasonId, {
      fullName: line.playerName,
      jerseyNumber: line.jerseyNumber,
      position: null,
      grade: null,
      athleteUrl: null,
    });
    for (const [statName, statValue] of Object.entries(line.stats)) {
      await pool.query(
        `INSERT INTO player_season_stats (player_season_id, stat_name, stat_value)
         VALUES ($1,$2,$3)
         ON CONFLICT (player_season_id, stat_name)
         DO UPDATE SET stat_value = EXCLUDED.stat_value`,
        [playerSeasonId, statName, statValue]
      );
    }
  }
}

export async function gameNeedsBoxScore(gameId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT box_score_scraped, result FROM games WHERE id = $1`,
    [gameId]
  );
  const row = res.rows[0];
  // Only played games have box scores; re-check played games we haven't
  // successfully parsed yet.
  return row && row.result !== null && !row.box_score_scraped;
}

export async function saveBoxScore(gameId: number, lines: ParsedStatLine[]): Promise<void> {
  for (const line of lines) {
    const playerId = await upsertPlayer(line.playerName, null);
    for (const [statName, statValue] of Object.entries(line.stats)) {
      await pool.query(
        `INSERT INTO game_player_stats (game_id, player_id, stat_name, stat_value)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (game_id, player_id, stat_name)
         DO UPDATE SET stat_value = EXCLUDED.stat_value`,
        [gameId, playerId, statName, statValue]
      );
    }
  }
  await pool.query(`UPDATE games SET box_score_scraped = true WHERE id = $1`, [gameId]);
}
