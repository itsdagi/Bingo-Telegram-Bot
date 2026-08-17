import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '../lib/types';
import { authenticate } from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  initTelegram,
  isTelegram,
  getDevUserId,
  setDevUserId,
} from '../lib/telegram';

export type Route =
  | { name: 'home' }
  | { name: 'rooms' }
  | { name: 'history' }
  | { name: 'profile' }
  | { name: 'game'; gameId: string };

interface AppContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  needDevLogin: boolean;
  route: Route;
  navigate: (route: Route) => void;
  refreshUser: () => Promise<void>;
  devLogin: (id: string) => Promise<void>;
  signOut: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needDevLogin, setNeedDevLogin] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'home' });

  const doAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!isSupabaseConfigured) {
      setError(
        'Missing Supabase configuration. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env, then restart the dev server.',
      );
      setLoading(false);
      return;
    }

    if (!isTelegram() && !getDevUserId()) {
      setNeedDevLogin(true);
      setLoading(false);
      return;
    }

    const res = await authenticate();
    if (res.data) {
      setUser(res.data);
      setNeedDevLogin(false);
    } else {
      setError(res.error ?? 'Authentication failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    initTelegram();
    void doAuth();
  }, [doAuth]);

  const refreshUser = useCallback(async () => {
    if (!user) return;
    const { data, error: e } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!e && data) setUser(data as User);
  }, [user]);

  const devLogin = useCallback(
    async (id: string) => {
      setDevUserId(id);
      setNeedDevLogin(false);
      await doAuth();
    },
    [doAuth],
  );

  const signOut = useCallback(() => {
    localStorage.removeItem('bingo_auth_token');
    setUser(null);
    setRoute({ name: 'home' });
    if (!isTelegram()) setNeedDevLogin(true);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      loading,
      error,
      needDevLogin,
      route,
      navigate: setRoute,
      refreshUser,
      devLogin,
      signOut,
    }),
    [user, loading, error, needDevLogin, route, refreshUser, devLogin, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
