-- ============================================================================
-- Bingo — initial schema, RLS, and server-side game functions
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.game_status as enum ('WAITING', 'STARTING', 'ACTIVE', 'COMPLETED', 'CANCELLED');
create type public.game_player_status as enum ('JOINED', 'LEFT', 'WINNER', 'LOST');
create type public.transaction_type as enum (
  'WELCOME_BONUS', 'GAME_ENTRY', 'GAME_WIN', 'DAILY_REWARD', 'ADMIN_ADJUSTMENT'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.users (
  id               uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  username         text,
  first_name       text,
  last_name        text,
  photo_url        text,
  balance          bigint not null default 0 check (balance >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  room_code         text unique not null,
  status            public.game_status not null default 'WAITING',
  min_players       int not null default 2 check (min_players between 2 and 50),
  max_players       int not null default 50 check (max_players between 2 and 50),
  entry_fee         bigint not null default 0 check (entry_fee >= 0),
  is_public         boolean not null default false,
  creator_id        uuid references public.users(id),
  current_number    int check (current_number between 1 and 75),
  current_draw_order int not null default 0,
  last_draw_at      timestamptz not null default now(),
  started_at        timestamptz,
  ended_at          timestamptz,
  winner_id         uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (max_players >= min_players)
);

create table public.game_players (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  card_id      uuid,
  display_name text,
  status       public.game_player_status not null default 'JOINED',
  joined_at    timestamptz not null default now(),
  unique (game_id, user_id)
);

create table public.bingo_cards (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  numbers    int[] not null,            -- 25 numbers, column-major rows; center (index 12) = 0 (FREE)
  created_at timestamptz not null default now(),
  unique (game_id, user_id)
);

create table public.drawn_numbers (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  number     int not null check (number between 1 and 75),
  draw_order int not null check (draw_order > 0),
  drawn_at   timestamptz not null default now(),
  unique (game_id, number),
  unique (game_id, draw_order)
);

create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  amount       bigint not null,
  type         public.transaction_type not null,
  reference_id uuid,
  created_at   timestamptz not null default now()
);

create table public.game_results (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games(id) on delete cascade,
  winner_id        uuid not null references public.users(id),
  winning_pattern  text not null,
  winning_numbers  int[] not null,
  completed_at     timestamptz not null default now(),
  unique (game_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index users_telegram_user_id_idx on public.users (telegram_user_id);
create index games_status_idx on public.games (status);
create index games_room_code_idx on public.games (room_code);
create index game_players_game_id_idx on public.game_players (game_id);
create index game_players_user_id_idx on public.game_players (user_id);
create index bingo_cards_game_id_idx on public.bingo_cards (game_id);
create index bingo_cards_user_id_idx on public.bingo_cards (user_id);
create index drawn_numbers_game_id_idx on public.drawn_numbers (game_id, draw_order);
create index transactions_user_id_idx on public.transactions (user_id, created_at desc);
create index game_results_game_id_idx on public.game_results (game_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

create trigger games_set_updated_at before update on public.games
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Server-side game functions (authoritative)
-- ============================================================================

-- Generate a unique, friendlier numeric room code.
create or replace function public.random_room_code(len int default 5) returns text as $$
declare
  code text;
begin
  loop
    code := lpad((floor(random() * (10 ^ len)))::bigint::text, len, '0');
    exit when not exists (select 1 from public.games where room_code = code);
  end loop;
  return code;
end $$ language plpgsql security definer set search_path = public;

-- Generate a 5x5 card. Column c holds values c*15+1 .. c*15+15.
-- Flattened row-major, 1-based index: row*5 + col + 1. Center (index 13) = FREE (0).
create or replace function public.generate_bingo_card() returns int[] as $$
declare
  card int[] := array_fill(0, array[25]);
  vals int[];
  r int;
  col int;
begin
  for col in 0..4 loop
    vals := array(select generate_series(col * 15 + 1, col * 15 + 15) order by random());
    for r in 0..4 loop
      card[r * 5 + col + 1] := vals[r + 1];
    end loop;
  end loop;
  card[13] := 0;
  return card;
end $$ language plpgsql security definer set search_path = public;

-- Atomically change a balance AND record the transaction. Never change a
-- balance without going through here.
create or replace function public.apply_transaction(
  p_user_id uuid,
  p_amount bigint,
  p_type public.transaction_type,
  p_reference_id uuid default null
) returns void as $$
declare
  v_balance bigint;
begin
  select balance into v_balance from public.users where id = p_user_id for update;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  if v_balance + p_amount < 0 then
    raise exception 'Insufficient balance';
  end if;

  update public.users set balance = balance + p_amount, updated_at = now()
    where id = p_user_id;

  insert into public.transactions (user_id, amount, type, reference_id)
    values (p_user_id, p_amount, p_type, p_reference_id);
end $$ language plpgsql security definer set search_path = public;

-- Upsert a Telegram user and grant the one-time welcome bonus exactly once.
create or replace function public.upsert_telegram_user(
  p_telegram_user_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
) returns public.users as $$
declare
  v_user public.users%rowtype;
begin
  insert into public.users (telegram_user_id, username, first_name, last_name, photo_url, balance)
  values (p_telegram_user_id, p_username, p_first_name, p_last_name, p_photo_url, 0)
  on conflict (telegram_user_id) do update
    set username    = coalesce(excluded.username, public.users.username),
        first_name  = excluded.first_name,
        last_name   = excluded.last_name,
        photo_url   = excluded.photo_url,
        updated_at  = now()
  returning * into v_user;

  if not exists (
    select 1 from public.transactions
    where user_id = v_user.id and type = 'WELCOME_BONUS'
  ) then
    perform public.apply_transaction(v_user.id, 1000, 'WELCOME_BONUS', null);
  end if;

  select * into v_user from public.users where id = v_user.id;
  return v_user;
end $$ language plpgsql security definer set search_path = public;

-- Join a WAITING game: enforce capacity + balance, deduct entry, build card.
create or replace function public.join_game(p_game_id uuid, p_user_id uuid) returns json as $$
declare
  v_game public.games%rowtype;
  v_balance bigint;
  v_card int[];
  v_card_id uuid;
  v_count int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'WAITING' then
    raise exception 'Game is not open for joining';
  end if;

  if exists (select 1 from public.game_players where game_id = p_game_id and user_id = p_user_id) then
    raise exception 'Already joined this game';
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

-- Create a game and join the creator.
create or replace function public.create_game(
  p_creator_id uuid,
  p_entry_fee bigint,
  p_min_players int,
  p_max_players int,
  p_is_public boolean
) returns json as $$
declare
  v_game_id uuid;
  v_code text;
  v_result json;
begin
  v_code := public.random_room_code();

  insert into public.games (room_code, status, min_players, max_players, entry_fee, is_public, creator_id)
    values (v_code, 'WAITING', p_min_players, p_max_players, p_entry_fee, p_is_public, p_creator_id)
    returning id into v_game_id;

  v_result := public.join_game(v_game_id, p_creator_id);

  return json_build_object('game_id', v_game_id, 'room_code', v_code, 'card', v_result -> 'card');
end $$ language plpgsql security definer set search_path = public;

-- Quick Play: return the user's existing open public game, or find/create one.
create or replace function public.quick_play(p_user_id uuid) returns json as $$
declare
  v_game_id uuid;
  v_card int[];
  v_result json;
  v_count int;
begin
  -- Already sitting in a WAITING public game? Resume it.
  select g.id into v_game_id
  from public.games g
  join public.game_players gp on gp.game_id = g.id
  where gp.user_id = p_user_id and g.is_public and g.status = 'WAITING'
  limit 1;

  if v_game_id is not null then
    select numbers into v_card from public.bingo_cards where game_id = v_game_id and user_id = p_user_id;
    return json_build_object('game_id', v_game_id, 'card', v_card);
  end if;

  -- Find an open public game.
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
    v_card := v_result -> 'card';
  else
    v_result := public.join_game(v_game_id, p_user_id);
    v_card := v_result -> 'card';
  end if;

  select count(*) into v_count from public.game_players where game_id = v_game_id;

  if v_count >= 2 then
    update public.games
      set status = 'STARTING', started_at = now(), updated_at = now()
      where id = v_game_id and status = 'WAITING';
  end if;

  return json_build_object('game_id', v_game_id, 'card', v_card);
end $$ language plpgsql security definer set search_path = public;

-- Room creator starts the game (min players enforced).
create or replace function public.start_game(p_game_id uuid, p_user_id uuid) returns json as $$
declare
  v_game public.games%rowtype;
  v_count int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.creator_id is null or v_game.creator_id <> p_user_id then
    raise exception 'Only the room creator can start the game';
  end if;
  if v_game.status <> 'WAITING' then
    raise exception 'Game is not waiting';
  end if;

  select count(*) into v_count from public.game_players where game_id = p_game_id;
  if v_count < v_game.min_players then
    raise exception 'Not enough players to start';
  end if;

  update public.games set status = 'STARTING', started_at = now(), updated_at = now()
    where id = p_game_id;

  return json_build_object('started', true);
end $$ language plpgsql security definer set search_path = public;

-- Is a cell marked? Center (1-based index 13) is always FREE.
create or replace function public.cell_marked(card int[], drawn int[], idx int) returns boolean as $$
declare
  n int := card[idx];
begin
  if idx = 13 then
    return true;
  end if;
  if n = 0 then
    return false;
  end if;
  return n = any (coalesce(drawn, array[]::int[]));
end $$ language plpgsql immutable;

-- Verify a claimed pattern is complete.
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
  end if;

  return false;
end $$ language plpgsql immutable;

-- Winning numbers for a pattern (used in game_results).
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
  end if;
  return res;
end $$ language plpgsql immutable;

-- Server-side Bingo verification + winner resolution (atomic, race-safe).
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

  -- Resolve the game exactly once.
  update public.games
    set status = 'COMPLETED', winner_id = p_user_id, ended_at = now(), updated_at = now()
    where id = p_game_id;

  update public.game_players
    set status = case when user_id = p_user_id then 'WINNER' else 'LOST' end
    where game_id = p_game_id;

  insert into public.game_results (game_id, winner_id, winning_pattern, winning_numbers, completed_at)
    values (p_game_id, p_user_id, p_pattern, v_winning, now());

  select count(*) into v_num_players from public.game_players where game_id = p_game_id;
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

-- Draw the next number for an ACTIVE game. Guarded by last_draw_at so multiple
-- callers (cron, client tick) cannot double-draw.
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
      where id = p_game_id;
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

  return v_num;
end $$ language plpgsql security definer set search_path = public;

-- Tick all games: activate STARTING games and draw for ACTIVE games.
create or replace function public.game_tick() returns void as $$
declare
  g record;
begin
  update public.games
    set status = 'ACTIVE', updated_at = now()
    where status = 'STARTING' and started_at < now() - interval '3 seconds';

  for g in select id from public.games where status = 'ACTIVE' loop
    perform public.draw_next_number(g.id);
  end loop;
end $$ language plpgsql security definer set search_path = public;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.users enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.bingo_cards enable row level security;
alter table public.drawn_numbers enable row level security;
alter table public.transactions enable row level security;
alter table public.game_results enable row level security;

-- users: read own profile only.
create policy users_select on public.users for select
  using (auth.uid() = id);

-- games: participants see their games; anyone sees open public games (matchmaking).
create policy games_select on public.games for select
  using (
    (is_public = true and status in ('WAITING', 'STARTING'))
    or exists (
      select 1 from public.game_players gp
      where gp.game_id = id and gp.user_id = auth.uid()
    )
  );

-- game_players: participants in the same game + open public games (live count).
create policy game_players_select on public.game_players for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.games g
      where g.id = game_id and g.is_public = true and g.status in ('WAITING', 'STARTING')
    )
    or exists (
      select 1 from public.game_players me
      where me.game_id = game_id and me.user_id = auth.uid()
    )
  );

-- bingo_cards: only your own card.
create policy bingo_cards_select on public.bingo_cards for select
  using (user_id = auth.uid());

-- drawn_numbers: participants + open public games.
create policy drawn_numbers_select on public.drawn_numbers for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.is_public = true
    )
    or exists (
      select 1 from public.game_players me
      where me.game_id = game_id and me.user_id = auth.uid()
    )
  );

