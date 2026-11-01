/**
 * A small terminal screen for showing what a harness prints: enough of the
 * VT100 family for Claude Code, Codex and a shell (colour, cursor moves,
 * erasing), not a full emulator. Alternate screens, mouse modes and the like
 * are ignored rather than drawn wrongly.
 */

export interface Cell {
  ch: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

/** A run of cells that share a style, as the view draws them. */
export interface Span extends Omit<Cell, 'ch'> {
  text: string;
}

const ANSI_COLORS = [
  '#1e1e1e',
  '#e5534b',
  '#57ab5a',
  '#c69026',
  '#539bf5',
  '#b083f0',
  '#39c5cf',
  '#adbac7',
];
const ANSI_BRIGHT = [
  '#636e7b',
  '#ff938a',
  '#8ddb8c',
  '#f0c15e',
  '#96d0ff',
  '#dcbdfb',
  '#56d4dd',
  '#f0f6fc',
];

const color256 = (n: number): string | undefined => {
  if (n < 8) return ANSI_COLORS[n];
  if (n < 16) return ANSI_BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
};

const MAX_ROWS = 5000;
const MAX_COLS = 500;

type Style = Omit<Cell, 'ch'>;

export class TerminalScreen {
  rows: Cell[][] = [[]];
  cx = 0;
  cy = 0;
  private style: Style = {};
  private pending = '';
  /** Cursor saved by `ESC 7` / `CSI s`. */
  private saved = { x: 0, y: 0 };
  /** Columns the app set; wide output wraps here. */
  constructor(public cols = 120) {}

