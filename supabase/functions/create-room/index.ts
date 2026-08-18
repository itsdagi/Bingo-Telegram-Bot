import { handleCors, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    // Room creation is disabled: players can only JOIN existing games.
    // The `create_game` SQL function remains service-role-only for internal
    // use (Quick Play / future admin tooling).
    return jsonResponse({ error: 'Room creation is disabled. Use Play Bingo to join a game.' }, 403);
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Unexpected error' }, 400);
  }
});
