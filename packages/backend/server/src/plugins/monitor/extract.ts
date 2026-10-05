/**
 * Pulling the one value a monitor watches out of what it fetched: a web page,
 * a JSON API response, or a command's output. Pure, so the rules are tested
 * directly (see __tests__/extract.spec.ts).
 */

export type ExtractType = 'number' | 'regex' | 'jsonpath' | 'text';

export interface ExtractSpec {
  type: ExtractType;
  /** regex: the pattern (first capture group wins); jsonpath: a dotted path. */
  pattern?: string;
}

/** Longest value kept, in the block and in a reading. */
export const MAX_VALUE_CHARS = 500;

/** Any markup at all: a page, or a fragment like a table row. */
const looksLikeHtml = (body: string) => /<\/?[a-z][a-z0-9-]*[\s>/]/i.test(body);

/** Visible text of an HTML page, near enough for finding a number in it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;|&dollar;/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1,299.00" → "1299.00"; keeps a leading minus. */
const cleanNumber = (raw: string): string | null => {
  const negative = /^\s*-/.test(raw);
  const digits = raw.replace(/[^\d.]/g, '');
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  return `${negative ? '-' : ''}${digits.replace(/\.$/, '')}`;
};

/**
 * A number from a page or output: a JSON-LD/microdata price first (a shop's
 * real price, not the first "$" in an ad), then a currency amount, then the
 * first number at all.
 */
function firstNumber(body: string): string | null {
  const jsonLd = body.match(/"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?/i);
  if (jsonLd) return cleanNumber(jsonLd[1]);
  const text = looksLikeHtml(body) ? htmlToText(body) : body;
  const currency = text.match(/[$€£¥]\s?(-?[\d,]+(?:\.\d+)?)/);
  if (currency) return cleanNumber(currency[1]);
  const plain = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  return plain ? cleanNumber(plain[0]) : null;
}

/** `a.b[0].c` over parsed JSON. */
function getPath(data: unknown, path: string): unknown {
  const parts = path
    .replace(/^\$\.?/, '')
    .split(/\.|\[(\d+)\]/)
    .filter(part => part !== undefined && part !== '');
  let current: any = data;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[/^\d+$/.test(part) ? Number(part) : part];
  }
  return current;
}

const clip = (value: string) =>
  value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS - 1)}…` : value;

/**
 * The value `spec` asks for in `body`. Throws with a message a person can
 * act on when it isn't there, so the monitor shows why it failed.
 */
export function extract(body: string, spec: ExtractSpec): string {
  switch (spec.type) {
    case 'number': {
      const found = firstNumber(body);
      if (found == null) throw new Error('No number found in the response');
      return found;
    }
    case 'regex': {
      if (!spec.pattern) throw new Error('A regex extractor needs a pattern');
      let re: RegExp;
      try {
        re = new RegExp(spec.pattern, 'i');
      } catch {
        throw new Error(`Not a valid regex: ${spec.pattern}`);
      }
      const text = looksLikeHtml(body) ? htmlToText(body) : body;
      const m = text.match(re);
      if (!m) throw new Error(`Nothing matched /${spec.pattern}/`);
      return clip((m[1] ?? m[0]).trim());
    }
    case 'jsonpath': {
      if (!spec.pattern) throw new Error('A JSON path extractor needs a path');
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error('The response is not JSON');
      }
      const value = getPath(data, spec.pattern);
      if (value === undefined || value === null) {
        throw new Error(`Nothing at ${spec.pattern}`);
      }
      return clip(typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    case 'text': {
      const text = (looksLikeHtml(body) ? htmlToText(body) : body).trim();
      if (!text) throw new Error('The response was empty');
      return clip(text);
    }
  }
}

export type ConditionType = 'change' | 'above' | 'below' | 'always';

export interface Condition {
  type: ConditionType;
  value?: number;
}

/**
 * Whether a new reading should alert, and why. The first reading of a
 * monitor never counts as a change: there was nothing to change from.
 */
export function evaluate(
  condition: Condition,
  value: string,
  previous: string | null
): { alert: boolean; reason: string } {
  const n = Number.parseFloat(value);
  switch (condition.type) {
    case 'always':
      return { alert: true, reason: 'new reading' };
    case 'change':
      return previous !== null && previous !== value
        ? { alert: true, reason: 'changed' }
        : { alert: false, reason: '' };
    case 'above':
    case 'below': {
      const limit = condition.value;
      if (limit === undefined || !Number.isFinite(n)) {
        return { alert: false, reason: '' };
      }
      const now = condition.type === 'above' ? n > limit : n < limit;
      const before =
        previous === null
          ? false
          : condition.type === 'above'
            ? Number.parseFloat(previous) > limit
            : Number.parseFloat(previous) < limit;
      // Only when it crosses, not on every reading while it stays there.
      return now && !before
        ? { alert: true, reason: `${condition.type} ${limit}` }
        : { alert: false, reason: '' };
    }
  }
}

/** What the block says: the value, when it was checked, and which way it moved. */
export function blockLine(
  name: string,
  value: string,
  previous: string | null,
  at: Date
): string {
  const time = at.toISOString().slice(0, 16).replace('T', ' ');
  const n = Number.parseFloat(value);
  const p = previous === null ? Number.NaN : Number.parseFloat(previous);
  const trend =
    Number.isFinite(n) && Number.isFinite(p) && n !== p
      ? ` · ${n > p ? '↑' : '↓'} from ${previous}`
      : previous !== null && previous !== value && !Number.isFinite(n)
        ? ' · changed'
        : '';
  return `${name}: ${value} · checked ${time} UTC${trend}`;
}
