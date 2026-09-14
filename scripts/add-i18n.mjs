#!/usr/bin/env node
//
// Add or update a key in the source locale (en.json), idempotently — so the
// loop doesn't inline a `python3 <<EOF` heredoc (which needs special
// approval) every time a feature adds a string.
//
//   node scripts/add-i18n.mjs "com.notesgraph.foo.bar" "Label text"
//
// New keys are appended; other locales are filled by the normal i18n sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [key, ...rest] = process.argv.slice(2);
const value = rest.join(' ');
if (!key || rest.length === 0) {
  console.error('usage: add-i18n.mjs <key> <value>');
  process.exit(2);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(repoRoot, 'packages/frontend/i18n/src/resources/en.json');
const obj = JSON.parse(readFileSync(file, 'utf8'));

if (obj[key] === value) {
  console.log(`unchanged: ${key}`);
  process.exit(0);
}
const existed = Object.hasOwn(obj, key);
obj[key] = value;
writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
console.log(`${existed ? 'updated' : 'added'}: ${key} = ${JSON.stringify(value)}`);
