import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getUserIdFromRequest, getJwtSecret } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase.ts';

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
    if (typeof gameId !== 'string') return jsonResponse({ error: 'gameId required' }, 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('start_game', {
      p_game_id: gameId,
      p_user_id: userId,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
