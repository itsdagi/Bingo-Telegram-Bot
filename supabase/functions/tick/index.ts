import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';

// Fallback game-loop ticker. Safe to call from any client: draw_next_number is
// guarded by last_draw_at so numbers can never be drawn more than once every
// 3 seconds per game, and never by the client itself.
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc('game_tick');
    if (error) return jsonResponse({ error: error.message }, 400);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
