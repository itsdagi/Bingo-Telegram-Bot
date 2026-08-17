import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { createRoom, joinRoom } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { haptic } from '../../lib/telegram';
import { formatBirr } from '../../game/bingo';
import { RoomCard } from '../../components/RoomCard/RoomCard';
import type { Game } from '../../lib/types';

const FEES = [5, 10, 25, 50];

interface ActiveRoom {
  game: Game;
  players: number;
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-tg-secondary px-3 py-2">
      <span className="text-sm font-medium text-tg-text">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="h-8 w-8 rounded-full bg-black/5 text-lg font-bold text-tg-text active:scale-90"
        >
          −
        </button>
        <span className="w-6 text-center text-base font-bold text-tg-text">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="h-8 w-8 rounded-full bg-brand text-lg font-bold text-white active:scale-90"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Rooms() {
  const { user, navigate, refreshUser } = useApp();
  const [entryFee, setEntryFee] = useState(10);
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);

  const loadActiveRooms = useCallback(async () => {
    if (!user) return;
    const { data: gp } = await supabase
      .from('game_players')
      .select('game_id')
      .eq('user_id', user.id);

    if (!gp || gp.length === 0) {
      setActiveRooms([]);
      return;
    }
    const ids = gp.map((r) => r.game_id);
    const { data: games } = await supabase
      .from('games')
      .select('*')
      .in('id', ids)
      .eq('status', 'WAITING');

    if (!games) {
      setActiveRooms([]);
      return;
    }

    const withCounts = await Promise.all(
      games.map(async (g) => {
        const { count } = await supabase
          .from('game_players')
          .select('id', { count: 'exact', head: true })
          .eq('game_id', g.id);
        return { game: g as Game, players: count ?? 0 };
      }),
    );
    setActiveRooms(withCounts);
  }, [user]);

  useEffect(() => {
    void loadActiveRooms();
  }, [loadActiveRooms]);

  const onCreate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    haptic('medium');
    const res = await createRoom({ entryFee, minPlayers, maxPlayers });
    if (res.data) {
      await refreshUser();
      navigate({ name: 'game', gameId: res.data.game.id });
    } else {
      setError(res.error ?? 'Could not create room');
    }
    setBusy(false);
  };

  const onJoin = async () => {
    if (busy || !roomCode.trim()) return;
    setBusy(true);
    setError(null);
    haptic('medium');
    const res = await joinRoom(roomCode);
    if (res.data) {
      await refreshUser();
      navigate({ name: 'game', gameId: res.data.game.id });
    } else {
      setError(res.error ?? 'Could not join room');
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pt-6">
      <h2 className="text-2xl font-extrabold text-tg-text">Rooms</h2>

      <section className="flex flex-col gap-3 rounded-2xl bg-tg-secondary p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-tg-hint">Entry Fee</h3>
        <div className="grid grid-cols-4 gap-2">
          {FEES.map((fee) => (
            <button
              key={fee}
              type="button"
              onClick={() => setEntryFee(fee)}
              className={`rounded-xl px-2 py-3 text-sm font-bold transition ${
                entryFee === fee ? 'bg-brand text-white' : 'bg-black/5 text-tg-text'
              }`}
            >
              {fee} Birr
            </button>
          ))}
        </div>

        <Stepper label="Min players" value={minPlayers} min={2} max={maxPlayers} onChange={setMinPlayers} />
        <Stepper label="Max players" value={maxPlayers} min={minPlayers} max={50} onChange={setMaxPlayers} />

        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="mt-1 w-full rounded-2xl bg-brand px-4 py-4 text-base font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? 'CREATING…' : `CREATE · ${formatBirr(entryFee)}`}
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-tg-secondary p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-tg-hint">Join with code</h3>
        <div className="flex gap-2">
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="e.g. 48291"
            inputMode="numeric"
            maxLength={6}
            className="min-w-0 flex-1 rounded-xl bg-black/5 px-4 py-3 text-center text-lg font-bold tracking-widest text-tg-text outline-none placeholder:text-tg-hint"
          />
          <button
            type="button"
            onClick={onJoin}
            disabled={busy || !roomCode.trim()}
            className="rounded-xl bg-tg-button px-5 py-3 text-base font-bold text-tg-button-text active:scale-95 disabled:opacity-60"
          >
            JOIN
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl bg-tg-danger/10 px-4 py-2 text-center text-sm text-tg-danger">{error}</div>}

      {activeRooms.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-tg-hint">Your open rooms</h3>
          {activeRooms.map(({ game, players }) => (
            <RoomCard
              key={game.id}
              game={game}
              players={players}
              onOpen={() => navigate({ name: 'game', gameId: game.id })}
            />
          ))}
        </section>
      )}
    </div>
  );
}
