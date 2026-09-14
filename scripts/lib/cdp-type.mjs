#!/usr/bin/env node
// Type text into the focused element of the app page via the Chrome DevTools
// Protocol — real key events (Input.dispatchKeyEvent), so editor input rules /
// IME-style handlers fire just like a human typing. Used by
// scripts/debug-local-web-dev.sh `type` to verify editor-input features
// (markdown shortcuts, status chips, …) without the interactive MCP.
//
//   CHROME_PROFILE=... CDP_MATCH=localhost:8080 \
//     node scripts/lib/cdp-type.mjs "TODO buy milk" "[optional focus selector]"
//
// If a focus selector is given, that element is clicked/focused first. Special
// keys are supported via {Enter}, {Backspace}, {Space}, {Tab} tokens.

import { connect, attachPage, die } from './cdp.mjs';

const text = process.argv[2];
const focusSelector = process.argv[3];
if (text === undefined) {
  console.error('usage: cdp-type.mjs "<text>" [focus-selector]');
  process.exit(2);
}

const SPECIAL = {
  Enter: { key: 'Enter', code: 'Enter', text: '\r' },
  Backspace: { key: 'Backspace', code: 'Backspace' },
  Tab: { key: 'Tab', code: 'Tab', text: '\t' },
  Space: { key: ' ', code: 'Space', text: ' ' },
};

// Tokenize "abc{Enter}def" into chars and {Special} tokens.
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      if (end > i) {
        const name = s.slice(i + 1, end);
        if (SPECIAL[name]) {
          out.push(SPECIAL[name]);
          i = end + 1;
          continue;
        }
      }
    }
    const ch = s[i];
    out.push({ key: ch, text: ch });
    i++;
  }
  return out;
}

let cdp;
try {
  cdp = await connect();
  const { sessionId } = await attachPage(cdp);

  if (focusSelector) {
    const sel = JSON.stringify(focusSelector);
    await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => { const el = document.querySelector(${sel}); if (!el) return false; el.click(); el.focus && el.focus(); return true; })()`,
        returnByValue: true,
      },
      sessionId
    );
    await new Promise(r => setTimeout(r, 200));
  }

  for (const tok of tokenize(text)) {
    const down = { type: tok.text ? 'keyDown' : 'rawKeyDown', key: tok.key };
    if (tok.code) down.code = tok.code;
    if (tok.text) {
      down.text = tok.text;
      down.unmodifiedText = tok.text;
    }
    await cdp.send('Input.dispatchKeyEvent', down, sessionId);
    await cdp.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: tok.key, ...(tok.code ? { code: tok.code } : {}) },
      sessionId
    );
    await new Promise(r => setTimeout(r, 18));
  }

  console.log(`typed ${text.length} chars`);
  cdp.close();
  process.exit(0);
} catch (err) {
  if (cdp) cdp.close();
  die(err.message);
}
