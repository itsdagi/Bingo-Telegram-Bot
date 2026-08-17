export type GameStatus = 'WAITING' | 'STARTING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type GamePlayerStatus = 'JOINED' | 'LEFT' | 'WINNER' | 'LOST';
export type TransactionType =
  | 'WELCOME_BONUS'
  | 'GAME_ENTRY'
  | 'GAME_WIN'
  | 'DAILY_REWARD'
  | 'ADMIN_ADJUSTMENT';

export interface User {
  id: string;
  telegram_user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  room_code: string;
  status: GameStatus;
  min_players: number;
  max_players: number;
  entry_fee: number;
  is_public: boolean;
  creator_id: string | null;
  current_number: number | null;
  current_draw_order: number;
  last_draw_at: string;
  started_at: string | null;
  ended_at: string | null;
  winner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GamePlayer {
  id: string;
  game_id: string;
  user_id: string;
  card_id: string | null;
  display_name: string | null;
  status: GamePlayerStatus;
  joined_at: string;
}

export interface BingoCard {
  id: string;
  game_id: string;
  user_id: string;
  numbers: number[];
  created_at: string;
}

export interface DrawnNumber {
  id: string;
  game_id: string;
  number: number;
  draw_order: number;
  drawn_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: TransactionType;
  reference_id: string | null;
  created_at: string;
}

export interface GameResult {
  id: string;
  game_id: string;
  winner_id: string;
  winning_pattern: string;
  winning_numbers: number[];
  completed_at: string;
}
