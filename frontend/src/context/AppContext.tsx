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
import { isSupabaseConfigured, supabase, TOKEN_KEY } from '../lib/supabase';
import {
  initTelegram,
  isTelegram,
  getDevUserId,
  setDevUserId,
} from '../lib/telegram';

export type Route =
  | { name: 'home' }
  | { name: 'history' }
  | { name: 'profile' }
  | { name: 'game'; gameId: string };

export type AuthScreen = 'none' | 'dev';

const USER_KEY = 'bingo_auth_user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function isTokenExpired(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === 'PGRST301' || /jwt|token|expired/i.test(e.message ?? '');
}

interface AppContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  authScreen: AuthScreen;
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
  const [authScreen, setAuthScreen] = useState<AuthScreen>('none');
  const [route, setRoute] = useState<Route>({ name: 'home' });

  const applyAuthSuccess = useCallback((u: User) => {
    setUser(u);
    setError(null);
    setAuthScreen('none');
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      // ignore
    }
  }, []);

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

    const res = await authenticate();
    if (res.data) {
      applyAuthSuccess(res.data);
    } else {
      setError(res.error ?? 'Authentication failed');
      setAuthScreen(isTelegram() ? 'none' : 'dev');
    }
    setLoading(false);
  }, [applyAuthSuccess]);

  // Boot: restore a cached session (and validate it), otherwise auto-auth.
  useEffect(() => {
    initTelegram();

    const token = localStorage.getItem(TOKEN_KEY);
    const cached = readCachedUser();

    if (token && cached) {
      setUser(cached);
      setAuthScreen('none');
      setLoading(false);

      // Validate the session and refresh the profile/balance in the background.
      void supabase
        .from('users')
        .select('*')
        .eq('id', cached.id)
        .single()
        .then(({ data, error: e }) => {
          if (!e && data) {
            setUser(data as User);
            try {
              localStorage.setItem(USER_KEY, JSON.stringify(data));
            } catch {
              // ignore
            }
          } else if (isTokenExpired(e)) {
            // Session expired: re-authenticate automatically (Telegram).
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            setUser(null);
            if (isTelegram()) {
              void doAuth();
            } else {
              setAuthScreen('dev');
            }
          }
        });
      return;
    }

    if (isTelegram()) {
      void doAuth();
      return;
    }

    if (getDevUserId()) {
      void doAuth();
      return;
    }

    setAuthScreen('dev');
    setLoading(false);
  }, [doAuth]);

  const refreshUser = useCallback(async () => {
    if (!user) return;
    const { data, error: e } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!e && data) {
      setUser(data as User);
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    }
  }, [user]);

  const devLogin = useCallback(
    async (id: string) => {
      setDevUserId(id);
      await doAuth();
    },
    [doAuth],
  );

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setRoute({ name: 'home' });
    if (isTelegram()) {
      void doAuth();
    } else {
      setAuthScreen('dev');
    }
  }, [doAuth]);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      loading,
      error,
      authScreen,
      route,
      navigate: setRoute,
      refreshUser,
      devLogin,
      signOut,
    }),
    [user, loading, error, authScreen, route, refreshUser, devLogin, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
