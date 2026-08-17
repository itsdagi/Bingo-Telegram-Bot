import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { formatBirr } from '../../game/bingo';
import type { Game, GamePlayer, GameResult } from '../../lib/types';

interface HistoryRow {
  game: Game;
  won: boolean;
  amount: number;
  result: GameResult | null;
}

export function History() {
  const { user } = useApp();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    (async () => {
      setLoading(true);
      const { data: myRows } = await supabase
        .from('game_players')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['WINNER', 'LOST'])
        .order('joined_at', { ascending: false });

      if (!myRows || myRows.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const gameIds = [...new Set((myRows as GamePlayer[]).map((r) => r.game_id))];

      const [{ data: games }, { data: results }, { data: allPlayers }] = await Promise.all([
        supabase.from('games').select('*').in('id', gameIds),
        supabase.from('game_results').select('*').in('game_id', gameIds),
        supabase.from('game_players').select('game_id').in('game_id', gameIds),
      ]);

      const gameMap = new Map((games as Game[] | null)?.map((g) => [g.id, g]) ?? []);
      const resultMap = new Map((results as GameResult[] | null)?.map((r) => [r.game_id, r]) ?? []);
      const countMap = new Map<string, number>();
      for (const p of (allPlayers as { game_id: string }[] | null) ?? []) {
        countMap.set(p.game_id, (countMap.get(p.game_id) ?? 0) + 1);
      }

      const built: HistoryRow[] = (myRows as GamePlayer[])
        .filter((r) => gameMap.has(r.game_id))
        .map((r) => {
          const g = gameMap.get(r.game_id)!;
          const won = r.status === 'WINNER';
          const count = countMap.get(r.game_id) ?? 1;
          return {
            game: g,
            won,
            amount: won ? g.entry_fee * count : -g.entry_fee,
            result: resultMap.get(r.game_id) ?? null,
          };
        });

      setRows(built);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-6">
      <h2 className="text-2xl font-extrabold text-tg-text">Game History</h2>

      {loading && <p className="text-sm text-tg-hint">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="rounded-2xl bg-tg-secondary px-4 py-8 text-center text-sm text-tg-hint">
          No games yet. Play your first game!
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map(({ game, won, amount }) => (
          <li
            key={game.id}
            className="flex items-center justify-between rounded-2xl bg-tg-secondary px-4 py-3"
          >
            <div>
              <div className="text-sm font-bold text-tg-text">Game #{game.room_code}</div>
              <div className="text-xs text-tg-hint">
                {game.entry_fee > 0 ? formatBirr(game.entry_fee) : 'Free'} entry
              </div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-black ${won ? 'text-brand' : 'text-tg-danger'}`}>
                {won ? 'WIN' : 'LOSS'}
              </div>
              <div className={`text-sm font-bold ${won ? 'text-brand' : 'text-tg-text'}`}>
                {won ? '+' : ''}
                {formatBirr(amount)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
