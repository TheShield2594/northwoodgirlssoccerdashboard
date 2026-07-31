-- NorthWood Girls Soccer stats dashboard schema
-- Applied automatically on the Postgres container's first boot via
-- docker-entrypoint-initdb.d. To apply by hand: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS seasons (
    id              SERIAL PRIMARY KEY,
    season_slug     TEXT NOT NULL,              -- '25-26', '24-25', ... '10-11'
    label           TEXT NOT NULL,              -- 'Fall 2025' etc.
    level           TEXT NOT NULL DEFAULT 'varsity',  -- 'varsity' | 'jv' | 'freshman'
    scraped_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (season_slug, level)
);

CREATE TABLE IF NOT EXISTS games (
    id              SERIAL PRIMARY KEY,
    season_id       INT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    game_date       DATE NOT NULL,
    game_time       TEXT,                       -- raw display time, e.g. '7:15pm'
    opponent        TEXT NOT NULL,
    home_away       TEXT,                       -- 'home' | 'away' | 'neutral'
    is_conference   BOOLEAN DEFAULT false,
    is_playoff      BOOLEAN DEFAULT false,
    is_tournament   BOOLEAN DEFAULT false,
    team_score      INT,                        -- NorthWood's score (NULL = not played yet)
    opponent_score  INT,
    result          TEXT,                       -- 'W' | 'L' | 'T' | NULL
    maxpreps_url    TEXT UNIQUE NOT NULL,       -- match page URL, natural dedupe key
    box_score_scraped BOOLEAN DEFAULT false,
    scraped_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);
CREATE INDEX IF NOT EXISTS idx_games_date   ON games(game_date);

-- One row per human. Jersey/position/grade live on player_seasons because
-- they change year to year.
--
-- Identity tradeoff (deliberate): players are keyed by full_name because
-- the season-stats and box-score pages only give us names — an athlete-page
-- URL is discovered opportunistically from roster pages and can't serve as
-- the join key across sources. If two different athletes ever share the
-- exact same name in program history their careers would merge; accepted
-- for a single-school dataset. maxpreps_url is a profile link, not identity.
CREATE TABLE IF NOT EXISTS players (
    id              SERIAL PRIMARY KEY,
    full_name       TEXT NOT NULL UNIQUE,
    maxpreps_url    TEXT                        -- athlete page, when discovered
);

-- Roster membership: which player was on which season's squad, with the
-- season-specific attributes from the roster page.
CREATE TABLE IF NOT EXISTS player_seasons (
    id              SERIAL PRIMARY KEY,
    player_id       INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    season_id       INT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    jersey_number   TEXT,
    position        TEXT,
    grade           TEXT,                       -- 'Fr' | 'So' | 'Jr' | 'Sr' or as shown
    UNIQUE (player_id, season_id)
);
CREATE INDEX IF NOT EXISTS idx_ps_season ON player_seasons(season_id);

-- Season-aggregate stat lines from the team stats page (goals, assists,
-- shots, saves, ... whatever columns MaxPreps shows). Generic name/value
-- so new columns never need a migration.
CREATE TABLE IF NOT EXISTS player_season_stats (
    id                SERIAL PRIMARY KEY,
    player_season_id  INT NOT NULL REFERENCES player_seasons(id) ON DELETE CASCADE,
    stat_name         TEXT NOT NULL,            -- 'goals','assists','shots','saves',...
    stat_value        NUMERIC NOT NULL,
    UNIQUE (player_season_id, stat_name)
);

-- Per-game individual stat lines, pulled from box scores (best effort —
-- not every game has one entered on MaxPreps).
CREATE TABLE IF NOT EXISTS game_player_stats (
    id              SERIAL PRIMARY KEY,
    game_id         INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id       INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    stat_name       TEXT NOT NULL,
    stat_value      NUMERIC NOT NULL,
    UNIQUE (game_id, player_id, stat_name)
);
CREATE INDEX IF NOT EXISTS idx_gps_game   ON game_player_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_gps_player ON game_player_stats(player_id);

-- Season-to-date team record derived from games.
CREATE OR REPLACE VIEW season_record AS
SELECT
    s.id AS season_id,
    s.season_slug,
    s.label,
    s.level,
    COUNT(g.id) FILTER (WHERE g.result = 'W') AS wins,
    COUNT(g.id) FILTER (WHERE g.result = 'L') AS losses,
    COUNT(g.id) FILTER (WHERE g.result = 'T') AS ties,
    COUNT(g.id) FILTER (WHERE g.result = 'W' AND g.is_conference) AS conf_wins,
    COUNT(g.id) FILTER (WHERE g.result = 'L' AND g.is_conference) AS conf_losses,
    COUNT(g.id) FILTER (WHERE g.result = 'T' AND g.is_conference) AS conf_ties,
    COALESCE(SUM(g.team_score)     FILTER (WHERE g.team_score     IS NOT NULL), 0) AS goals_for,
    COALESCE(SUM(g.opponent_score) FILTER (WHERE g.opponent_score IS NOT NULL), 0) AS goals_against
FROM seasons s
LEFT JOIN games g ON g.season_id = s.id
GROUP BY s.id, s.season_slug, s.label, s.level;