-- transactions: own only.
create policy transactions_select on public.transactions for select
  using (user_id = auth.uid());

-- game_results: participants + public games.
create policy game_results_select on public.game_results for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.is_public = true
    )
    or exists (
      select 1 from public.game_players me
      where me.game_id = game_id and me.user_id = auth.uid()
    )
  );

-- Restrict write access to service role only (all writes go through functions).
create policy users_no_insert on public.users for insert with check (false);
create policy users_no_update on public.users for update using (false);
create policy users_no_delete on public.users for delete using (false);

create policy games_no_insert on public.games for insert with check (false);
create policy games_no_update on public.games for update using (false);
create policy games_no_delete on public.games for delete using (false);

create policy game_players_no_insert on public.game_players for insert with check (false);
create policy game_players_no_update on public.game_players for update using (false);
create policy game_players_no_delete on public.game_players for delete using (false);

create policy bingo_cards_no_insert on public.bingo_cards for insert with check (false);
create policy bingo_cards_no_update on public.bingo_cards for update using (false);
create policy bingo_cards_no_delete on public.bingo_cards for delete using (false);

create policy drawn_numbers_no_insert on public.drawn_numbers for insert with check (false);
create policy drawn_numbers_no_update on public.drawn_numbers for update using (false);
create policy drawn_numbers_no_delete on public.drawn_numbers for delete using (false);

create policy transactions_no_insert on public.transactions for insert with check (false);
create policy transactions_no_update on public.transactions for update using (false);
create policy transactions_no_delete on public.transactions for delete using (false);

create policy game_results_no_insert on public.game_results for insert with check (false);
create policy game_results_no_update on public.game_results for update using (false);
create policy game_results_no_delete on public.game_results for delete using (false);

-- Restrict direct function execution to the service role.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- ============================================================================
-- Realtime publications
-- ============================================================================
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.drawn_numbers;
alter publication supabase_realtime add table public.game_results;
