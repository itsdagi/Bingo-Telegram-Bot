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
    const roomCode = String(body.roomCode ?? '').trim().toUpperCase();
    if (!roomCode) return jsonResponse({ error: 'Enter a room code' }, 400);

    const supabase = createAdminClient();
    const { data: game } = await supabase
      .from('games')
      .select('*')
      .eq('room_code', roomCode)
      .maybeSingle();

    if (!game) return jsonResponse({ error: 'Room not found' }, 404);
    if (game.status !== 'WAITING') return jsonResponse({ error: 'This game has already started' }, 400);

    const { data, error } = await supabase.rpc('join_game', {
      p_game_id: game.id,
      p_user_id: userId,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    return jsonResponse({ game, card: data.card });
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
