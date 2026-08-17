import { isFree } from './bingo';

export type PatternKey =
  | 'ROW_0' | 'ROW_1' | 'ROW_2' | 'ROW_3' | 'ROW_4'
  | 'COL_0' | 'COL_1' | 'COL_2' | 'COL_3' | 'COL_4'
  | 'DIAG_MAIN' | 'DIAG_ANTI';

export interface Pattern {
  key: PatternKey;
  label: string;
  cells: number[];
}

function buildPatterns(): Pattern[] {
  const patterns: Pattern[] = [];

  for (let r = 0; r < 5; r++) {
    patterns.push({
      key: `ROW_${r}` as PatternKey,
      label: `Horizontal`,
      cells: [0, 1, 2, 3, 4].map((c) => r * 5 + c),
    });
  }
  for (let c = 0; c < 5; c++) {
    patterns.push({
      key: `COL_${c}` as PatternKey,
      label: `Vertical`,
      cells: [0, 1, 2, 3, 4].map((r) => r * 5 + c),
    });
  }
  patterns.push({ key: 'DIAG_MAIN', label: 'Diagonal', cells: [0, 6, 12, 18, 24] });
  patterns.push({ key: 'DIAG_ANTI', label: 'Diagonal', cells: [4, 8, 12, 16, 20] });

  return patterns;
}

export const PATTERNS: Pattern[] = buildPatterns();

/** First completed pattern on the card, or null. Used for UI only — the
 *  server re-verifies every claim. */
export function detectBingo(card: number[], drawn: Set<number>): Pattern | null {
  for (const pattern of PATTERNS) {
    if (pattern.cells.every((idx) => isFree(idx) || (card[idx] !== 0 && drawn.has(card[idx])))) {
      return pattern;
    }
  }
  return null;
}

/** The winning numbers of a pattern (excludes FREE). */
export function patternWinningNumbers(card: number[], pattern: Pattern): number[] {
  return pattern.cells.map((idx) => card[idx]).filter((n) => n !== 0);
}
