import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { quickPlay } from '../../lib/api';
import { formatBirr } from '../../game/bingo';
import { haptic } from '../../lib/telegram';

export function Home() {
  const { user, navigate, refreshUser } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = user?.first_name || user?.username || 'Player';
  const balance = user?.balance ?? 0;

  const onQuickPlay = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    haptic('medium');
    const res = await quickPlay();
    if (res.data) {
      await refreshUser();
      navigate({ name: 'game', gameId: res.data.game.id });
    } else {
      setError(res.error ?? 'Could not start Quick Play');
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-5 pt-8">
      <div className="text-center animate-float-in">
        <h1 className="text-4xl font-black tracking-[0.35em] text-brand">BINGO</h1>
        <div className="mt-4 text-sm font-medium text-tg-hint">Welcome,</div>
        <div className="text-xl font-bold text-tg-text">{displayName}</div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-tg-secondary px-6 py-4 shadow-sm">
        <span className="text-2xl">🪙</span>
        <span className="text-2xl font-extrabold text-tg-text">{formatBirr(balance)}</span>
      </div>

      {error && <div className="w-full rounded-xl bg-tg-danger/10 px-4 py-2 text-center text-sm text-tg-danger">{error}</div>}

      <button
        type="button"
        onClick={onQuickPlay}
        disabled={busy}
        className="w-full rounded-2xl bg-tg-button px-4 py-5 text-lg font-extrabold text-tg-button-text shadow-sm transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? 'FINDING A GAME…' : '🎱 PLAY BINGO'}
      </button>

      <div className="grid w-full grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => navigate({ name: 'history' })}
          className="flex flex-col items-center gap-1 rounded-2xl bg-tg-secondary px-4 py-4 shadow-sm transition active:scale-[0.98]"
        >
          <span className="text-xl">📜</span>
          <span className="text-sm font-semibold text-tg-text">Game History</span>
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: 'profile' })}
          className="flex flex-col items-center gap-1 rounded-2xl bg-tg-secondary px-4 py-4 shadow-sm transition active:scale-[0.98]"
        >
          <span className="text-xl">👤</span>
          <span className="text-sm font-semibold text-tg-text">Profile</span>
        </button>
      </div>
    </div>
  );
}
