import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { formatBirr } from '../../game/bingo';

export function Profile() {
  const { user } = useApp();
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [wins, setWins] = useState(0);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data } = await supabase
        .from('game_players')
        .select('status')
        .eq('user_id', user.id)
        .in('status', ['WINNER', 'LOST']);

      const rows = data ?? [];
      const won = rows.filter((r) => r.status === 'WINNER').length;
      setGamesPlayed(rows.length);
      setWins(won);
    })();
  }, [user]);

  const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;
  const displayName = user?.first_name || user?.username || 'Player';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pt-8">
      <div className="flex flex-col items-center gap-2 animate-float-in">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-2xl font-black text-white">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-xl font-bold text-tg-text">{displayName}</h2>
        {user?.username && <div className="text-sm text-tg-hint">@{user.username}</div>}
      </div>

      <div className="flex items-center justify-center gap-2 rounded-2xl bg-tg-secondary px-6 py-4">
        <span className="text-2xl">🪙</span>
        <span className="text-2xl font-extrabold text-tg-text">{formatBirr(user?.balance ?? 0)}</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Games Played" value={String(gamesPlayed)} />
        <Stat label="Wins" value={String(wins)} />
        <Stat label="Win Rate" value={`${winRate.toFixed(1)}%`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-tg-secondary px-3 py-4">
      <span className="text-xl font-extrabold text-tg-text">{value}</span>
      <span className="mt-1 text-center text-xs font-medium text-tg-hint">{label}</span>
    </div>
  );
}
