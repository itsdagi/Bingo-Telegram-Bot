const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecodeToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 (Web Crypto)
// ---------------------------------------------------------------------------
export async function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

export async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  const sig = await hmacSha256(key, message);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Telegram initData verification
// ---------------------------------------------------------------------------
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Promise<{ ok: boolean; user?: TelegramUser; error?: string }> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'Missing hash' };

  const dataCheckString = Array.from(params.entries())
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const computed = await hmacSha256Hex(new Uint8Array(secretKey), dataCheckString);

  if (computed !== hash) return { ok: false, error: 'Invalid initData hash' };

  const authDate = Number(params.get('auth_date') ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) return { ok: false, error: 'initData expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, error: 'Missing user' };

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: false, error: 'Malformed user payload' };
  }

  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// JWT (HS256) — signed with the Supabase JWT secret so RLS auth.uid() works
// ---------------------------------------------------------------------------
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(full)));
  const sigBytes = new Uint8Array(await hmacSha256(encoder.encode(secret), `${h}.${p}`));
  const s = base64UrlEncode(sigBytes);
  return `${h}.${p}.${s}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<{ sub?: string; error?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'Malformed token' };
  const [h, p, s] = parts;

  const expected = base64UrlEncode(new Uint8Array(await hmacSha256(encoder.encode(secret), `${h}.${p}`)));
  if (expected !== s) return { error: 'Invalid signature' };

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecodeToBytes(p)));
  } catch {
    return { error: 'Malformed payload' };
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return { error: 'Expired token' };
  }

  return { sub: payload.sub };
}

export async function getUserIdFromRequest(req: Request, secret: string): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const { sub } = await verifyJwt(token, secret);
  return sub ?? null;
}

export function isDevAuthEnabled(): boolean {
  return Deno.env.get('DEV_AUTH_ENABLED') === 'true';
}

// The JWT signing secret. Supports both common secret names so the dashboard
// value doesn't need to be renamed.
export function getJwtSecret(): string | undefined {
  return Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
}
