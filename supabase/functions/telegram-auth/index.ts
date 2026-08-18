import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { verifyTelegramInitData, signJwt, isDevAuthEnabled, getJwtSecret, type TelegramUser } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const jwtSecret = getJwtSecret();
    if (!botToken || !jwtSecret) {
      return jsonResponse({ error: 'Server is not configured' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const initData = typeof body.initData === 'string' ? body.initData : '';
    // Phone is optional. Telegram identity is the permanent account identity.
    // If the client ever supplies a phone, link it; otherwise skip it.
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';

    let tgUser: TelegramUser | null = null;

    if (initData.startsWith('dev:')) {
      if (!isDevAuthEnabled()) {
        return jsonResponse(
          { error: 'Dev mode is disabled. Set the DEV_AUTH_ENABLED=true secret to test outside Telegram.' },
          403,
        );
      }
      const raw = initData.slice(4);
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0) {
        return jsonResponse({ error: 'Invalid dev user id' }, 400);
      }
      tgUser = { id, first_name: 'Dev User', username: 'dev' };
    } else if (initData) {
      const result = await verifyTelegramInitData(initData, botToken);
      if (!result.ok || !result.user) {
        return jsonResponse({ error: result.error ?? 'Invalid Telegram data' }, 401);
      }
      tgUser = result.user;
    } else {
      return jsonResponse({ error: 'Missing initData' }, 401);
    }

    const supabase = createAdminClient();
    const { data: user, error } = await supabase.rpc('upsert_user', {
      p_telegram_user_id: tgUser.id,
      p_phone: rawPhone || null,
      p_username: tgUser.username ?? null,
      p_first_name: tgUser.first_name ?? null,
      p_last_name: tgUser.last_name ?? null,
      p_photo_url: tgUser.photo_url ?? null,
    });

    if (error) throw error;

    const token = await signJwt(
      { sub: user.id, role: 'authenticated', telegram_user_id: tgUser.id },
      jwtSecret,
      60 * 60 * 24 * 30, // 30 days
    );

    return jsonResponse({ token, user });
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
