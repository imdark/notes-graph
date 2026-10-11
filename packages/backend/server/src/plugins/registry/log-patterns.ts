import { createHash } from 'node:crypto';

import {
  ALPHA,
  type Baseline,
  type Finding,
  learn,
  round,
  type Severity,
  WARMUP,
} from './baseline';

/**
 * Log patterns: the monitoring agent's read of a machine's logs, after the
 * guide's "learn normal, flag new" (VersusControl devops-ai-guidelines,
 * ch. 3). Pure, so it is tested on its own (__tests__/log-patterns.spec.ts).
 *
 * Every line is, in order:
 * 1. redacted: tokens, keys, passwords and emails are replaced before
 *    anything else looks at the line or keeps it;
 * 2. masked: numbers, ids, IPs and times become `<*>`;
 * 3. mined: it joins the pattern it is most like (Drain-style: same number
 *    of words, at least half of them the same), and the words that differ
 *    become `<*>`. Otherwise it starts a new pattern.
 *
 * The patterns are the catalog of what this machine logs. Each one learns its
 * normal rate (lines an hour, EWMA) over the scans. A scan then has three
 * verdicts per pattern: known (at its usual rate, nothing to do), new (never
 * seen before) and spike (known, far above its usual rate).
 */

export interface LogPattern {
  /** Stable for the pattern's life, though its template may widen. */
  id: string;
  template: string;
  /** One redacted line it came from. */
  example: string;
  /** Lines seen in all. */
  count: number;
  /** Epoch seconds. */
  firstSeen: number;
  lastSeen: number;
  /** 'known': a person said this is normal, so it is never news. */
  label: 'known' | null;
  /** Its rate in lines an hour, learned over the scans. */
  rate: Baseline;
}

/** A log finding's metric: this, then the pattern's id. */
export const LOG_METRIC_PREFIX = 'log:';
/** Patterns kept a machine; the least recently seen go first. */
export const MAX_PATTERNS = 300;
/** Lines read a scan; the rest are dropped (and counted as dropped). */
export const MAX_LINES = 1000;
/** A pattern seen this often, or labelled known, is part of normal. */
export const KNOWN_AFTER = 20;
/** A spike needs at least this many lines in the scan, whatever its z. */
export const MIN_SPIKE_LINES = 5;
/** Share of words two lines must share to be one pattern (Drain's st). */
const SIMILARITY = 0.5;
const MAX_WORDS = 40;
const MAX_LINE_CHARS = 500;
const MAX_TEMPLATE_CHARS = 160;
const WILDCARD = '<*>';

/** The words that make a new pattern critical rather than a warning. */
const CRITICAL = /\b(fatal|panic|critical|emerg(ency)?|segfault|segmentation fault|out of memory|oom[- ]?kill(er|ed)?|kernel bug|corrupt(ed|ion)?)\b/i;

const REDACTIONS: [RegExp, string][] = [
  // JWTs
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '<jwt>'],
  [/\b(bearer|basic)\s+[\w\-.~+/]+=*/gi, '$1 <token>'],
  // AWS access keys, GitHub and Slack tokens, sk- style API keys
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '<aws-key>'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '<token>'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '<token>'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '<token>'],
  // user:password@ in a URL
  [/(\w+:\/\/)[^\s/:@]+:[^\s/@]+@/g, '$1<redacted>@'],
  // password=…, "token": "…", api_key: …
  [
    /\b(pass(word|wd)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth(orization)?|session|cookie|private[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    '$1$4<redacted>',
  ],
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '<email>'],
];

/** The line with anything secret replaced. Runs before anything else. */
export function redact(line: string): string {
  let out = line;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const MASKS: RegExp[] = [
  // ISO and syslog times, then clock times
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/g,
  /\b\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g,
  /\b0x[0-9a-f]+\b/gi,
  // hashes and ids: hex with at least one digit
  /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi,
  /-?\d+(\.\d+)?/g,
];

/** Numbers, ids, IPs and times as `<*>`: what varies between like lines. */
export function mask(line: string): string {
  let out = line;
  for (const pattern of MASKS) out = out.replace(pattern, WILDCARD);
  // `<*>.<*>` and the like are one value.
  return out.replace(/<\*>(?:[.:,/-]?<\*>)+/g, WILDCARD);
}

/** The words a line is mined as. */
export function words(line: string): string[] {
  return mask(line.slice(0, MAX_LINE_CHARS)).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}

/** Share of a pattern's fixed words a line has in the same places. */
function similarity(template: string[], line: string[]) {
  if (template.length !== line.length) return 0;
  let same = 0;
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== WILDCARD && template[i] === line[i]) same++;
  }
  return same / template.length;
}

