-- ============================================================================
-- Phone authentication + game-loop hardening
--
-- Changes:
--   1. Add `users.phone` (unique, nullable) and make `telegram_user_id` nullable
--      so a Telegram identity can be linked to a phone-verified account.
--   2. Add `normalize_phone()` and `upsert_user()` (phone-aware, idempotent,
--      one welcome bonus per account).
--   3. Add `ensure_bingo_card()` — authoritative card lookup/creation so a
--      player is never left without a card.
--   4. Make `join_game()` idempotent and re-use `ensure_bingo_card()`.
--   5. Rewrite `quick_play()` so it resumes any active membership, repairs
--      missing cards, and always returns a game + card.
--   6. Fix `verify_and_resolve_win()` to count only joined players and never
--      overwrite LEFT players.
--   7. Publish `bingo_cards` to realtime.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: phone column + nullable telegram_user_id
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists phone text;

alter table public.users
  add constraint users_phone_unique unique (phone);

alter table public.users
  alter column telegram_user_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Phone normalization
-- ---------------------------------------------------------------------------
create or replace function public.normalize_phone(p_phone text) returns text as $$
declare
  cleaned text;
begin
  if p_phone is null then
    return null;
  end if;

  -- Keep only digits and an optional leading '+'.
  cleaned := regexp_replace(p_phone, '[^0-9+]', '', 'g');
  if cleaned like '+%' then
    cleaned := '+' || regexp_replace(substr(cleaned, 2), '[^0-9]', '', 'g');
  else
    cleaned := '+' || regexp_replace(cleaned, '[^0-9]', '', 'g');
  end if;

  if cleaned = '+' then
    return null;
  end if;

  if not cleaned ~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone number';
  end if;

  return cleaned;
end $$ language plpgsql immutable;

-- ---------------------------------------------------------------------------
-- Phone-aware upsert. Idempotent: same phone / same Telegram id → same account.
-- One welcome bonus per account, enforced via the transactions table.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_user(
  p_telegram_user_id bigint,
  p_phone text,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
) returns public.users as $$
declare
  v_user public.users%rowtype;
  v_phone text := public.normalize_phone(p_phone);
  v_found boolean := false;
begin
  -- 1) Existing account by Telegram identity.
  if p_telegram_user_id is not null then
    select * into v_user from public.users
      where telegram_user_id = p_telegram_user_id
      for update;
    v_found := found;

    if v_found then
      if v_phone is not null and exists (
        select 1 from public.users where phone = v_phone and id <> v_user.id
      ) then
        raise exception 'This phone number is already registered to another account';
      end if;

      update public.users set
        username   = coalesce(p_username,   users.username),
        first_name = coalesce(p_first_name, users.first_name),
        last_name  = coalesce(p_last_name,  users.last_name),
        photo_url  = coalesce(p_photo_url,  users.photo_url),
        phone      = coalesce(v_phone,      users.phone),
        updated_at = now()
      where id = v_user.id;
    end if;
  end if;

  -- 2) No Telegram match: look up (or create) by phone.
  if not v_found then
    if v_phone is not null then
      select * into v_user from public.users
        where phone = v_phone
        for update;
      v_found := found;

      if v_found then
        -- Link this Telegram identity to the existing phone account.
        if v_user.telegram_user_id is not null and v_user.telegram_user_id <> p_telegram_user_id then
          raise exception 'This phone number is already registered to another account';
        end if;

        update public.users set
          telegram_user_id = coalesce(p_telegram_user_id, users.telegram_user_id),
          username   = coalesce(p_username,   users.username),
          first_name = coalesce(p_first_name, users.first_name),
          last_name  = coalesce(p_last_name,  users.last_name),
          photo_url  = coalesce(p_photo_url,  users.photo_url),
          updated_at = now()
        where id = v_user.id;
      end if;
    end if;
  end if;

  -- 3) Still nothing: create the account.
  if not v_found then
    insert into public.users
      (telegram_user_id, phone, username, first_name, last_name, photo_url, balance)
    values
      (p_telegram_user_id, v_phone, p_username, p_first_name, p_last_name, p_photo_url, 0)
    returning * into v_user;
  end if;

  -- 4) One-time welcome bonus.
  if not exists (
    select 1 from public.transactions
    where user_id = v_user.id and type = 'WELCOME_BONUS'
  ) then
    perform public.apply_transaction(v_user.id, 1000, 'WELCOME_BONUS', null);
  end if;

  select * into v_user from public.users where id = v_user.id;
  return v_user;
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 3. Authoritative card lookup/creation.
--    Guarantees exactly one card per (game, user). Safe to call repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_bingo_card(p_game_id uuid, p_user_id uuid) returns int[] as $$
declare
  v_card int[];
  v_card_id uuid;
