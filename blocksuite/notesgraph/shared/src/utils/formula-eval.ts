/**
 * A small, safe expression language for formula columns — no eval, no
 * host access. Values are number | string | boolean | null.
 *
 * - literals: 12, 1.5, 'text', "text", true, false, null
 * - column refs: bare identifiers (`estimate`) or `[Column Name]` for
 *   names with spaces; resolution is caller-provided and case-insensitive
 * - operators: - ! * / % + - < <= > >= == != && || and `cond ? a : b`
 * - functions: now(), today(), days(ms), hours(ms), daysUntil(date),
 *   daysSince(date), round(n), floor(n), ceil(n), abs(n), min(...),
 *   max(...), len(x), lower(s), upper(s), concat(...), empty(x),
 *   if(cond, a, b)
 */

export type FormulaValue = number | string | boolean | null;

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'ref'; value: string }
  | { kind: 'op'; value: string };

class FormulaError extends Error {}

const OPS = [
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  ',',
  '?',
  ':',
  '!',
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(i));
      if (!match) throw new FormulaError(`bad number at ${i}`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = input.indexOf(ch, i + 1);
      if (end < 0) throw new FormulaError('unterminated string');
      tokens.push({ kind: 'str', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '[') {
      const end = input.indexOf(']', i + 1);
      if (end < 0) throw new FormulaError('unterminated [column] ref');
      tokens.push({ kind: 'ref', value: input.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
      if (!match) throw new FormulaError(`bad identifier at ${i}`);
      tokens.push({ kind: 'ident', value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPS.find(op => input.startsWith(op, i));
    if (!op) throw new FormulaError(`unexpected character '${ch}'`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
    continue;
  }
  return tokens;
}

type Node =
  | { kind: 'lit'; value: FormulaValue }
  | { kind: 'ref'; name: string }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'cond'; test: Node; then: Node; else: Node }
  | { kind: 'call'; name: string; args: Node[] };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private takeOp(value: string): boolean {
    const token = this.peek();
    if (token?.kind === 'op' && token.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(value: string): void {
    if (!this.takeOp(value)) throw new FormulaError(`expected '${value}'`);
  }

  parse(): Node {
    const node = this.ternary();
    if (this.pos < this.tokens.length) {
      throw new FormulaError('unexpected trailing input');
    }
    return node;
  }

  private ternary(): Node {
    const test = this.binary(0);
    if (!this.takeOp('?')) return test;
    const then = this.ternary();
    this.expectOp(':');
    return { kind: 'cond', test, then, else: this.ternary() };
  }

  private static readonly PRECEDENCE: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  };

  private binary(minPrecedence: number): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op') return left;
      const precedence = Parser.PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) return left;
      this.pos++;
      const right = this.binary(precedence + 1);
      left = { kind: 'binary', op: token.value, left, right };
    }
  }

  private unary(): Node {
    if (this.takeOp('-')) {
      return { kind: 'unary', op: '-', operand: this.unary() };
    }
    if (this.takeOp('!')) {
      return { kind: 'unary', op: '!', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();
    if (!token) throw new FormulaError('unexpected end of expression');
    if (token.kind === 'num' || token.kind === 'str') {
      this.pos++;
      return { kind: 'lit', value: token.value };
    }
    if (token.kind === 'ref') {
      this.pos++;
      return { kind: 'ref', name: token.value };
    }
    if (token.kind === 'ident') {
      this.pos++;
      const lower = token.value.toLowerCase();
      if (lower === 'true') return { kind: 'lit', value: true };
      if (lower === 'false') return { kind: 'lit', value: false };
      if (lower === 'null') return { kind: 'lit', value: null };
      if (this.takeOp('(')) {
        const args: Node[] = [];
        if (!this.takeOp(')')) {
          do {
            args.push(this.ternary());
          } while (this.takeOp(','));
          this.expectOp(')');
        }
        return { kind: 'call', name: lower, args };
      }
      return { kind: 'ref', name: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      this.pos++;
      const node = this.ternary();
      this.expectOp(')');
      return node;
    }
    throw new FormulaError(`unexpected '${token.value}'`);
  }
}

const asNumber = (value: FormulaValue): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  const num = Number(value);
  if (Number.isNaN(num)) throw new FormulaError(`'${value}' is not a number`);
  return num;
};

const truthy = (value: FormulaValue): boolean =>
  value !== null && value !== false && value !== 0 && value !== '';

const DAY_MS = 24 * 60 * 60 * 1000;

function callFn(name: string, args: FormulaValue[]): FormulaValue {
  switch (name) {
    case 'now':
      return Date.now();
    case 'today': {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      return day.getTime();
    }
    case 'days':
      return asNumber(args[0] ?? null) / DAY_MS;
    case 'hours':
      return asNumber(args[0] ?? null) / (60 * 60 * 1000);
    case 'daysuntil':
      return args[0] == null
        ? null
        : Math.ceil((asNumber(args[0]) - Date.now()) / DAY_MS);
    case 'dayssince':
      return args[0] == null
        ? null
        : Math.floor((Date.now() - asNumber(args[0])) / DAY_MS);
    case 'round':
      return Math.round(asNumber(args[0] ?? null));
    case 'floor':
      return Math.floor(asNumber(args[0] ?? null));
    case 'ceil':
      return Math.ceil(asNumber(args[0] ?? null));
    case 'abs':
      return Math.abs(asNumber(args[0] ?? null));
    case 'min':
      return Math.min(...args.map(asNumber));
    case 'max':
      return Math.max(...args.map(asNumber));
    case 'len':
      return typeof args[0] === 'string' ? args[0].length : 0;
    case 'lower':
      return String(args[0] ?? '').toLowerCase();
    case 'upper':
      return String(args[0] ?? '').toUpperCase();
    case 'concat':
      return args.map(arg => (arg == null ? '' : String(arg))).join('');
    case 'empty':
      return args[0] == null || args[0] === '';
    case 'if':
      return truthy(args[0] ?? null) ? (args[1] ?? null) : (args[2] ?? null);
    default:
      throw new FormulaError(`unknown function '${name}'`);
  }
}

function evalNode(
  node: Node,
  resolveRef: (name: string) => FormulaValue
): FormulaValue {
  switch (node.kind) {
    case 'lit':
      return node.value;
    case 'ref':
      return resolveRef(node.name);
    case 'unary': {
      const operand = evalNode(node.operand, resolveRef);
      return node.op === '-' ? -asNumber(operand) : !truthy(operand);
    }
    case 'cond':
      return truthy(evalNode(node.test, resolveRef))
        ? evalNode(node.then, resolveRef)
        : evalNode(node.else, resolveRef);
    case 'call':
      return callFn(
        node.name,
        node.args.map(arg => evalNode(arg, resolveRef))
      );
    case 'binary': {
      const op = node.op;
      if (op === '&&') {
        const left = evalNode(node.left, resolveRef);
        return truthy(left) ? evalNode(node.right, resolveRef) : left;
      }
      if (op === '||') {
        const left = evalNode(node.left, resolveRef);
        return truthy(left) ? left : evalNode(node.right, resolveRef);
      }
      const left = evalNode(node.left, resolveRef);
      const right = evalNode(node.right, resolveRef);
      switch (op) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            return `${left ?? ''}${right ?? ''}`;
          }
          return asNumber(left) + asNumber(right);
        case '-':
          return asNumber(left) - asNumber(right);
        case '*':
          return asNumber(left) * asNumber(right);
        case '/':
          return asNumber(left) / asNumber(right);
        case '%':
          return asNumber(left) % asNumber(right);
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return asNumber(left) < asNumber(right);
        case '<=':
          return asNumber(left) <= asNumber(right);
        case '>':
          return asNumber(left) > asNumber(right);
        case '>=':
          return asNumber(left) >= asNumber(right);
        default:
          throw new FormulaError(`unknown operator '${op}'`);
      }
    }
  }
}

const astCache = new Map<string, Node | FormulaError>();

/**
 * Evaluates a formula expression. `resolveRef` maps a column name (as the
 * user wrote it) to its value for the current row. Returns the value, or
 * `#ERR: reason` as a string when the expression is invalid — formulas
 * should never throw into rendering.
 */
export function evaluateFormula(
  expression: string,
  resolveRef: (name: string) => FormulaValue
): FormulaValue {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  let ast = astCache.get(trimmed);
  if (!ast) {
    try {
      ast = new Parser(tokenize(trimmed)).parse();
    } catch (e) {
      ast = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    astCache.set(trimmed, ast);
  }
  if (ast instanceof FormulaError) return `#ERR: ${ast.message}`;
  try {
    return evalNode(ast, resolveRef);
  } catch (e) {
    return `#ERR: ${e instanceof FormulaError ? e.message : String(e)}`;
  }
}
