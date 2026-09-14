#!/usr/bin/env node
// Evaluate a JS expression in the app page (via CDP) and print the JSON result.
// Used by scripts/debug-local-web-dev.sh `eval` so the loop can assert on the
// running app's DOM without the interactive chrome-devtools MCP.
//
//   CHROME_PROFILE=... CDP_MATCH=localhost:8080 \
//     node scripts/lib/cdp-eval.mjs "(() => document.title)()"
//
// The expression must evaluate to a JSON-serializable value. Exits non-zero on
// CDP/eval errors. Target discovery is endpoint-independent (see cdp.mjs).

import { connect, attachPage, die } from './cdp.mjs';

const expression = process.argv[2];
if (!expression) {
  console.error('usage: cdp-eval.mjs "<js-expression>"');
  process.exit(2);
}

let cdp;
try {
  cdp = await connect();
  const { sessionId } = await attachPage(cdp);
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (res.exceptionDetails) {
    die(`eval threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  process.stdout.write(JSON.stringify(res.result?.value ?? null) + '\n');
  cdp.close();
  process.exit(0);
} catch (err) {
  if (cdp) cdp.close();
  die(err.message);
}
