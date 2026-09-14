#!/usr/bin/env node
/**
 * DoorDash order-history crawler (discovery-first).
 *
 * Opens a real, persistent browser so you log in ONCE (your credentials never
 * touch this script — you type them into DoorDash directly). It then loads your
 * full order history and captures DoorDash's own JSON API responses, which are
 * far more robust to scrape than the page markup. It writes:
 *
 *   doordash-out/api-captures.json   every DoorDash JSON response (raw)
 *   doordash-out/orders.json         best-effort normalized order list
 *   doordash-out/orders-page.html    a DOM snapshot of the orders page (fallback)
 *
 * If orders.json already looks right, we go straight to the NotesGraph import.
 * If DoorDash changed its schema, api-captures.json shows the real shape and we
 * refine the extractor from there.
 *
 * Run from the repo root (Playwright + Chromium resolve from ./node_modules):
 *   node tools/doordash-crawler/crawl.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

// A persistent profile keeps you logged in between runs and looks like a normal
// browser to DoorDash's bot checks.
const PROFILE_DIR = path.join(os.homedir(), '.doordash-crawler-profile');
const OUT_DIR = path.resolve('doordash-out');
const HOME_URL = 'https://www.doordash.com/';
const ORDERS_URL = 'https://www.doordash.com/orders';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

/** Scroll + click "show more"-style buttons until the order list stops growing. */
async function loadAllOrders(page) {
  let stable = 0;
  let lastHeight = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    // Click any "load/show more orders" control if present.
    const more = page.locator(
      'button:has-text("more orders"), button:has-text("Show more"), button:has-text("Load more")'
    );
    if (await more.count().catch(() => 0)) {
      await more.first().click().catch(() => {});
    }
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(1200);
    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (height === lastHeight) stable++;
    else { stable = 0; lastHeight = height; }
  }
}

/** Deep-walk a JSON value, scoring arrays by how "order-like" their items are. */
function findOrderArrays(root) {
  const results = [];
  const orderKey = /store|merchant|restaurant/i;
  const totalKey = /total|grandTotal|amount|subtotal/i;
  const dateKey = /created|submitted|delivered|timestamp|date/i;
  const seen = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const sample = value.find(v => v && typeof v === 'object');
      if (sample) {
        const keys = JSON.stringify(Object.keys(sample));
        const score =
          (orderKey.test(keys) ? 1 : 0) +
          (totalKey.test(keys) ? 1 : 0) +
          (dateKey.test(keys) ? 1 : 0);
        if (score >= 2 && value.length) results.push({ score, items: value });
      }
      value.forEach(walk);
      return;
    }
    Object.values(value).forEach(walk);
  };
  walk(root);
  return results.sort((a, b) => b.score - a.score || b.items.length - a.items.length);
}

/** Best-effort normalization of a raw order object into a flat record. */
function normalizeOrder(o) {
  const pick = (obj, re) => {
    for (const [k, v] of Object.entries(obj)) {
      if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) return v;
    }
    return undefined;
  };
  const store = o.store || o.merchant || o.restaurant || {};
  return {
    id: o.id ?? o.orderUuid ?? o.uuid ?? pick(o, /^id$|uuid/i),
    store:
      (typeof store === 'object' ? store.name || store.businessName : store) ??
      pick(o, /store|merchant|restaurant/i),
    date: pick(o, /created|submitted|delivered|date/i),
    total: pick(o, /grandTotal|orderTotal|^total$|amount/i),
    itemCount: Array.isArray(o.items) ? o.items.length : pick(o, /itemCount|quantity/i),
    raw: o,
  };
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
// Light touch to look less automated (masks navigator.webdriver).
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = context.pages()[0] ?? (await context.newPage());

// Capture every DoorDash JSON response.
const captures = [];
const seenUrls = new Set();
page.on('response', async res => {
  try {
    const url = res.url();
    if (!/doordash\.com/.test(url)) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    const body = await res.json().catch(() => null);
    if (body == null) return;
    captures.push({ url, status: res.status(), body });
    seenUrls.add(url.split('?')[0]);
  } catch {
    /* ignore */
  }
});

await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('\n=== DoorDash order crawler ===');
console.log('A browser window opened. Log in to DoorDash there if you are not already.');
await prompt('When you can see your account (logged in), press Enter here to continue... ');

console.log('Loading your order history...');
await page.goto(ORDERS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(3000);
await loadAllOrders(page);
await page.waitForTimeout(1500);

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'api-captures.json'), JSON.stringify(captures, null, 2));
await fs.writeFile(
  path.join(OUT_DIR, 'orders-page.html'),
  await page.content().catch(() => '')
);

// Best-effort extraction from the richest order-like API array.
const candidates = captures.flatMap(c => findOrderArrays(c.body));
const best = candidates[0];
const orders = best ? best.items.map(normalizeOrder) : [];
await fs.writeFile(path.join(OUT_DIR, 'orders.json'), JSON.stringify(orders, null, 2));

console.log('\n--- done ---');
console.log(`DoorDash JSON endpoints seen:\n  ${[...seenUrls].join('\n  ') || '(none)'}`);
console.log(`Captured ${captures.length} JSON responses -> ${path.join(OUT_DIR, 'api-captures.json')}`);
console.log(`Extracted ${orders.length} candidate orders -> ${path.join(OUT_DIR, 'orders.json')}`);
if (!orders.length) {
  console.log(
    '\nNo orders auto-extracted (DoorDash likely changed its schema).\n' +
      'Send me doordash-out/api-captures.json and I will build the exact extractor.'
  );
}

await prompt('Press Enter to close the browser... ');
await context.close();
