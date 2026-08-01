import pg from "pg";
import type { ParsedGame } from "./parse/schedule.js";
import type { ParsedRosterEntry } from "./parse/roster.js";
import type { ParsedStatLine } from "./parse/stats.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // undefined -> pg falls back to PG* env vars
});

// An idle client dropping (e.g. Postgres restart) must not kill the
// long-running cron process.
pool.on("error", (err) => console.warn("[db] pool error:", err.message));

// Both pg.Pool and pg.PoolClient satisfy this — lets the upsert helpers
// run standalone or inside a transaction.
type Queryable = Pick<pg.Pool, "query">;

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

export async function upsertGame(
  seasonId: number,
  seasonSlug: string,
  g: ParsedGame
): Promise<number> {
  // A game first seen without a real match URL was stored under a
  // deterministic synthetic key (see schedule.ts). If we now know the real
  // URL for the same season/date/opponent, upgrade that row in place so the
  // game doesn't duplicate.
  if (!g.matchUrl.startsWith("synthetic:")) {
    await pool.query(
      `UPDATE games SET maxpreps_url = $1 WHERE maxpreps_url = $2`,
      [g.matchUrl, `synthetic:${seasonSlug}:${g.isoDate}:${g.opponent}`]
    );
  }

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

export async function upsertPlayer(
  fullName: string,
  maxprepsUrl: string | null,
  q: Queryable = pool
): Promise<number> {
  const res = await q.query(
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
  entry: ParsedRosterEntry,
  q: Queryable = pool
): Promise<number> {
  const playerId = await upsertPlayer(entry.fullName, entry.athleteUrl, q);
  const res = await q.query(
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

/** Save aggregate season stat lines in one transaction (all-or-nothing, so
 *  a mid-loop failure can't leave a half-written stats page). Creates
 *  roster rows for any player who shows up on the stats page but wasn't on
 *  the roster page. */
export async function saveSeasonStats(
  seasonId: number,
  lines: ParsedStatLine[]
): Promise<number[]> {
  const touched: number[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const line of lines) {
      const playerSeasonId = await upsertRosterEntry(
        seasonId,
        {
          fullName: line.playerName,
          jerseyNumber: line.jerseyNumber,
          position: null,
          grade: null,
          athleteUrl: null,
        },
        client
      );
      touched.push(playerSeasonId);
      for (const [statName, statValue] of Object.entries(line.stats)) {
        await client.query(
          `INSERT INTO player_season_stats (player_season_id, stat_name, stat_value)
           VALUES ($1,$2,$3)
           ON CONFLICT (player_season_id, stat_name)
           DO UPDATE SET stat_value = EXCLUDED.stat_value`,
          [playerSeasonId, statName, statValue]
        );
      }
    }
    await client.query("COMMIT");
    return touched;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Drop rows for a season that this run did NOT see.
 *
 * Upserts alone can only add and correct; a game stored under a URL the
 * schedule no longer lists (or a player parsed out of garbled markup) stays
 * forever. `--prune` is what turns a re-scrape into a true reconciliation,
 * so a season that imported badly can be repaired by running it again.
 *
 * Deliberately season-scoped: a season whose page 404s is skipped entirely
 * upstream, so an outage can never empty out history.
 */
export async function pruneSeason(
  seasonId: number,
  keptGameUrls: string[] | null,
  keptPlayerSeasonIds: number[] | null
): Promise<{ games: number; rosterEntries: number; players: number }> {
  // A null kept-set means the caller could not vouch for that category this
  // run (a fetch failed, a parse threw, the page came back empty). Absence of
  // evidence is not evidence of absence: skip rather than delete. Deleting on
  // an empty set would turn one bad fetch into a wiped season.
  const games =
    keptGameUrls !== null && keptGameUrls.length > 0
      ? await pool.query(
          `DELETE FROM games WHERE season_id = $1 AND NOT (maxpreps_url = ANY($2::text[]))`,
          [seasonId, keptGameUrls]
        )
      : { rowCount: 0 };
  const rosterEntries =
    keptPlayerSeasonIds !== null && keptPlayerSeasonIds.length > 0
      ? await pool.query(
          `DELETE FROM player_seasons WHERE season_id = $1 AND NOT (id = ANY($2::int[]))`,
          [seasonId, keptPlayerSeasonIds]
        )
      : { rowCount: 0 };
  // A player who is now on no roster and has no box-score line was a parsing
  // artifact ("View Profile", a mangled name). Nothing references her.
  const players = await pool.query(
    `DELETE FROM players p
      WHERE NOT EXISTS (SELECT 1 FROM player_seasons ps WHERE ps.player_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM game_player_stats gs WHERE gs.player_id = p.id)`
  );
  return {
    games: games.rowCount ?? 0,
    rosterEntries: rosterEntries.rowCount ?? 0,
    players: players.rowCount ?? 0,
  };
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

/** Save one game's box score in a transaction, marking the game scraped
 *  only when every line landed. */
export async function saveBoxScore(gameId: number, lines: ParsedStatLine[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const line of lines) {
      const playerId = await upsertPlayer(line.playerName, null, client);
      for (const [statName, statValue] of Object.entries(line.stats)) {
        await client.query(
          `INSERT INTO game_player_stats (game_id, player_id, stat_name, stat_value)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (game_id, player_id, stat_name)
           DO UPDATE SET stat_value = EXCLUDED.stat_value`,
          [gameId, playerId, statName, statValue]
        );
      }
    }
    await client.query(`UPDATE games SET box_score_scraped = true WHERE id = $1`, [gameId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