  /** Feed output. A sequence cut at the end waits for the next call. */
  write(input: string) {
    const text = this.pending + input;
    this.pending = '';
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '\x1b') {
        const used = this.escape(text, i);
        if (used === 0) {
          this.pending = text.slice(i);
          return;
        }
        i += used;
        continue;
      }
      i++;
      switch (c) {
        case '\n':
          this.lineFeed();
          break;
        case '\r':
          this.cx = 0;
          break;
        case '\b':
          this.cx = Math.max(0, this.cx - 1);
          break;
        case '\t':
          this.cx = Math.min(MAX_COLS, (Math.floor(this.cx / 8) + 1) * 8);
          break;
        case '\x07':
          break;
        default:
          if (c >= ' ') this.put(c);
      }
    }
  }

  /** Back to an empty screen. */
  reset() {
    this.rows = [[]];
    this.cx = this.cy = 0;
    this.style = {};
    this.pending = '';
  }

  /** The screen as styled runs, one list per row, trailing blanks dropped. */
  spans(): Span[][] {
    return this.rows.map(row => {
      let end = row.length;
      while (end > 0 && row[end - 1].ch === ' ' && !row[end - 1].bg) end--;
      const out: Span[] = [];
      for (const { ch, ...style } of row.slice(0, end)) {
        const last = out[out.length - 1];
        if (last && sameStyle(last, style)) last.text += ch;
        else out.push({ ...style, text: ch });
      }
      return out;
    });
  }

  private put(ch: string) {
    if (this.cx >= this.cols) {
      this.cx = 0;
      this.lineFeed();
    }
    const row = this.row(this.cy);
    while (row.length < this.cx) row.push({ ch: ' ' });
    row[this.cx] = { ch, ...this.style };
    this.cx++;
  }

  private row(y: number) {
    while (this.rows.length <= y) this.rows.push([]);
    return this.rows[y];
  }

  private lineFeed() {
    this.cy++;
    this.row(this.cy);
    if (this.rows.length > MAX_ROWS) {
      const drop = this.rows.length - MAX_ROWS;
      this.rows.splice(0, drop);
      this.cy -= drop;
    }
  }

  /** Handles the escape sequence at `at`; 0 when it is not all here yet. */
  private escape(s: string, at: number): number {
    const kind = s[at + 1];
    if (kind === undefined) return 0;
    if (kind === '[') {
      let j = at + 2;
      while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f)
        j++;
      while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f)
        j++;
      if (j >= s.length) return 0;
      this.csi(s.slice(at + 2, j), s[j]);
      return j + 1 - at;
    }
    if (kind === ']' || kind === 'P' || kind === '_' || kind === '^') {
      // OSC and friends: titles, hyperlinks. Ended by BEL or ESC \.
      for (let j = at + 2; j < s.length; j++) {
        if (s[j] === '\x07') return j + 1 - at;
        if (s[j] === '\x1b' && s[j + 1] === '\\') return j + 2 - at;
      }
      return 0;
    }
    if ('()*+#'.includes(kind)) return s.length > at + 2 ? 3 : 0;
    if (kind === '7') this.saved = { x: this.cx, y: this.cy };
    if (kind === '8') {
      this.cx = this.saved.x;
      this.cy = Math.min(this.saved.y, this.rows.length - 1);
    }
    if (kind === 'c') this.reset();
    return 2;
  }

  private csi(paramText: string, final: string) {
    if (/[<=>?]/.test(paramText[0] ?? '')) return;
    const p = paramText.split(';').map(v => (v === '' ? NaN : Number(v)));
    const n = (k: number, d: number) => (Number.isFinite(p[k]) ? p[k] : d);
    const one = (k: number) => Math.max(1, n(k, 1));
    switch (final) {
      case 'm':
        this.sgr(p);
        break;
      case 'A':
        this.cy = Math.max(0, this.cy - one(0));
        break;
      case 'B':
        this.cy += one(0);
        this.row(this.cy);
        break;
      case 'C':
        this.cx = Math.min(MAX_COLS, this.cx + one(0));
        break;
      case 'D':
        this.cx = Math.max(0, this.cx - one(0));
        break;
      case 'E':
        this.cy += one(0);
        this.row(this.cy);
        this.cx = 0;
        break;
      case 'F':
        this.cy = Math.max(0, this.cy - one(0));
        this.cx = 0;
        break;
      case 'G':
        this.cx = Math.min(MAX_COLS, one(0) - 1);
        break;
      case 'H':
      case 'f':
        // Absolute rows are relative to what the screen shows; this one
        // grows without end, so measure from the last screenful.
        this.cy = Math.max(0, this.rows.length - this.viewRows) + one(0) - 1;
        this.row(this.cy);
        this.cx = Math.min(MAX_COLS, one(1) - 1);
        break;
      case 'd':
        this.cy = Math.max(0, this.rows.length - this.viewRows) + one(0) - 1;
        this.row(this.cy);
        break;
      case 'J':
        this.eraseDisplay(n(0, 0));
        break;
      case 'K':
        this.eraseLine(n(0, 0));
        break;
      case 'X': {
        const row = this.row(this.cy);
        for (let k = 0; k < one(0); k++) {
          if (this.cx + k < row.length) row[this.cx + k] = { ch: ' ' };
        }
        break;
      }
      case 'P':
        this.row(this.cy).splice(this.cx, one(0));
        break;
      case 'L':
        for (let k = 0; k < one(0); k++) this.rows.splice(this.cy, 0, []);
        break;
      case 'M':
        this.rows.splice(this.cy, one(0));
        this.row(this.cy);
        break;
      case 's':
        this.saved = { x: this.cx, y: this.cy };
        break;
      case 'u':
        this.cx = this.saved.x;
        this.cy = Math.min(this.saved.y, this.rows.length - 1);
        break;
    }
  }

  /** Rows the app believes the screen has; set by the view from its size. */
  viewRows = 32;

  private eraseLine(mode: number) {
    const row = this.row(this.cy);
    if (mode === 0) row.length = Math.min(row.length, this.cx);
    else if (mode === 1) {
      for (let k = 0; k <= this.cx && k < row.length; k++) row[k] = { ch: ' ' };
    } else row.length = 0;
  }

  private eraseDisplay(mode: number) {
    if (mode === 0) {
      this.eraseLine(0);
      this.rows.length = this.cy + 1;
    } else if (mode === 1) {
      const top = Math.max(0, this.rows.length - this.viewRows);
      for (let y = top; y < this.cy; y++) this.rows[y] = [];
      this.eraseLine(1);
    } else if (mode === 2) {
      // Clear what is on screen but keep the history above it.
      const top = Math.max(0, this.rows.length - this.viewRows);
      this.rows.length = top + 1;
      this.rows[top] = [];
      this.cy = top;
    } else if (mode === 3) {
      this.rows = [[]];
      this.cy = 0;
    }
  }

  private sgr(p: number[]) {
    if (p.length === 0) p = [0];
    for (let k = 0; k < p.length; k++) {
      const v = Number.isNaN(p[k]) ? 0 : p[k];
      if (v === 0) this.style = {};
      else if (v === 1) this.style = { ...this.style, bold: true };
      else if (v === 2) this.style = { ...this.style, dim: true };
      else if (v === 3) this.style = { ...this.style, italic: true };
      else if (v === 4) this.style = { ...this.style, underline: true };
      else if (v === 7) this.style = { ...this.style, inverse: true };
      else if (v === 22)
        this.style = { ...this.style, bold: false, dim: false };
      else if (v === 23) this.style = { ...this.style, italic: false };
      else if (v === 24) this.style = { ...this.style, underline: false };
      else if (v === 27) this.style = { ...this.style, inverse: false };
      else if (v >= 30 && v <= 37)
        this.style = { ...this.style, fg: ANSI_COLORS[v - 30] };
      else if (v >= 90 && v <= 97)
        this.style = { ...this.style, fg: ANSI_BRIGHT[v - 90] };
      else if (v >= 40 && v <= 47)
        this.style = { ...this.style, bg: ANSI_COLORS[v - 40] };
      else if (v >= 100 && v <= 107)
        this.style = { ...this.style, bg: ANSI_BRIGHT[v - 100] };
      else if (v === 39) this.style = { ...this.style, fg: undefined };
      else if (v === 49) this.style = { ...this.style, bg: undefined };
      else if (v === 38 || v === 48) {
        const key = v === 38 ? 'fg' : 'bg';
        if (p[k + 1] === 5) {
          this.style = { ...this.style, [key]: color256(p[k + 2]) };
          k += 2;
        } else if (p[k + 1] === 2) {
          this.style = {
            ...this.style,
            [key]: `rgb(${p[k + 2] | 0},${p[k + 3] | 0},${p[k + 4] | 0})`,
          };
          k += 4;
        }
      }
    }
  }
}

const sameStyle = (a: Style, b: Style) =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  !!a.bold === !!b.bold &&
  !!a.dim === !!b.dim &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.inverse === !!b.inverse;

/** What a key press sends to the program, or null to let the browser have it. */
export function keyToInput(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (e.metaKey) return null;
  const named: Record<string, string> = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: e.shiftKey ? '\x1b[Z' : '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
    Home: '\x1b[H',
    End: '\x1b[F',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~',
    Delete: '\x1b[3~',
  };
  if (named[e.key] !== undefined) return named[e.key];
  if (e.key.length !== 1) return null;
  if (e.ctrlKey && /^[a-z]$/i.test(e.key)) {
    // Ctrl+C with nothing to copy must interrupt; the view decides.
    return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
  }
  if (e.ctrlKey) return null;
  return e.altKey ? `\x1b${e.key}` : e.key;
}