/** The pattern a line belongs to, if any is close enough. */
export function matchPattern(patterns: LogPattern[], line: string[]): LogPattern | null {
  let best: LogPattern | null = null;
  let bestScore = 0;
  for (const pattern of patterns) {
    const template = pattern.template.split(' ');
    // Like Drain's tree: the first word has to agree (it's usually the program).
    if (template[0] !== WILDCARD && template[0] !== line[0]) continue;
    const score = similarity(template, line);
    if (score >= SIMILARITY && score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }
  return best;
}

/** The template that covers both: where they differ is `<*>`. */
export function merge(template: string, line: string[]): string {
  return template
    .split(' ')
    .map((word, i) => (word === line[i] ? word : WILDCARD))
    .join(' ');
}

const patternId = (template: string) =>
  createHash('sha1').update(template).digest('hex').slice(0, 12);

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Whether a pattern is part of normal: labelled so, or seen often enough. */
export const isKnown = (pattern: Pick<LogPattern, 'label' | 'count'>) =>
  pattern.label === 'known' || pattern.count >= KNOWN_AFTER;

/** How far above its usual rate a pattern is, in standard deviations. */
export function rateScore(rate: Baseline, perHour: number) {
  // Counts are noisy like a Poisson process: never trust a spread below √mean.
  const std = Math.max(Math.sqrt(rate.variance), Math.sqrt(Math.max(rate.mean, 1)));
  return (perHour - rate.mean) / std;
}

export interface LogScan {
  patterns: LogPattern[];
  findings: Finding[];
  /** Lines read, and lines past MAX_LINES that weren't. */
  lines: number;
  dropped: number;
}

/**
 * One scan of a machine's logs folded into its catalog: the catalog after
 * it, and what it found. `scans` is how many scans came before; nothing is
 * new until the catalog has had WARMUP of them. `hours` is how much time the
 * lines cover, for their rate.
 */
export function ingestLogs(
  catalog: LogPattern[],
  lines: string[],
  opts: { scans: number; hours: number; now: number; sensitivity: number }
): LogScan {
  const patterns = catalog.map(pattern => ({ ...pattern }));
  const created = new Set<string>();
  const counts = new Map<string, number>();
  const read = lines.slice(0, MAX_LINES);

  for (const raw of read) {
    const safe = redact(raw).trim();
    if (!safe) continue;
    const line = words(safe);
    if (!line.length) continue;
    let pattern = matchPattern(patterns, line);
    if (pattern) {
      pattern.template = merge(pattern.template, line);
    } else {
      const template = line.join(' ');
      pattern = {
        id: patternId(template),
        template,
        example: clip(safe, MAX_LINE_CHARS),
        count: 0,
        firstSeen: opts.now,
        lastSeen: opts.now,
        label: null,
        rate: { mean: 0, variance: 0, samples: 0, lastValue: null },
      };
      // Two templates can hash alike only if they are the same; keep ids unique anyway.
      while (patterns.some(p => p.id === pattern!.id)) pattern.id = patternId(pattern.id);
      patterns.push(pattern);
      created.add(pattern.id);
    }
    pattern.count++;
    pattern.lastSeen = opts.now;
    counts.set(pattern.id, (counts.get(pattern.id) ?? 0) + 1);
  }

  const hours = Math.min(Math.max(opts.hours, 1 / 60), 24);
  const learning = opts.scans < WARMUP;
  const findings: Finding[] = [];

  for (const pattern of patterns) {
    const count = counts.get(pattern.id) ?? 0;
    const perHour = count / hours;
    const severity: Severity = CRITICAL.test(pattern.example) ? 'critical' : 'warn';
    const shown = clip(pattern.template, MAX_TEMPLATE_CHARS);

    if (created.has(pattern.id)) {
      if (!learning) {
        findings.push({
          metric: LOG_METRIC_PREFIX + pattern.id,
          kind: 'new',
          severity,
          value: count,
          baseline: null,
          score: null,
          summary: `New in the logs (${count}×): "${shown}"`,
        });
      }
      pattern.rate = learn(null, perHour);
      continue;
    }

    if (pattern.rate.samples >= WARMUP && count >= MIN_SPIKE_LINES) {
      const z = rateScore(pattern.rate, perHour);
      if (z >= opts.sensitivity) {
        findings.push({
          metric: LOG_METRIC_PREFIX + pattern.id,
          kind: 'anomaly',
          severity: severity === 'critical' || z >= opts.sensitivity * 2 ? 'critical' : 'warn',
          value: round(perHour),
          baseline: round(pattern.rate.mean),
          score: round(z),
          summary:
            `"${shown}" is logged ${round(perHour)}/h; ` +
            `normal here is about ${round(pattern.rate.mean)}/h (${round(z)}σ above)`,
        });
        // A spike is held out of the baseline, so it can't drag normal up
        // and hide the next one. A lasting change is learned once marked expected.
        pattern.rate = { ...pattern.rate, lastValue: perHour };
        continue;
      }
    }
    pattern.rate = learn(pattern.rate, perHour, ALPHA);
  }

  // The catalog stays bounded: the patterns not seen for longest go.
  patterns.sort((a, b) => b.lastSeen - a.lastSeen || b.count - a.count);
  return {
    patterns: patterns.slice(0, MAX_PATTERNS),
    findings,
    lines: read.length,
    dropped: Math.max(0, lines.length - MAX_LINES),
  };
}

/** "Expected" on a log finding: the pattern is normal, at this rate too. */
export function acceptPattern(pattern: LogPattern, perHour: number | null): LogPattern {
  let rate = pattern.rate;
  if (perHour !== null && rate.samples > 0) {
    rate = learn(rate, perHour, 0.5);
    rate.variance = Math.max(rate.variance, ((perHour - rate.mean) / 2) ** 2);
  }
  return { ...pattern, label: 'known', rate };
}

export interface LogPatternDto {
  id: string;
  template: string;
  example: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  known: boolean;
  label: string | null;
  /** Usual lines an hour, and its spread. */
  perHour: number;
  std: number;
}

export const toLogPatternDto = (pattern: LogPattern): LogPatternDto => ({
  id: pattern.id,
  template: pattern.template,
  example: pattern.example,
  count: pattern.count,
  firstSeen: pattern.firstSeen,
  lastSeen: pattern.lastSeen,
  known: isKnown(pattern),
  label: pattern.label,
  perHour: round(pattern.rate.mean),
  std: round(Math.sqrt(pattern.rate.variance)),
});

export interface LogCatalogDto {
  deviceKey: string;
  scans: number;
  /** Epoch seconds the logs were read up to. */
  scannedAt: number | null;
  patterns: LogPatternDto[];
}

/** The patterns as stored, with anything malformed left out. */
export function readCatalog(raw: unknown): LogPattern[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is LogPattern =>
      !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.template === 'string'
  );
}
