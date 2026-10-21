/**
 * Refuses agent writes that look like they carry a credential. A note syncs
 * to every device and keeps its history, so a leaked token can't be taken
 * back by a later edit — the only safe place to stop it is before the write.
 *
 * The patterns favour precision over recall: they match the fixed shapes
 * real providers issue (prefix + length + charset) so ordinary notes that
 * talk *about* passwords, tokens or keys go through untouched.
 */

/** A provider token shape and the label used in the refusal. */
const TOKEN_PATTERNS: [RegExp, string][] = [
  // Needs a base64 body after the header, so a note that only names the
  // header line (e.g. explaining PEM files) is not refused.
  [
    /-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|PGP|ENCRYPTED) )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,200}?[A-Za-z0-9+/=]{40,}/,
    'a private key (PEM block)',
  ],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}/, 'a GitHub token'],
  // Docs use "xoxb-your-token-here"; real Slack tokens always carry digits.
  [/\bxox[baprs]-(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, 'a Google API key'],
  // Same digit requirement keeps long kebab-case words starting "sk-" out.
  [
    /\bsk-(?:ant-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/,
    'an Anthropic/OpenAI API key (sk-…)',
  ],
  // Header and payload are both base64 JSON objects, so both start "eyJ".
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/, 'a JWT'],
];

/**
 * `password=…`, `"api_key": "…"`, `token: '…'`. With a bare `key: value`
 * (YAML or prose like "Password: required") the value must also contain a
 * digit or symbol, otherwise every note with a "Token: see vault" line
 * would be refused.
 */
const ASSIGNMENT =
  /\b(password|passwd|pwd|secret|api[_-]?key|token)(["']?)\s*([:=])\s*(["'`]?)([^\s"'`,;]+)/gi;

const MIN_SECRET_LENGTH = 6;

/**
 * Values that stand in for a secret rather than being one: masks (`***`,
 * `xxxxxx`), templates (`<token>`, `${API_KEY}`, `{{ secret }}`, `%PASS%`,
 * `$PASS`), code references (`os.environ["X"]`, `getenv(...)`,
 * `process.env.X`) and stock words like "changeme".
 */
function isPlaceholder(value: string): boolean {
  if (/^(.)\1+$/.test(value)) return true;
  if (/^[<${%[]/.test(value)) return true;
  if (/[([]/.test(value)) return true;
  if (/^(process\.)?env\./i.test(value)) return true;
  return /^(changeme|change_me|placeholder|redacted|example|password|secret|your[_-].*|null|none|undefined|true|false)$/i.test(
    value
  );
}

function* assignments(text: string): Generator<string> {
  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, , keyQuote, separator, valueQuote, value] = match;
    if (value.length < MIN_SECRET_LENGTH || isPlaceholder(value)) continue;
    const quoted = Boolean(keyQuote || valueQuote);
    if (separator === ':' && !quoted && /^[A-Za-z]+$/.test(value)) continue;
    yield value;
  }
}

/** Every secret in `text`: what matched, and its label. */
function* secrets(text: string): Generator<{ value: string; label: string }> {
  for (const [pattern, label] of TOKEN_PATTERNS) {
    for (const match of text.matchAll(
      new RegExp(pattern.source, `${pattern.flags}g`)
    )) {
      yield { value: match[0], label };
    }
  }
  for (const value of assignments(text)) {
    yield { value, label: 'a password assignment' };
  }
}

/**
 * The kind of secret found in `text` (e.g. "an AWS access key"), or null.
 * Returns only a label — never the matched value — so callers can report
 * it without echoing the secret back. Secrets already in `existing` (the
 * note as it is) don't count: the agent didn't bring them, and refusing
 * would leave a note that holds one impossible for an agent to edit.
 */
export function findSecret(text: string, existing = ''): string | null {
  for (const { value, label } of secrets(text)) {
    if (!existing.includes(value)) return label;
  }
  return null;
}

export function secretRefusal(label: string): string {
  return `Refused: this text contains what looks like ${label}. Remove it (or replace it with a placeholder) and try again; secrets in notes stay in their history on every device.`;
}

/** The refusal for the first field that holds a secret, or null. */
export function guardSecrets(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const label = findSecret(text);
    if (label) return secretRefusal(label);
  }
  return null;
}
