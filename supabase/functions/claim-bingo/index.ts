import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getUserIdFromRequest, getJwtSecret } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase.ts';

const VALID_PATTERN = /^(ROW|COL)_[0-4]$|^DIAG_MAIN$|^DIAG_ANTI$|^FOUR_CORNERS$/;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return jsonResponse({ error: 'Server is not configured' }, 500);

    const userId = await getUserIdFromRequest(req, jwtSecret);
    if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const gameId = body.gameId;
    const pattern = body.pattern;

    if (typeof gameId !== 'string') return jsonResponse({ error: 'gameId required' }, 400);
    if (typeof pattern !== 'string' || !VALID_PATTERN.test(pattern)) {
      return jsonResponse({ error: 'Invalid pattern' }, 400);
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('verify_and_resolve_win', {
      p_game_id: gameId,
      p_user_id: userId,
      p_pattern: pattern,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
