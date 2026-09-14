// Regenerate the Android launcher icons from the NotesGraph brand mark
// (the "N made of nodes" — see packages/frontend/core/public/favicon.svg).
// Produces: adaptive-icon foreground (all densities), legacy square + round
// launcher rasters, and the Play Store icon. Run: node scripts/gen-android-icon.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RES = path.resolve(
  __dirname,
  '..',
  'packages/frontend/apps/android/App/app/src/main'
);

const BG = '#14141C';

// The brand mark, laid out in a 108x108 viewport, sized to sit inside the
// adaptive-icon safe zone (centre 72dp). Corners of the "N" carry the nodes;
// the top-right node uses the purple→cyan accent gradient.
const mark = `
  <defs>
    <linearGradient id="ng" x1="61.6" y1="25.6" x2="82.4" y2="46.4" gradientUnits="userSpaceOnUse">
      <stop stop-color="#7C6CFF"/><stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <path d="M36,72 V36 M36,36 L72,72 M72,72 V36"
        stroke="#8B7DFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="36" cy="36" r="8.6" fill="#E7E7F2"/>
  <circle cx="36" cy="72" r="8.6" fill="#E7E7F2"/>
  <circle cx="72" cy="72" r="8.6" fill="#E7E7F2"/>
  <circle cx="72" cy="36" r="10.4" fill="url(#ng)"/>`;

const svg = (inner) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">${inner}</svg>`
  );

// Transparent foreground (for the adaptive icon's foreground layer).
const foreground = svg(mark);
// Full icon: dark rounded square + mark (legacy square launcher + splash).
const full = svg(`<rect width="108" height="108" rx="24" fill="${BG}"/>${mark}`);
// Round icon: dark circle + mark (legacy round launcher).
const round = svg(`<circle cx="54" cy="54" r="54" fill="${BG}"/>${mark}`);
// Play Store: full-bleed square (no rounded corners — Play applies its own mask).
const store = svg(`<rect width="108" height="108" fill="${BG}"/>${mark}`);

// density -> px. Launcher rasters are 48dp; adaptive foreground is 108dp.
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const webp = (buf, px, out) =>
  sharp(buf, { density: 512 })
    .resize(px, px)
    .webp({ lossless: true })
    .toFile(out)
    .then(() => console.log('  ' + path.relative(RES, out)));

const png = (buf, px, out) =>
  sharp(buf, { density: 512 })
    .resize(px, px)
    .png()
    .toFile(out)
    .then(() => console.log('  ' + path.relative(RES, out)));

const jobs = [];
for (const [d, px] of Object.entries(LAUNCHER)) {
  const dir = path.join(RES, 'res', `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  jobs.push(webp(full, px, path.join(dir, 'ic_launcher.webp')));
  jobs.push(webp(round, px, path.join(dir, 'ic_launcher_round.webp')));
}
for (const [d, px] of Object.entries(FOREGROUND)) {
  const dir = path.join(RES, 'res', `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  jobs.push(webp(foreground, px, path.join(dir, 'ic_launcher_foreground.webp')));
}
jobs.push(png(store, 512, path.join(RES, 'ic_launcher-playstore.png')));

console.log('Generating NotesGraph launcher icons:');
await Promise.all(jobs);
console.log('Done.');
