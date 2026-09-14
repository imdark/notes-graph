/** A point on the Go board. */
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof EMPTY | typeof BLACK | typeof WHITE;

/** `board[row][col]`, row 0 = top, col 0 = left. */
export type Board = Stone[][];

/**
 * SGF point letters: column/row index → `a..s` (0..18). SGF uses `a` for the
 * first line from the top/left, so `[aa]` is the top-left corner and a 19×19
 * top-right star point is `[pd]` (col 15, row 3).
 */
function letter(index: number): string {
  return String.fromCharCode(97 + index); // 97 === 'a'.charCodeAt(0)
}

/**
 * Compose a static Go position as an SGF string: setup stones in a single root
 * node (`AB`/`AW`), the form besogo and other Go tools load as a position to
 * edit. Coordinates out of range for `size` are skipped defensively.
 *
 * @example
 *   boardToSgf([[BLACK, EMPTY], [EMPTY, WHITE]], 2)
 *   // "(;GM[1]FF[4]CA[UTF-8]SZ[2]AB[aa]AW[bb])"
 */
export function boardToSgf(board: Board, size: number): string {
  const black: string[] = [];
  const white: string[] = [];

  for (let row = 0; row < board.length && row < size; row++) {
    const line = board[row];
    for (let col = 0; col < line.length && col < size; col++) {
      const point = `[${letter(col)}${letter(row)}]`;
      if (line[col] === BLACK) black.push(point);
      else if (line[col] === WHITE) white.push(point);
    }
  }

  let sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]`;
  if (black.length > 0) sgf += `AB${black.join('')}`;
  if (white.length > 0) sgf += `AW${white.join('')}`;
  sgf += ')';
  return sgf;
}
