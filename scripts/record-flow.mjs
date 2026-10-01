#!/usr/bin/env node
/**
 * Record a scripted browser flow to video, using Playwright's built-in
 * recorder. Written for the Google OAuth verification demo, but useful for
 * any "show the feature working" clip.
 *
 *   node scripts/record-flow.mjs <flow> [out.webm]
 *   node scripts/record-flow.mjs --list
 *
 * Flows live in FLOWS below. Each is a list of labelled steps run against a
 * page that is being recorded the whole time.
 *
 * PROFILE: a persistent context at RECORD_PROFILE (default
 * /tmp/notesgraph-record-profile), NOT the debug-Chrome profile - two
 * browsers cannot share one user-data-dir, and the debug Chrome is usually
 * already running. Because it persists, you sign in once and later runs
 * reuse the session.
 *
 * SCOPE: Playwright records the PAGE, not the browser window - no URL bar,
 * no tabs, no OS chrome. For a verification video that is usually fine (the
 * consent screen names the app and domain itself), but it is a real
 * difference from a screen recording.
 *
 * Env:
 *   RECORD_BASE_URL   app under test (default https://app.notesgraph.com)
 *   RECORD_PROFILE    user-data-dir to reuse (default /tmp/notesgraph-record-profile)
 *   RECORD_WIDTH/HEIGHT  viewport + video size (default 1280x800)
 *   RECORD_HEADLESS   '1' to hide the window (default: headed, so you can
 *                     take over for a manual step such as signing in)
 */
import { chromium } from 'playwright';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.RECORD_BASE_URL ?? 'https://app.notesgraph.com';
const PROFILE = process.env.RECORD_PROFILE ?? '/tmp/notesgraph-record-profile';
const WIDTH = Number(process.env.RECORD_WIDTH ?? 1280);
const HEIGHT = Number(process.env.RECORD_HEIGHT ?? 800);
const HEADLESS = process.env.RECORD_HEADLESS === '1';

/** Pause so a viewer can read the screen before the next action. */
const beat = (page, ms = 1200) => page.waitForTimeout(ms);

/**
 * Wait for a human to do something the script must not (signing into Google,
 * clicking Allow on a consent screen). Resolves when `done(page)` is true.
 */
async function handOver(page, label, done, timeoutMs = 180_000) {
  console.log(`\n>>> ${label}`);
  console.log('    (do it in the open window; recording continues)\n');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await done(page).catch(() => false)) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const FLOWS = {
  /**
   * The Google OAuth verification demo: connect a calendar, choose which
   * calendars to show, then show the events on a journal page.
   *
   * The sign-in and the Allow click are handed to you deliberately - they
   * are consent decisions, and a reviewer is entitled to see a real one.
   */
  'calendar-demo': [
    ['open the app', async page => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid=settings-modal-trigger]', { timeout: 60_000 });
      await beat(page, 1500);
    }],
    ['open settings', async page => {
      await page.click('[data-testid=settings-modal-trigger]');
      await beat(page);
    }],
    // A signed-out visitor gets a LOCAL workspace, which has no calendar
    // integration at all. Without this gate the flow sails through every
    // later step - their conditions are all satisfied by the empty starting
    // state - and reports success over a recording of nothing.
    ['require a signed-in cloud workspace', async page => {
      const signedIn = () => page.locator('[data-testid=user-info-card]').isVisible();
      if (!(await signedIn().catch(() => false))) {
        await handOver(page, 'sign in to your cloud workspace', signedIn);
      }
      await beat(page);
    }],
    ['connect a Google calendar', async page => {
      await handOver(
        page,
        'Account -> Integrations -> connect Google, sign in, and click Allow',
        // Progress means a calendar is actually listed to subscribe to, not
        // merely that the Integrations tab exists. The absence of the empty
        // state is not enough on its own -- it is equally absent when the
        // panel never rendered -- so pair it with the panel's Save button,
        // which that panel always draws.
        async p => {
          await p.click('[data-testid="workspace-setting:integrations"]').catch(() => {});
          const panelUp = await p.getByRole('button', { name: /^Save$/ })
            .count().then(n => n > 0).catch(() => false);
          if (!panelUp) return false;
          return p.locator('text=/No subscribed calendars yet/i').count()
            .then(n => n === 0);
        }
      );
      await beat(page);
    }],
    ['choose calendars', async page => {
      await handOver(
        page,
        'tick the calendars you want, then press Save',
        // Saving clears the dirty state, so the Save button goes disabled.
        p => p.getByRole('button', { name: /^Save$/ }).isDisabled().catch(() => false)
      );
      await beat(page);
    }],
    ['show the journal page', async page => {
      await page.keyboard.press('Escape');
      await beat(page, 800);
      const journal = page.getByText(/^Journal$/).first();
      if (await journal.isVisible().catch(() => false)) await journal.click();
      await beat(page, 3000);
      // The payoff shot. If no events rendered there is nothing worth
      // filming, so say so rather than hand over a useless video.
      const events = await page.locator('[data-testid=day-calendar-section]').count();
      if (events === 0) {
        throw new Error(
          'journal page shows no calendar events - the demo has no payoff shot'
        );
      }
    }],
  ],

  /** A quick self-test: does recording work at all? */
  smoke: [
    ['open the app', async page => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await beat(page, 2500);
    }],
  ],
};

const flowName = process.argv[2];
const outArg = process.argv[3];

if (flowName === '--list' || !flowName) {
  console.log('flows:', Object.keys(FLOWS).join(', '));
  process.exit(flowName ? 0 : 2);
}
const flow = FLOWS[flowName];
if (!flow) {
  console.error(`unknown flow '${flowName}'. known: ${Object.keys(FLOWS).join(', ')}`);
  process.exit(2);
}

const outDir = path.resolve(outArg ? path.dirname(outArg) : '.recordings');
await mkdir(outDir, { recursive: true });
const videoDir = path.join(outDir, `.raw-${Date.now()}`);
await mkdir(videoDir, { recursive: true });

console.log(`profile : ${PROFILE}${existsSync(PROFILE) ? '' : ' (new - you will need to sign in)'}`);
console.log(`target  : ${BASE}`);
console.log(`flow    : ${flowName}`);

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: HEADLESS,
  viewport: { width: WIDTH, height: HEIGHT },
  recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
  args: ['--window-size=' + WIDTH + ',' + (HEIGHT + 120)],
});

const page = context.pages()[0] ?? (await context.newPage());
let failure = null;
try {
  for (const [label, run] of flow) {
    console.log(`--> ${label}`);
    await run(page);
  }
  console.log('--> done');
} catch (err) {
  failure = err;
  console.error(`!! ${err.message}`);
}

// The video is only finalised on close, so this must happen either way.
await context.close();

const [raw] = (await readdir(videoDir)).filter(f => f.endsWith('.webm'));
if (!raw) {
  console.error('!! no video produced');
  process.exit(1);
}
const out = outArg ?? path.join(outDir, `${flowName}-${Date.now()}.webm`);
await rename(path.join(videoDir, raw), out);
console.log(`\nvideo: ${out}`);
console.log('(mp4 if you need it: ffmpeg -i "' + out + '" -c:v libx264 -pix_fmt yuv420p out.mp4)');
process.exit(failure ? 1 : 0);
