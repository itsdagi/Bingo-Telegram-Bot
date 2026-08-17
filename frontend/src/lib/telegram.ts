export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
    [key: string]: unknown;
  };
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  switchInlineQuery?: (query: string, chooseChatTypes?: string[]) => void;
  openTelegramLink?: (url: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function isTelegram(): boolean {
  // The telegram-web-app.js script creates a mock WebApp object even in a
  // regular browser, so require a real initData payload to be present.
  return (
    typeof window !== 'undefined' &&
    !!window.Telegram?.WebApp &&
    typeof window.Telegram.WebApp.initData === 'string' &&
    window.Telegram.WebApp.initData.length > 0
  );
}

export function getWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

export function initTelegram(): void {
  const wa = getWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    if (wa.setHeaderColor) {
      wa.setHeaderColor(wa.colorScheme === 'dark' ? '#1c1c1e' : '#f4f4f7');
    }
  } catch {
    // ignore — non-fatal
  }
}

export function getInitData(): string {
  const wa = getWebApp();
  return wa?.initData ?? '';
}

export function getTelegramUser(): TelegramUser | null {
  const wa = getWebApp();
  return wa?.initDataUnsafe?.user ?? null;
}

export function getColorScheme(): 'light' | 'dark' {
  const wa = getWebApp();
  return wa?.colorScheme === 'dark' ? 'dark' : 'light';
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  try {
    getWebApp()?.HapticFeedback?.impactOccurred(style);
  } catch {
    // ignore
  }
}

export function hapticSuccess(): void {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred('success');
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Dev-mode fallback (used only when Telegram is absent and DEV_AUTH_ENABLED
// is true on the server).
// ---------------------------------------------------------------------------
const DEV_ID_KEY = 'bingo_dev_user_id';

export function getDevUserId(): string | null {
  return localStorage.getItem(DEV_ID_KEY);
}

export function setDevUserId(id: string): void {
  localStorage.setItem(DEV_ID_KEY, id);
}

export function getAuthInitData(): string {
  if (isTelegram()) {
    return getInitData();
  }
  const devId = getDevUserId();
  return devId ? `dev:${devId}` : '';
}