begin
  if not exists (
    select 1 from public.game_players where game_id = p_game_id and user_id = p_user_id
  ) then
    raise exception 'You are not a player in this game';
  end if;

  select numbers into v_card from public.bingo_cards
    where game_id = p_game_id and user_id = p_user_id;

  if v_card is not null then
    return v_card;
  end if;

  v_card := public.generate_bingo_card();

  insert into public.bingo_cards (game_id, user_id, numbers)
    values (p_game_id, p_user_id, v_card)
    on conflict (game_id, user_id) do update
      set numbers = excluded.numbers
    returning id into v_card_id;

  update public.game_players set card_id = v_card_id
    where game_id = p_game_id and user_id = p_user_id;

  return v_card;
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Idempotent join_game: returning players get their existing (or repaired)
--    card instead of an error. Entry fee is only charged once.
-- ---------------------------------------------------------------------------
create or replace function public.join_game(p_game_id uuid, p_user_id uuid) returns json as $$
declare
  v_game public.games%rowtype;
  v_balance bigint;
  v_card int[];
  v_card_id uuid;
  v_count int;
  v_player_id uuid;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'WAITING' then
    raise exception 'Game is not open for joining';
  end if;

  select id into v_player_id from public.game_players
    where game_id = p_game_id and user_id = p_user_id;

  if v_player_id is not null then
    -- Already joined: repair/return the card, never double-charge.
    v_card := public.ensure_bingo_card(p_game_id, p_user_id);
    return json_build_object('card', v_card);
  end if;

  select count(*) into v_count from public.game_players where game_id = p_game_id;
  if v_count >= v_game.max_players then
    raise exception 'Game is full';
  end if;

  if v_game.entry_fee > 0 then
    select balance into v_balance from public.users where id = p_user_id for update;
    if v_balance < v_game.entry_fee then
      raise exception 'Insufficient Birr for the entry fee';
    end if;
    perform public.apply_transaction(p_user_id, -v_game.entry_fee, 'GAME_ENTRY', p_game_id);
  end if;

  v_card := public.generate_bingo_card();

  insert into public.bingo_cards (game_id, user_id, numbers)
    values (p_game_id, p_user_id, v_card)
    returning id into v_card_id;

  insert into public.game_players (game_id, user_id, card_id, display_name, status)
  select p_game_id, p_user_id, v_card_id,
         coalesce(nullif(trim(first_name), ''), username, 'Player'),
         'JOINED'
  from public.users
  where id = p_user_id;

  return json_build_object('card', v_card, 'card_id', v_card_id);
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Rewritten quick_play:
--    - resume any active membership (WAITING/STARTING/ACTIVE) with a repaired card
--    - else join the oldest open public game
--    - else create a fresh public game
--    - auto-start when it reaches min_players
-- ---------------------------------------------------------------------------
create or replace function public.quick_play(p_user_id uuid) returns json as $$
declare
  v_game_id uuid;
  v_card int[];
  v_result json;
  v_count int;
begin
  -- Resume the user's most recent public game, whatever its stage.
  select g.id into v_game_id
  from public.games g
  join public.game_players gp on gp.game_id = g.id
  where gp.user_id = p_user_id
    and g.is_public
    and g.status in ('WAITING', 'STARTING', 'ACTIVE')
  order by g.created_at desc
  limit 1;

  if v_game_id is not null then
    v_card := public.ensure_bingo_card(v_game_id, p_user_id);
    return json_build_object('game_id', v_game_id, 'card', v_card);
  end if;

  -- Find the oldest open public game with room.
  select g.id into v_game_id
  from public.games g
  where g.is_public
    and g.status = 'WAITING'
    and (select count(*) from public.game_players gp where gp.game_id = g.id) < g.max_players
  order by g.created_at asc
  limit 1;

  if v_game_id is null then
    v_result := public.create_game(p_user_id, 10, 2, 50, true);
    v_game_id := (v_result ->> 'game_id')::uuid;
  else
    perform public.join_game(v_game_id, p_user_id);
  end if;

  v_card := public.ensure_bingo_card(v_game_id, p_user_id);

  select count(*) into v_count from public.game_players where game_id = v_game_id;
  if v_count >= 2 then
    update public.games
      set status = 'STARTING', started_at = now(), updated_at = now()
      where id = v_game_id and status = 'WAITING';
  end if;

  return json_build_object('game_id', v_game_id, 'card', v_card);
end $$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 6. Correct winner resolution: count joined players before rewriting statuses
--    and never flip LEFT players to LOST.
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
  v_winning int[];
  v_prize bigint;
  v_num_players int;
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
    raise exception 'The claimed Bingo pattern is not valid';
  end if;

  v_winning := public.pattern_numbers(v_card, p_pattern);

  -- Count participants once, before statuses change.
  select count(*) into v_num_players from public.game_players
    where game_id = p_game_id and status <> 'LEFT';

  -- Resolve the game exactly once.
  update public.games
    set status = 'COMPLETED', winner_id = p_user_id, ended_at = now(), updated_at = now()
    where id = p_game_id;

  update public.game_players
    set status = case when user_id = p_user_id then 'WINNER' else 'LOST' end
    where game_id = p_game_id and status <> 'LEFT';

  insert into public.game_results (game_id, winner_id, winning_pattern, winning_numbers, completed_at)
    values (p_game_id, p_user_id, p_pattern, v_winning, now());

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
-- 7. Realtime publication for cards (future-proofing).
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.bingo_cards;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Re-apply function privileges: new functions are created with default
--    PUBLIC EXECUTE, so revoke again and allow only the service role.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
