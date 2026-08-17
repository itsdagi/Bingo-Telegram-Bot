import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getUserIdFromRequest, getJwtSecret } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase.ts';

const ALLOWED_FEES = [5, 10, 25, 50];

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return jsonResponse({ error: 'Server is not configured' }, 500);

    const userId = await getUserIdFromRequest(req, jwtSecret);
    if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const entryFee = Number(body.entryFee ?? 10);
    const minPlayers = Number(body.minPlayers ?? 2);
    const maxPlayers = Number(body.maxPlayers ?? 50);

    if (!ALLOWED_FEES.includes(entryFee)) return jsonResponse({ error: 'Invalid entry fee' }, 400);
    if (
      !Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers) ||
      minPlayers < 2 || minPlayers > 50 ||
      maxPlayers < 2 || maxPlayers > 50 ||
      maxPlayers < minPlayers
    ) {
      return jsonResponse({ error: 'Invalid player limits' }, 400);
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('create_game', {
      p_creator_id: userId,
      p_entry_fee: entryFee,
      p_min_players: minPlayers,
      p_max_players: maxPlayers,
      p_is_public: false,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    const gameId = data.game_id as string;
    const { data: game } = await supabase.from('games').select('*').eq('id', gameId).single();

    return jsonResponse({ game, card: data.card, roomCode: data.room_code });
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
