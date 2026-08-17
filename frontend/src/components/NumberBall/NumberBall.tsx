import { COLUMN_LABELS } from '../../game/bingo';

type BallState = 'default' | 'drawn' | 'current' | 'dim';
type BallSize = 'sm' | 'md' | 'lg';

interface NumberBallProps {
  /** Number 1..75, or 0 for FREE. */
  number: number;
  state?: BallState;
  size?: BallSize;
  /** Letter (B/I/N/G/O) — inferred when omitted for card cells. */
  label?: string;
}

const SIZE_CLASSES: Record<BallSize, string> = {
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-9 w-9 text-sm',
  lg: 'h-16 w-16 text-2xl',
};

function letterFor(number: number): string {
  if (number >= 1 && number <= 15) return COLUMN_LABELS[0];
  if (number <= 30) return COLUMN_LABELS[1];
  if (number <= 45) return COLUMN_LABELS[2];
  if (number <= 60) return COLUMN_LABELS[3];
  return COLUMN_LABELS[4];
}

export function NumberBall({ number, state = 'default', size = 'md', label }: NumberBallProps) {
  const letter = label ?? letterFor(number);

  const classes: Record<BallState, string> = {
    default:
      'bg-tg-secondary text-tg-text border border-black/10',
    drawn:
      'bg-brand text-white border border-transparent animate-pop',
    current:
      'bg-brand text-white border border-transparent animate-pulse-soft shadow-lg',
    dim: 'bg-black/5 text-tg-hint border border-transparent',
  };

  return (
    <div
      className={`flex items-center justify-center rounded-full font-bold ${SIZE_CLASSES[size]} ${classes[state]}`}
    >
      {number === 0 ? (
        <span className="text-[0.55em] tracking-wide">FREE</span>
      ) : (
        <>
          <span className="text-[0.6em] mr-[1px] opacity-80">{letter}</span>
          {number}
        </>
      )}
    </div>
  );
}
