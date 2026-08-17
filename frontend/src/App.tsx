import { useEffect, useRef, useState } from 'react';
import { useApp, type Route } from './context/AppContext';
import { getWebApp, haptic } from './lib/telegram';
import { joinRoom } from './lib/api';
import { Home } from './pages/Home/Home';
import { Rooms } from './pages/Rooms/Rooms';
import { Game } from './pages/Game/Game';
import { History } from './pages/History/History';
import { Profile } from './pages/Profile/Profile';

export default function App() {
  const { user, loading, error, needDevLogin, route, navigate, devLogin } = useApp();

  // Deep link: t.me/Bot?startapp=room_CODE → auto-join.
  const handledDeepLink = useRef(false);
  useEffect(() => {
    if (!user || handledDeepLink.current) return;
    const sp = getWebApp()?.initDataUnsafe?.start_param;
    if (sp && sp.startsWith('room_')) {
      handledDeepLink.current = true;
      const code = sp.slice(5).toUpperCase();
      void joinRoom(code).then((res) => {
        if (res.data) navigate({ name: 'game', gameId: res.data.game.id });
      });
    }
  }, [user, navigate]);

  if (loading) return <Splash />;
  if (needDevLogin) return <DevLogin onLogin={devLogin} />;
  if (error || !user) return <ErrorScreen message={error ?? 'Not signed in'} />;

  if (route.name === 'game') {
    return <Game key={route.gameId} gameId={route.gameId} />;
  }

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-6">{renderPage(route)}</main>
      <BottomNav current={route.name} navigate={navigate} />
    </div>
  );
}

function renderPage(route: Route) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'rooms':
      return <Rooms />;
    case 'history':
      return <History />;
    case 'profile':
      return <Profile />;
    default:
      return <Home />;
  }
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-tg-bg">
      <div className="animate-pulse-soft text-5xl font-black tracking-[0.35em] text-brand">BINGO</div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-tg-text">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-tg-button px-6 py-3 font-bold text-tg-button-text"
      >
        Retry
      </button>
    </div>
  );
}

function DevLogin({ onLogin }: { onLogin: (id: string) => Promise<void> }) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
      <div className="text-3xl font-black tracking-[0.3em] text-brand">BINGO</div>
      <p className="text-sm text-tg-hint">Dev mode — enter a Telegram user id</p>
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        inputMode="numeric"
        placeholder="123456789"
        className="w-full max-w-xs rounded-xl bg-tg-secondary px-4 py-3 text-center text-lg font-bold text-tg-text outline-none"
      />
      <button
        type="button"
        disabled={busy || !id}
        onClick={async () => {
          setBusy(true);
          await onLogin(id);
          setBusy(false);
        }}
        className="w-full max-w-xs rounded-xl bg-tg-button px-6 py-3 font-bold text-tg-button-text disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Enter'}
      </button>
    </div>
  );
}

function BottomNav({ current, navigate }: { current: string; navigate: (r: Route) => void }) {
  const tabs: { name: 'home' | 'rooms' | 'history' | 'profile'; icon: string; label: string }[] = [
    { name: 'home', icon: '🏠', label: 'Home' },
    { name: 'rooms', icon: '🎫', label: 'Rooms' },
    { name: 'history', icon: '📜', label: 'History' },
    { name: 'profile', icon: '👤', label: 'Profile' },
  ];

  return (
    <nav className="safe-bottom grid grid-cols-4 border-t border-black/10 bg-tg-secondary">
      {tabs.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => {
            haptic('light');
            navigate({ name: t.name });
          }}
          className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition ${
            current === t.name ? 'text-brand' : 'text-tg-hint'
          }`}
        >
          <span className="text-lg">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
