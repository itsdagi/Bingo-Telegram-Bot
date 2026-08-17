export interface PlayerRow {
  id: string;
  name: string;
  status: 'JOINED' | 'LEFT' | 'WINNER' | 'LOST';
  isMe?: boolean;
}

interface PlayerListProps {
  players: PlayerRow[];
  max: number;
}

const STATUS_LABEL: Record<PlayerRow['status'], string> = {
  JOINED: 'Ready',
  LEFT: 'Left',
  WINNER: 'Winner',
  LOST: '',
};

export function PlayerList({ players, max }: PlayerListProps) {
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-tg-text">Players</span>
        <span className="font-medium text-tg-hint">
          {players.length} / {max}
        </span>
      </div>
      <ul className="space-y-1.5">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-xl bg-tg-secondary px-3 py-2"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-tg-text">
              <span className="h-2 w-2 rounded-full bg-brand" />
              {p.name}
              {p.isMe && <span className="text-xs text-tg-hint">(you)</span>}
            </span>
            {p.status === 'WINNER' && (
              <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
                WINNER
              </span>
            )}
            {p.status !== 'WINNER' && p.status !== 'JOINED' && (
              <span className="text-xs text-tg-hint">{STATUS_LABEL[p.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
