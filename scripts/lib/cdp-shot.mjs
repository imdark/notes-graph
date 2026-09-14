#!/usr/bin/env node
// Capture a PNG screenshot of the app page (via CDP). Used by
// scripts/debug-local-web-dev.sh `shot` so the loop can grab a visual of the
// running app without the interactive chrome-devtools MCP.
//
//   CHROME_PROFILE=... CDP_MATCH=localhost:8080 \
//     node scripts/lib/cdp-shot.mjs <outfile.png> [navigate-url]
//
// If navigate-url is given, the page is navigated there and left to settle
// before capture. Exits non-zero on CDP errors. Discovery is endpoint-
// independent (see cdp.mjs).

import { writeFile } from 'node:fs/promises';
import { connect, attachPage, die } from './cdp.mjs';

const outfile = process.argv[2];
const navigateUrl = process.argv[3];
if (!outfile) {
  console.error('usage: cdp-shot.mjs <outfile.png> [navigate-url]');
  process.exit(2);
}

let cdp;
try {
  cdp = await connect();
  const { sessionId } = await attachPage(cdp);
  await cdp.send('Page.enable', {}, sessionId);
  if (navigateUrl) {
    await cdp.send('Page.navigate', { url: navigateUrl }, sessionId);
    await new Promise(r => setTimeout(r, 2500));
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(outfile, Buffer.from(data, 'base64'));
  console.log(`wrote ${outfile}`);
  cdp.close();
  process.exit(0);
} catch (err) {
  if (cdp) cdp.close();
  die(err.message);
}
