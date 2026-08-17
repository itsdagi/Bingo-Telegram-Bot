export const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'] as const;

/** 1-based flattened index of the FREE center square (row 2, col 2). */
export const FREE_INDEX = 12;

export function isFree(index: number): boolean {
  return index === FREE_INDEX;
}

export function columnLabel(index: number): string {
  return COLUMN_LABELS[index % 5];
}

/** B/I/N/G/O letter for a raw 1..75 number. */
export function letterForNumber(number: number): string {
  if (number >= 1 && number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  return 'O';
}

/** "B7", "G52", "FREE", … for a card cell. */
export function ballLabel(index: number, number: number): string {
  if (isFree(index) || number === 0) return 'FREE';
  return `${columnLabel(index)}${number}`;
}

/** Whether a raw 1..75 number is present in the drawn set. */
export function isCardNumberMarked(number: number, drawn: Set<number>): boolean {
  return number !== 0 && drawn.has(number);
}

export function isCellMarked(card: number[], index: number, drawn: Set<number>): boolean {
  if (isFree(index)) return true;
  const n = card[index];
  return n !== 0 && drawn.has(n);
}

export function formatBirr(amount: number): string {
  return `${amount.toLocaleString('en-US')} Birr`;
}
