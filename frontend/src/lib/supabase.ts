import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.warn(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env, then restart the dev server.',
  );
}

export const TOKEN_KEY = 'bingo_auth_token';

// A stable client whose requests always carry the current auth token as a
// bearer header. PostgREST verifies the token (signed with the project JWT
// secret), which is what makes RLS `auth.uid()` resolve to our user id.
function customFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const [input, init] = args;
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

// Placeholder values when unconfigured so the app can show a readable error
// screen instead of crashing on import.
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: customFetch as unknown as typeof fetch,
    },
  },
);

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  // Realtime needs the token too, for RLS-authorized postgres_changes.
  try {
    (supabase.realtime as unknown as { setAuth?: (t: string | null) => void }).setAuth?.(token);
  } catch {
    // ignore
  }
}
