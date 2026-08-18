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

    const supabase = createAdminClient();
    const body = await req.json().catch(() => ({}));

    // Repair path: the client asks for its card in a game it already belongs
    // to (e.g. the card row went missing). No join/create happens here.
    if (typeof body.gameId === 'string' && body.gameId.trim() !== '') {
      const gameId = body.gameId.trim();

      const [{ data: game }, cardRes] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.rpc('ensure_bingo_card', { p_game_id: gameId, p_user_id: userId }),
      ]);

      if (cardRes.error) return jsonResponse({ error: cardRes.error.message }, 400);
      if (!game) return jsonResponse({ error: 'Game not found' }, 404);

      return jsonResponse({ game, card: cardRes.data as number[] });
    }

    // The SQL function is idempotent; retry a couple of times to survive a
    // race where a found game fills up between lookup and join.
    let data: { game_id: string; card: number[] } | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await supabase.rpc('quick_play', { p_user_id: userId });
      if (!res.error) {
        data = res.data as { game_id: string; card: number[] };
        break;
      }
      lastError = res.error;
      if (!/full|not open/i.test(res.error.message)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!data) {
      return jsonResponse({ error: lastError?.message ?? 'Could not find a game' }, 400);
    }

    const { data: game } = await supabase.from('games').select('*').eq('id', data.game_id).single();

    return jsonResponse({ game, card: data.card });
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
