export type Level = "varsity" | "jv" | "freshman";

export interface SeasonInfo {
  slug: string; // '25-26'
  label: string; // 'Fall 2025'
  level: Level;
  wins: number;
  losses: number;
  ties: number;
  confWins: number;
  confLosses: number;
  confTies: number;
  goalsFor: number;
  goalsAgainst: number;
  gamesPlayed: number;
}

export interface Game {
  id: number;
  date: string; // ISO
  time: string | null;
  opponent: string;
  homeAway: "home" | "away" | "neutral";
  isConference: boolean;
  isPlayoff: boolean;
  isTournament: boolean;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
}

/** Canonical stat keys (the scraper writes these names). */
export type StatKey =
  | "games_played"
  | "goals"
  | "assists"
  | "points"
  | "shots"
  | "shots_on_goal"
  | "game_winning_goals"
  | "saves"
  | "goals_against"
  | "shutouts"
  | (string & {}); // any other scraped stat name; keeps literal autocomplete

export interface RosterPlayer {
  playerId: number;
  name: string;
  jersey: string | null;
  position: string | null;
  grade: string | null;
  stats: Partial<Record<StatKey, number>>;
}

export interface SeasonBundle {
  season: SeasonInfo;
  games: Game[];
  roster: RosterPlayer[];
}

export interface PlayerSeasonLine {
  seasonSlug: string;
  seasonLabel: string;
  level: Level;
  jersey: string | null;
  position: string | null;
  grade: string | null;
  stats: Partial<Record<StatKey, number>>;
}

export interface PlayerGameLine {
  date: string;
  opponent: string;
  result: "W" | "L" | "T" | null;
  teamScore: number | null;
  opponentScore: number | null;
  stats: Partial<Record<StatKey, number>>;
}

export interface PlayerDetail {
  playerId: number;
  name: string;
  seasons: PlayerSeasonLine[];
  gameLog: PlayerGameLine[]; // most recent season(s) with box-score data
}

export interface DataSourceInfo {
  demo: boolean;
}

export const STAT_LABELS: Record<string, string> = {
  games_played: "GP",
  games_started: "GS",
  goals: "G",
  assists: "A",
  points: "PTS",
  shots: "SH",
  shots_on_goal: "SOG",
  game_winning_goals: "GWG",
  saves: "SV",
  goals_against: "GA",
  goals_against_average: "GAA",
  shutouts: "SO",
  save_percentage: "SV%",
  minutes: "MIN",
  yellow_cards: "YC",
  red_cards: "RC",
};

export const STAT_FULL_NAMES: Record<string, string> = {
  games_played: "Games played",
  games_started: "Games started",
  goals: "Goals",
  assists: "Assists",
  points: "Points",
  shots: "Shots",
  shots_on_goal: "Shots on goal",
  game_winning_goals: "Game-winning goals",
  saves: "Saves",
  goals_against: "Goals against",
  goals_against_average: "Goals against average",
  shutouts: "Shutouts",
  save_percentage: "Save percentage",
  minutes: "Minutes",
  yellow_cards: "Yellow cards",
  red_cards: "Red cards",
};
