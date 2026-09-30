// A solving-table cell is named the spreadsheet way: its column letter and its row number, where
// row 1 is the first row under the header (`D2` is row 1, column 3, both counted from 0).

export const CELL_REF = /^([A-Z])([1-9]\d*)$/;

export interface Cell {
  row: number;
  col: number;
}

/** `D2` → { row: 1, col: 3 }. */
export function parseCell(ref: string): Cell {
  const match = CELL_REF.exec(ref);
  if (!match?.[1] || !match[2]) throw new Error(`"${ref}" is not a cell reference`);
  return { row: Number(match[2]) - 1, col: match[1].charCodeAt(0) - 65 };
}

/** Row and column counted from 0 → the cell's name, e.g. (1, 3) → `D2`. */
export const cellAt = (row: number, col: number) => `${String.fromCharCode(65 + col)}${row + 1}`;
