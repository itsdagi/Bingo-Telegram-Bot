import { useState } from 'react';
import { haptic } from '../../lib/telegram';
import { normalizePhone } from '../../lib/telegram';

interface AuthProps {
  onLogin: (phone: string) => Promise<void>;
  error?: string | null;
}

export function Auth({ onLogin, error }: AuthProps) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const digits = phone.replace(/[^0-9+]/g, '');
  const valid = digits.length >= 7;
  const shownError = error ?? localError;

  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setLocalError(null);
    haptic('medium');
    try {
      await onLogin(normalizePhone(digits));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <div className="text-4xl font-black tracking-[0.35em] text-brand">BINGO</div>
        <div className="mt-4 text-sm font-medium text-tg-hint">Welcome</div>
        <div className="text-lg font-bold text-tg-text">Enter your phone number</div>
      </div>

      <div className="flex w-full max-w-xs items-center gap-2 rounded-2xl bg-tg-secondary px-4 py-3 shadow-sm">
        <span className="text-lg font-extrabold text-tg-text">+251</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="9 __ __ __ __"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-lg font-bold tracking-wider text-tg-text outline-none placeholder:text-tg-hint"
        />
      </div>

      {shownError && (
        <div className="w-full max-w-xs rounded-xl bg-tg-danger/10 px-4 py-2 text-center text-sm text-tg-danger">
          {shownError}
        </div>
      )}

      <button
        type="button"
        disabled={busy || !valid}
        onClick={submit}
        className="w-full max-w-xs rounded-2xl bg-tg-button px-6 py-4 text-lg font-extrabold text-tg-button-text shadow-sm transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? 'VERIFYING…' : 'CONTINUE'}
      </button>
    </div>
  );
}
