-- ============================================================================
-- Game states + authoritative game loop
--
--   1. Add a WON state (winner confirmed) distinct from COMPLETED (no winner).
--   2. Add FOUR_CORNERS to the supported winning patterns.
--   3. Extract `resolve_win()` (atomic winner resolution) shared by claims and
--      automatic detection.
--   4. `verify_and_resolve_win()` (manual claim) now delegates to `resolve_win`.
--   5. `auto_detect_and_resolve()` evaluates EVERY active card after a draw so
--      a winner is detected server-side without the player pressing BINGO.
--   6. `draw_next_number()` auto-detects a winner after each draw and ends with
--      COMPLETED only when all 75 numbers are drawn with no winner.
--   7. `game_tick()` auto-starts stale public waiting games so the loop always
--      advances (even with a single player).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add the WON state.
-- ---------------------------------------------------------------------------
alter type public.game_status add value if not exists 'WON' after 'ACTIVE';

-- Record the winning card and the draw that produced the Bingo.
alter table public.game_results
  add column if not exists winning_card int[],
  add column if not exists winning_draw_order int;

-- ---------------------------------------------------------------------------
-- 2. Pattern support: FOUR_CORNERS.
-- ---------------------------------------------------------------------------
create or replace function public.is_pattern_complete(card int[], drawn int[], pattern text) returns boolean as $$
declare
  i int;
  idx int;
begin
  if pattern like 'ROW_%' then
    i := (substring(pattern from 5))::int;
    for idx in 0..4 loop
      if not public.cell_marked(card, drawn, i * 5 + idx + 1) then return false; end if;
    end loop;
    return true;

  elsif pattern like 'COL_%' then
    i := (substring(pattern from 5))::int;
    for idx in 0..4 loop
      if not public.cell_marked(card, drawn, idx * 5 + i + 1) then return false; end if;
    end loop;
    return true;

  elsif pattern = 'DIAG_MAIN' then
    for idx in 0..4 loop
      if not public.cell_marked(card, drawn, idx * 5 + idx + 1) then return false; end if;
    end loop;
    return true;

  elsif pattern = 'DIAG_ANTI' then
    for idx in 0..4 loop
      if not public.cell_marked(card, drawn, idx * 5 + (4 - idx) + 1) then return false; end if;
    end loop;
    return true;

  elsif pattern = 'FOUR_CORNERS' then
    return public.cell_marked(card, drawn, 1)
       and public.cell_marked(card, drawn, 5)
       and public.cell_marked(card, drawn, 21)
       and public.cell_marked(card, drawn, 25);
  end if;

  return false;
end $$ language plpgsql immutable;

create or replace function public.pattern_numbers(card int[], pattern text) returns int[] as $$
declare
  i int;
  idx int;
  res int[] := '{}';
begin
  if pattern like 'ROW_%' then
    i := (substring(pattern from 5))::int;
    for idx in 0..4 loop
      res := res || card[i * 5 + idx + 1];
    end loop;
  elsif pattern like 'COL_%' then
    i := (substring(pattern from 5))::int;
    for idx in 0..4 loop
      res := res || card[idx * 5 + i + 1];
    end loop;
  elsif pattern = 'DIAG_MAIN' then
    for idx in 0..4 loop
      res := res || card[idx * 5 + idx + 1];
    end loop;
  elsif pattern = 'DIAG_ANTI' then
    for idx in 0..4 loop
      res := res || card[idx * 5 + (4 - idx) + 1];
    end loop;
  elsif pattern = 'FOUR_CORNERS' then
    res := array[card[1], card[5], card[21], card[25]];
  end if;
  return res;
end $$ language plpgsql immutable;

