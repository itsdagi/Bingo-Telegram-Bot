import { PlayerList, type PlayerRow } from '../PlayerList/PlayerList';
import type { Game } from '../../lib/types';
import { formatBirr } from '../../game/bingo';

interface GameRoomProps {
  game: Game;
  players: PlayerRow[];
  isCreator: boolean;
  isPublic: boolean;
  starting: boolean;
  onStart: () => void;
  onInvite: () => void;
  onCopy: () => void;
}

export function GameRoom({
  game,
  players,
  isCreator,
  isPublic,
  starting,
  onStart,
  onInvite,
  onCopy,
}: GameRoomProps) {
  const enoughPlayers = players.length >= game.min_players;

  return (
    <div className="flex w-full flex-col gap-5 animate-float-in">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-tg-hint">Room</div>
        <button
          type="button"
          onClick={onCopy}
          className="mt-1 text-4xl font-extrabold tracking-widest text-tg-text active:opacity-70"
        >
          #{game.room_code}
        </button>
        <div className="mt-1 text-sm font-medium text-tg-hint">
          Entry · {formatBirr(game.entry_fee)}
        </div>
      </div>

      <PlayerList players={players} max={game.max_players} />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onInvite}
          className="w-full rounded-2xl bg-tg-button px-4 py-4 text-base font-bold text-tg-button-text active:scale-[0.98]"
        >
          INVITE FRIENDS
        </button>

        {isPublic ? (
          <div className="animate-pulse-soft text-center text-sm font-medium text-tg-hint">
            Finding players… waiting for more players
          </div>
        ) : isCreator ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!enoughPlayers || starting}
            className={`w-full rounded-2xl px-4 py-4 text-base font-bold transition active:scale-[0.98] ${
              enoughPlayers && !starting
                ? 'bg-brand text-white'
                : 'bg-black/10 text-tg-hint'
            }`}
          >
            {starting
              ? 'STARTING…'
              : enoughPlayers
                ? 'START GAME'
                : `NEED ${game.min_players} PLAYERS`}
          </button>
        ) : (
          <div className="text-center text-sm text-tg-hint">
            Waiting for the host to start…
          </div>
        )}
      </div>
    </div>
  );
}
