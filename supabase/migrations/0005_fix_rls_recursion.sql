-- ============================================================================
-- Fix infinite recursion in Row Level Security policies
--
-- The SELECT policies shipped in 0001 referenced each other:
--   games_select         -> subquery on game_players
--   game_players_select  -> subquery on games AND game_players
--   drawn_numbers_select -> subquery on games AND game_players
--   game_results_select  -> subquery on games AND game_players
--
-- PostgREST/Postgres rejects this with:
--   "infinite recursion detected in policy for relation \"games\"" (SQLSTATE 42P17)
--
-- Fix: move the "is this game public/open" and "is this user a participant"
-- checks into SECURITY DEFINER helper functions (owned by the migration role,
-- so they bypass RLS). The policies then call only the helpers, breaking the
-- recursion.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER -> bypass RLS, no recursion).
-- ---------------------------------------------------------------------------
create or replace function public.is_game_participant(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.game_players gp
    where gp.game_id = p_game_id
      and gp.user_id = p_user_id
  );
$$;

create or replace function public.is_public_game(p_game_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and g.is_public = true
      and g.status in ('WAITING', 'STARTING')
  );
$$;

-- ---------------------------------------------------------------------------
-- Rewrite the recursive SELECT policies.
-- ---------------------------------------------------------------------------
drop policy if exists games_select on public.games;
create policy games_select on public.games for select
  using (
    public.is_public_game(id)
    or public.is_game_participant(id, auth.uid())
  );

drop policy if exists game_players_select on public.game_players;
create policy game_players_select on public.game_players for select
  using (
    user_id = auth.uid()
    or public.is_public_game(game_id)
    or public.is_game_participant(game_id, auth.uid())
  );

drop policy if exists drawn_numbers_select on public.drawn_numbers;
create policy drawn_numbers_select on public.drawn_numbers for select
  using (
    public.is_public_game(game_id)
    or public.is_game_participant(game_id, auth.uid())
  );

drop policy if exists game_results_select on public.game_results;
create policy game_results_select on public.game_results for select
  using (
    public.is_public_game(game_id)
    or public.is_game_participant(game_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Privileges: keep everything else service-role-only, but let RLS call the
-- two helpers for the anon/authenticated roles.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.is_public_game(uuid) to anon, authenticated;
grant execute on function public.is_game_participant(uuid, uuid) to anon, authenticated;
