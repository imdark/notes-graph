import test from 'ava';

import { findSecret, guardSecrets, secretRefusal } from '../secret-guard';

// Fixtures are assembled at runtime so this file never holds a literal
// token-shaped string that a repo scanner would flag.
const rep = (chars: string, n: number) => chars.repeat(n).slice(0, n);
const AWS = 'AKIA' + rep('ABCDEFGHIJ2345', 16);
const STS = 'ASIA' + rep('QRSTUVWXYZ6789', 16);
const ANTHROPIC = 'sk-' + 'ant-' + 'api03-' + rep('aB3dE5gH7j', 40);
const OPENAI = 'sk-' + 'proj-' + rep('Zx9Yw8Vu7T', 32);
const GHP = 'ghp' + '_' + rep('aB1cD2eF3g', 36);
const GH_PAT = 'github' + '_pat_' + rep('11ABCDEFG0', 30);
const SLACK = 'xox' + 'b-' + '1234567890-' + rep('abcDEF1234', 24);
const GOOGLE = 'AI' + 'za' + rep('Sy0aB-_cD9', 35);
const JWT =
  'eyJ' +
  'hbGciOiJIUzI1NiJ9' +
  '.' +
  'eyJ' +
  'zdWIiOiIxMjM0NSJ9' +
  '.' +
  rep('Qw3rTy_-', 30);
const PEM_BODY = rep('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 64);
const pem = (kind: string) =>
  `-----BEGIN ${kind}PRIVATE KEY-----\n${PEM_BODY}\n-----END ${kind}PRIVATE KEY-----`;

const positives: [string, string, string][] = [
  ['AWS access key', `aws key ${AWS} in prod`, 'an AWS access key'],
  ['AWS STS key', `ASIA: ${STS}`, 'an AWS access key'],
  [
    'Anthropic key',
    `export ANTHROPIC_API_KEY=${ANTHROPIC}`,
    'an Anthropic/OpenAI API key (sk-…)',
  ],
  [
    'OpenAI key',
    `use ${OPENAI} for the bot`,
    'an Anthropic/OpenAI API key (sk-…)',
  ],
  ['GitHub classic token', `token ${GHP}`, 'a GitHub token'],
  ['GitHub fine-grained PAT', GH_PAT, 'a GitHub token'],
  ['Slack token', `slack: ${SLACK}`, 'a Slack token'],
  ['Google API key', `maps ${GOOGLE}`, 'a Google API key'],
  ['JWT', `Authorization header ${JWT}`, 'a JWT'],
  ['PEM private key', pem(''), 'a private key (PEM block)'],
  ['RSA PEM private key', pem('RSA '), 'a private key (PEM block)'],
  ['OpenSSH private key', pem('OPENSSH '), 'a private key (PEM block)'],
  ['password=', 'db password=hunter2xx', 'a password assignment'],
  ['JSON password', '{"password": "Tr0ub4dor"}', 'a password assignment'],
  ['YAML secret with digits', 'secret: s3cr3tvalue', 'a password assignment'],
  ['quoted api_key', "api_key = 'abcdefghij'", 'a password assignment'],
  ['env token', 'TOKEN=abc123def456', 'a password assignment'],
  ['pwd', 'pwd=letmein99', 'a password assignment'],
];

for (const [name, text, label] of positives) {
  test(`detects ${name}`, t => {
    t.is(findSecret(text), label);
  });
}

const negatives: [string, string][] = [
  [
    'prose about passwords',
    'Reset your password from the settings page, then log in again.',
  ],
  [
    'labelled field with a plain word',
    'Password: required for the admin panel',
  ],
  ['token prose', 'Token: see the vault entry, never paste it here.'],
  [
    'short sk- word',
    'We use sk-learn and sk-1 for the model; task-runner too.',
  ],
  ['sk- kebab without digits', 'sk-the-quick-brown-fox-jumps-over'],
  [
    'markdown about tokens',
    '## Tokens\n\n- GitHub tokens start with `ghp_`\n- Slack tokens look like `xoxb-your-token-here`\n- AWS keys start with AKIA',
  ],
  ['short password value', 'password=abc'],
  ['masked value', 'password=********'],
  ['xxx placeholder', 'api_key=xxxxxxxx'],
  ['angle placeholder', 'token=<your-token>'],
  ['env placeholder', 'password=${DB_PASSWORD}'],
  ['template placeholder', 'secret: {{ vault.secret }}'],
  ['changeme', 'password=changeme'],
  ['code reference', 'password = os.environ["DB_PASS"]'],
  ['max_tokens is not token', 'max_tokens=4096 and num_tokens: 12345678'],
  [
    'PEM header mentioned in prose',
    'The file starts with -----BEGIN PRIVATE KEY----- and ends with the END line.',
  ],
  ['a uuid', 'docId 3f2b8c1e-9a4d-4e2b-8f1a-6c7d8e9f0a1b'],
  ['empty', ''],
];

for (const [name, text] of negatives) {
  test(`allows ${name}`, t => {
    t.is(findSecret(text), null);
  });
}

test('refusal names the kind and never echoes the value', t => {
  for (const [, text, label] of positives) {
    const message = guardSecrets(text);
    t.is(message, secretRefusal(label));
    const value = text.match(/[A-Za-z0-9_\-+/=]{8,}/g) ?? [];
    for (const piece of value) {
      if (['password', 'Authorization', 'ANTHROPIC_API_KEY'].includes(piece))
        continue;
      t.false(
        message!.includes(piece),
        `refusal leaked "${piece.slice(0, 4)}…"`
      );
    }
  }
  t.regex(secretRefusal('a GitHub token'), /^Refused: .*a GitHub token\./);
});

test('guardSecrets checks every field and skips undefined', t => {
  t.is(guardSecrets(undefined, 'plain note', ''), null);
  t.is(
    guardSecrets('fine title', `body ${AWS}`),
    secretRefusal('an AWS access key')
  );
});

test('a secret already in the note does not block rewriting it', t => {
  const key = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
  const existing = `Deploy notes\naws key ${key}\n`;
  t.is(findSecret(`${existing}- a new line from the agent\n`, existing), null);
  const other = ['AKIA', 'QRSTUVWXYZ234567'].join('');
  t.is(findSecret(`${existing}${other}\n`, existing), 'an AWS access key');
});
