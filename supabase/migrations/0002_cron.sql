-- ============================================================================
-- Game loop scheduler (pg_cron)
--
-- Enable the `pg_cron` extension in Supabase (Database → Extensions) before
-- running this migration. If pg_cron is unavailable, the game still works via
-- the `tick` Edge Function (the frontend calls it every few seconds), because
-- draw_next_number is guarded by last_draw_at.
-- ============================================================================

create extension if not exists pg_cron;

select cron.schedule(
  'bingo-game-tick',
  '3 seconds',
  $$ select public.game_tick(); $$
);