-- ---------------------------------------------------------------------------
-- 3. Atomic winner resolution (single source of truth).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_win(
  p_game_id uuid,
  p_user_id uuid,
  p_pattern text
) returns json as $$
declare
  v_game public.games%rowtype;
  v_card int[];
  v_drawn int[];
  v_winning int[];
  v_prize bigint;
  v_num_players int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'ACTIVE' then
    raise exception 'Game is not active';
  end if;

  select numbers into v_card from public.bingo_cards
    where game_id = p_game_id and user_id = p_user_id;
  if not found then
    raise exception 'Bingo card not found';
  end if;

  select coalesce(array_agg(number order by draw_order), '{}') into v_drawn
    from public.drawn_numbers where game_id = p_game_id;

  if not public.is_pattern_complete(v_card, v_drawn, p_pattern) then
    raise exception 'The claimed Bingo pattern is not valid';
  end if;

  v_winning := public.pattern_numbers(v_card, p_pattern);

  -- Count participants once, before statuses change.
  select count(*) into v_num_players from public.game_players
    where game_id = p_game_id and status <> 'LEFT';

  -- Lock/complete the game exactly once.
  update public.games
    set status = 'WON', winner_id = p_user_id, ended_at = now(), updated_at = now()
    where id = p_game_id;

  update public.game_players
    set status = case when user_id = p_user_id then 'WINNER' else 'LOST' end
    where game_id = p_game_id and status <> 'LEFT';

  insert into public.game_results
    (game_id, winner_id, winning_pattern, winning_numbers, winning_card, winning_draw_order, completed_at)
    values
    (p_game_id, p_user_id, p_pattern, v_winning, v_card, v_game.current_draw_order, now());

  v_prize := v_game.entry_fee * v_num_players;

  if v_prize > 0 then
    perform public.apply_transaction(p_user_id, v_prize, 'GAME_WIN', p_game_id);
  end if;

  return json_build_object(
    'winner_id', p_user_id,
    'pattern', p_pattern,
    'winning_numbers', v_winning,
    'prize', v_prize
  );
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Manual claim: verify, then resolve.
-- ---------------------------------------------------------------------------
create or replace function public.verify_and_resolve_win(
  p_game_id uuid,
  p_user_id uuid,
  p_pattern text
) returns json as $$
declare
  v_game public.games%rowtype;
  v_player public.game_players%rowtype;
  v_card int[];
  v_drawn int[];
  v_ok boolean;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'ACTIVE' then
    raise exception 'Game is not active';
  end if;

  select * into v_player from public.game_players
    where game_id = p_game_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'You are not a player in this game';
  end if;
  if v_player.status = 'WINNER' then
    raise exception 'You have already claimed Bingo';
  end if;

  select numbers into v_card from public.bingo_cards
    where game_id = p_game_id and user_id = p_user_id;
  if not found then
    raise exception 'Bingo card not found';
  end if;

  select coalesce(array_agg(number order by draw_order), '{}') into v_drawn
    from public.drawn_numbers where game_id = p_game_id;

  v_ok := public.is_pattern_complete(v_card, v_drawn, p_pattern);
  if not v_ok then
    raise exception 'That''s not Bingo yet.';
  end if;

  return public.resolve_win(p_game_id, p_user_id, p_pattern);
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Automatic Bingo detection across all active players.
-- ---------------------------------------------------------------------------
create or replace function public.auto_detect_and_resolve(p_game_id uuid) returns json as $$
declare
  v_game public.games%rowtype;
  v_player record;
  v_card int[];
  v_drawn int[];
  v_pattern text;
  v_patterns text[] := array[
    'ROW_0','ROW_1','ROW_2','ROW_3','ROW_4',
    'COL_0','COL_1','COL_2','COL_3','COL_4',
    'DIAG_MAIN','DIAG_ANTI','FOUR_CORNERS'
  ];
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.status <> 'ACTIVE' then
    return null;
  end if;

  select coalesce(array_agg(number order by draw_order), '{}') into v_drawn
    from public.drawn_numbers where game_id = p_game_id;

  for v_player in
    select gp.user_id from public.game_players gp
    where gp.game_id = p_game_id and gp.status <> 'LEFT'
  loop
    select numbers into v_card from public.bingo_cards
      where game_id = p_game_id and user_id = v_player.user_id;

    if v_card is not null then
      foreach v_pattern in array v_patterns loop
        if public.is_pattern_complete(v_card, v_drawn, v_pattern) then
          return public.resolve_win(p_game_id, v_player.user_id, v_pattern);
        end if;
      end loop;
    end if;
  end loop;

  return null;
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 6. Draw the next number + continuous detection + no-winner completion.
-- ---------------------------------------------------------------------------
create or replace function public.draw_next_number(p_game_id uuid) returns int as $$
declare
  v_game public.games%rowtype;
  v_num int;
  v_order int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.status <> 'ACTIVE' then
    return null;
  end if;

  if now() - v_game.last_draw_at < interval '3 seconds' then
    return null;
  end if;

  select coalesce(max(draw_order), 0) into v_order from public.drawn_numbers where game_id = p_game_id;

  if v_order >= 75 then
    update public.games set status = 'COMPLETED', ended_at = now(), updated_at = now()
      where id = p_game_id and status = 'ACTIVE';
    return null;
  end if;

  loop
    v_num := floor(random() * 75 + 1)::int;
    exit when not exists (select 1 from public.drawn_numbers where game_id = p_game_id and number = v_num);
  end loop;

  insert into public.drawn_numbers (game_id, number, draw_order, drawn_at)
    values (p_game_id, v_num, v_order + 1, now());

  update public.games
    set current_number = v_num, current_draw_order = v_order + 1, last_draw_at = now(), updated_at = now()
    where id = p_game_id;

  -- Continuous Bingo detection: resolve a winner immediately if one exists.
  perform public.auto_detect_and_resolve(p_game_id);

  -- If this was the final number and nobody won, end with no winner.
  if v_order + 1 >= 75 then
    update public.games set status = 'COMPLETED', ended_at = now(), updated_at = now()
      where id = p_game_id and status = 'ACTIVE';
  end if;

  return v_num;
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 7. Game tick: auto-start stale waiting games, activate STARTING games, draw.
-- ---------------------------------------------------------------------------
create or replace function public.game_tick() returns void as $$
declare
  g record;
begin
  -- Auto-start public WAITING games that already have a player and have been
  -- waiting long enough (keeps the loop moving even for a solo player).
  update public.games
    set status = 'STARTING', started_at = now(), updated_at = now()
    where status = 'WAITING'
      and is_public = true
      and created_at < now() - interval '60 seconds'
      and exists (select 1 from public.game_players gp where gp.game_id = id);

  -- Activate STARTING games after the 3-2-1 window.
  update public.games
    set status = 'ACTIVE', updated_at = now()
    where status = 'STARTING' and started_at < now() - interval '3 seconds';

  -- Draw + auto-detect for every active game.
  for g in select id from public.games where status = 'ACTIVE' loop
    perform public.draw_next_number(g.id);
  end loop;
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 8. Re-apply function privileges for the new functions.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
