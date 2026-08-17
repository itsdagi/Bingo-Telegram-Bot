import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { claimBingo, startGame, tick } from '../../lib/api';
import { haptic, hapticSuccess, getWebApp } from '../../lib/telegram';
import { formatBirr, letterForNumber } from '../../game/bingo';
import { detectBingo } from '../../game/patterns';
import { BingoCard } from '../../components/BingoCard/BingoCard';
import { GameRoom } from '../../components/GameRoom/GameRoom';
import { PlayerList, type PlayerRow } from '../../components/PlayerList/PlayerList';
import type { DrawnNumber, Game, GamePlayer, GameResult } from '../../lib/types';

interface GamePageProps {
  gameId: string;
}

export function Game({ gameId }: GamePageProps) {
  const { user, refreshUser, navigate } = useApp();
  const [game, setGame] = useState<Game | null>(null);
  const [card, setCard] = useState<number[] | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [drawn, setDrawn] = useState<DrawnNumber[]>([]);
  const [result, setResult] = useState<GameResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const channelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: g }, { data: c }, { data: p }, { data: d }, { data: r }] = await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).single(),
      supabase.from('bingo_cards').select('*').eq('game_id', gameId).eq('user_id', user.id).single(),
      supabase.from('game_players').select('*').eq('game_id', gameId).order('joined_at', { ascending: true }),
      supabase.from('drawn_numbers').select('*').eq('game_id', gameId).order('draw_order', { ascending: true }),
      supabase.from('game_results').select('*').eq('game_id', gameId).maybeSingle(),
    ]);

    if (!g) {
      setLoadError('Game not found');
      setLoading(false);
      return;
    }

    setGame(g as Game);
    setCard((c as { numbers: number[] } | null)?.numbers ?? null);
    setPlayers((p as GamePlayer[] | null) ?? []);
    setDrawn((d as DrawnNumber[] | null) ?? []);
    setResult((r as GameResult | null) ?? null);
    setLoading(false);
  }, [gameId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime subscriptions.
  useEffect(() => {
    if (!user) return;

    const chans = [
      supabase
        .channel(`game:${gameId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
          (payload) => setGame(payload.new as Game),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
          () => void load(),
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'drawn_numbers', filter: `game_id=eq.${gameId}` },
          (payload) => {
            setDrawn((prev) =>
              prev.some((n) => n.id === (payload.new as DrawnNumber).id)
                ? prev
                : [...prev, payload.new as DrawnNumber],
            );
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'game_results', filter: `game_id=eq.${gameId}` },
          async (payload) => {
            setResult(payload.new as GameResult);
            await refreshUser();
          },
        )
        .subscribe(),
    ];

    channelsRef.current = chans;
    return () => {
      chans.forEach((c) => supabase.removeChannel(c));
      channelsRef.current = [];
    };
  }, [gameId, user, load, refreshUser]);

  // Fallback ticker keeps the game moving even if pg_cron is unavailable.
  useEffect(() => {
    if (game?.status !== 'ACTIVE' && game?.status !== 'STARTING') return;
    const id = setInterval(() => void tick(), 3500);
    return () => clearInterval(id);
  }, [game?.status]);

  // Local 3-2-1 countdown while the server activates a STARTING game.
  useEffect(() => {
    if (game?.status !== 'STARTING') return;
    setCount(3);
    const id = setInterval(() => setCount((c) => (c > 1 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [game?.status]);

  const drawnSet = useMemo(() => new Set(drawn.map((d) => d.number)), [drawn]);
  const bingoPattern = useMemo(
    () => (card && game?.status === 'ACTIVE' ? detectBingo(card, drawnSet) : null),
    [card, drawnSet, game?.status],
  );

  const currentNumber = game?.current_number ?? null;

  const isCreator = user?.id != null && game?.creator_id === user.id;

  const onStart = async () => {
    if (!game) return;
    haptic('medium');
    setClaimError(null);
    const res = await startGame(game.id);
    if (res.error) setClaimError(res.error);
  };

  const onClaim = async () => {
    if (!game || !bingoPattern || claiming) return;
    setClaiming(true);
    setClaimError(null);
    hapticSuccess();
    const res = await claimBingo(game.id, bingoPattern.key);
    if (res.data) {
      await refreshUser();
      await load();
    } else {
      setClaimError(res.error ?? 'Bingo not verified');
      haptic('medium');
    }
    setClaiming(false);
  };

  const onCopy = async () => {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const onInvite = async () => {
    if (!game) return;
    const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'BingoBot';
    const shareText = `Play Bingo with me! Room code: ${game.room_code}`;
    const shareUrl = `https://t.me/${bot}?startapp=room_${game.room_code}`;

    try {
      if (navigator.share) {
        await navigator.share({ text: `${shareText} ${shareUrl}` });
        return;
      }
    } catch {
      // user cancelled — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      getWebApp()?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`);
    }
  };

  if (loading) {
    return <Centered>Loading game…</Centered>;
  }

  if (loadError || !game || !user) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-tg-text">{loadError ?? 'Game unavailable'}</p>
          <button
            type="button"
            onClick={() => navigate({ name: 'home' })}
            className="mt-4 rounded-xl bg-tg-button px-6 py-3 font-bold text-tg-button-text"
          >
            Back to Home
          </button>
        </div>
      </Centered>
    );
  }

  const playerRows: PlayerRow[] = players.map((p) => ({
    id: p.id,
    name: p.display_name || 'Player',
    status: p.status,
    isMe: p.user_id === user.id,
  }));

  // ------------------------------------------------------------------ WAITING
  if (game.status === 'WAITING') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pt-10">
        <GameRoom
          game={game}
          players={playerRows}
          isCreator={isCreator}
          isPublic={game.is_public}
          starting={false}
          onStart={onStart}
          onInvite={onInvite}
          onCopy={onCopy}
        />
        {copied && <div className="text-center text-sm text-tg-hint">Copied!</div>}
        {claimError && <div className="text-center text-sm text-tg-danger">{claimError}</div>}
      </div>
    );
  }

  // ----------------------------------------------------------------- STARTING
  if (game.status === 'STARTING') {
    return (
      <Centered>
        <div className="text-center">
          <div className="text-sm font-semibold uppercase tracking-widest text-tg-hint">Game starting</div>
          <div key={count} className="mt-6 animate-count-pop text-8xl font-black text-brand">
            {count > 0 ? count : 'GO!'}
          </div>
          <div className="mt-6 text-sm text-tg-hint">
            {players.length} players · {formatBirr(game.entry_fee)} entry
          </div>
        </div>
      </Centered>
    );
  }

  // ----------------------------------------------------------------- COMPLETED
  if (game.status === 'COMPLETED') {
    const iWon = game.winner_id === user.id;
    const winner = playerRows.find((p) => p.status === 'WINNER');
    const prize = result ? game.entry_fee * players.length : 0;

    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 animate-float-in">
          <div className="text-6xl">{iWon ? '🎉' : '🏁'}</div>
          <div className="text-center">
            <div className="text-2xl font-black text-tg-text">
              {iWon ? 'BINGO! You won' : `${winner?.name ?? 'Someone'} won`}
            </div>
            {iWon && (
              <div className="mt-2 text-xl font-bold text-brand">+{formatBirr(prize)}</div>
            )}
            {result && (
              <div className="mt-2 text-sm text-tg-hint">
                Winning line · {result.winning_numbers.join(' · ')}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate({ name: 'home' })}
            className="mt-4 w-full rounded-2xl bg-tg-button px-6 py-4 text-base font-extrabold text-tg-button-text active:scale-[0.98]"
          >
            PLAY AGAIN
          </button>
        </div>
      </Centered>
    );
  }

  // ------------------------------------------------------------------- ACTIVE
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 pt-4">
      <div className="flex w-full items-center justify-between">
        <span className="text-lg font-black tracking-widest text-brand">BINGO</span>
        <span className="text-sm font-bold text-tg-text">🪙 {formatBirr(user.balance)}</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-widest text-tg-hint">Current number</span>
        {currentNumber ? (
          <div className="animate-pulse-soft rounded-3xl bg-brand px-10 py-4 text-5xl font-black text-white shadow-lg">
            {letterForNumber(currentNumber)}-{currentNumber}
          </div>
        ) : (
          <div className="rounded-3xl bg-black/5 px-10 py-4 text-5xl font-black text-tg-hint">—</div>
        )}
      </div>

      {card ? (
        <BingoCard
          card={card}
          drawn={drawnSet}
          currentNumber={currentNumber}
          winningCells={result?.winning_numbers.map((n) => card.indexOf(n)) ?? undefined}
        />
      ) : (
        <div className="text-tg-hint">Loading your card…</div>
      )}

      <div className="w-full">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-tg-hint">
          Numbers drawn · {drawn.length}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {drawn
            .slice()
            .reverse()
            .map((d) => (
              <div
                key={d.id}
                className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-tg-secondary px-2 text-xs font-bold text-tg-text"
              >
                {letterForNumber(d.number)}{d.number}
              </div>
            ))}
          {drawn.length === 0 && <span className="text-xs text-tg-hint">Waiting for the first number…</span>}
        </div>
      </div>

      {claimError && (
        <div className="w-full rounded-xl bg-tg-danger/10 px-4 py-2 text-center text-sm text-tg-danger">
          {claimError}
        </div>
      )}

      <button
        type="button"
        onClick={onClaim}
        disabled={!bingoPattern || claiming}
        className={`w-full rounded-2xl px-4 py-5 text-xl font-black tracking-[0.2em] transition active:scale-[0.98] ${
          bingoPattern
            ? 'bg-brand text-white animate-glow'
            : 'bg-black/10 text-tg-hint'
        }`}
      >
        {claiming ? 'CHECKING…' : 'BINGO'}
      </button>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-6 py-10">
      {children}
    </div>
  );
}
