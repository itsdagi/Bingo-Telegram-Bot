import type { Game } from '../../lib/types';
import { formatBirr } from '../../game/bingo';

interface RoomCardProps {
  game: Game;
  players: number;
  onOpen: () => void;
}

export function RoomCard({ game, players, onOpen }: RoomCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-2xl bg-tg-secondary px-4 py-3 text-left active:scale-[0.99]"
    >
      <div>
        <div className="text-lg font-extrabold text-tg-text">#{game.room_code}</div>
        <div className="text-xs font-medium text-tg-hint">
          {players} / {game.max_players} players · {formatBirr(game.entry_fee)}
        </div>
      </div>
      <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
        OPEN
      </span>
    </button>
  );
}
