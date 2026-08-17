import { COLUMN_LABELS, FREE_INDEX, isCellMarked } from '../../game/bingo';

interface BingoCardProps {
  card: number[];
  drawn: Set<number>;
  currentNumber: number | null;
  /** Indices that form the winning line (highlighted after a win). */
  winningCells?: number[];
  disabled?: boolean;
}

export function BingoCard({ card, drawn, currentNumber, winningCells, disabled }: BingoCardProps) {
  const winning = new Set(winningCells ?? []);

  return (
    <div className={`w-full max-w-sm select-none ${disabled ? 'opacity-80' : ''}`}>
      {/* Column headers */}
      <div className="grid grid-cols-5 gap-1 mb-1">
        {COLUMN_LABELS.map((l) => (
          <div key={l} className="text-center text-xs font-extrabold tracking-widest text-brand">
            {l}
          </div>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-5 gap-1 rounded-2xl bg-tg-secondary p-1.5 shadow-sm">
        {card.map((number, index) => {
          const isFreeCell = index === FREE_INDEX;
          const marked = isFreeCell || isCellMarked(card, index, drawn);
          const isCurrent = number !== 0 && number === currentNumber;
          const isWinning = winning.has(index);

          let cellClass = 'text-tg-text';
          if (isFreeCell) {
            cellClass = 'bg-brand-soft text-brand font-extrabold';
          } else if (isCurrent) {
            cellClass = 'bg-brand text-white animate-pulse-soft';
          } else if (marked) {
            cellClass = 'bg-brand text-white animate-pop';
          } else if (isWinning) {
            cellClass = 'bg-brand text-white';
          }

          return (
            <div
              key={index}
              className={`flex aspect-square items-center justify-center rounded-xl text-base font-bold transition-colors ${cellClass}`}
            >
              {isFreeCell ? (
                <span className="text-[0.6em] tracking-wide">FREE</span>
              ) : (
                number
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
