import { getAuthInitData } from './telegram';
import { setAuthToken, TOKEN_KEY } from './supabase';
import type { Game, User } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const EDGE = `${SUPABASE_URL}/functions/v1`;

export interface ApiResult<T> {
  data?: T;
  error?: string;
}

async function call<T>(path: string, body?: unknown, auth = true): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${EDGE}/${path}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Network error. Check your connection.' };
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { error: json.error ?? 'Something went wrong' };
  }
  return { data: json as T };
}

export async function authenticate(): Promise<ApiResult<User>> {
  const initData = getAuthInitData();
  if (!initData) {
    return { error: 'No Telegram session available' };
  }
  const res = await call<{ token: string; user: User }>('telegram-auth', { initData }, false);
  if (res.data) {
    setAuthToken(res.data.token);
    return { data: res.data.user };
  }
  return { error: res.error };
}

/** Join/create a Quick Play game, or (with a gameId) repair/fetch a card. */
export function quickPlay(
  gameId?: string,
): Promise<ApiResult<{ game: Game; card: number[] }>> {
  return call<{ game: Game; card: number[] }>('quick-play', gameId ? { gameId } : undefined);
}

export function createRoom(opts: {
  entryFee: number;
  minPlayers: number;
  maxPlayers: number;
}): Promise<ApiResult<{ game: Game; card: number[]; roomCode: string }>> {
  return call('create-room', opts);
}

export function joinRoom(roomCode: string): Promise<ApiResult<{ game: Game; card: number[] }>> {
  return call('join-room', { roomCode });
}

export function startGame(gameId: string): Promise<ApiResult<{ started: boolean }>> {
  return call('start-game', { gameId });
}

export function claimBingo(
  gameId: string,
  pattern: string,
): Promise<ApiResult<{ winner_id: string; pattern: string; winning_numbers: number[]; prize: number }>> {
  return call('claim-bingo', { gameId, pattern });
}

export function tick(): Promise<ApiResult<{ ok: boolean }>> {
  return call('tick', undefined, false);
}
