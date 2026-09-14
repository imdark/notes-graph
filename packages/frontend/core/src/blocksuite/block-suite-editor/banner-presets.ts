/**
 * Bundled high-quality default banners, shared across all notes.
 *
 * These are hand-authored abstract "mesh gradient" banners — a handful of
 * softly-blurred colour blobs over a dark base — authored as SVG so they stay a
 * couple of KB each and render crisp at any width (the banner is a wide
 * 1152×384 strip). A preset is applied by turning its SVG into a Blob and
 * running it through the same store-and-set path as an uploaded/AI banner.
 */

interface MeshBlob {
  x: number;
  y: number;
  r: number;
  color: string;
}

const BANNER_W = 1152;
const BANNER_H = 384;

/** Build a mesh-gradient banner SVG string from a base colour + colour blobs. */
const mesh = (bg: string, blobs: MeshBlob[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BANNER_W} ${BANNER_H}" ` +
  `preserveAspectRatio="xMidYMid slice">` +
  `<defs>` +
  `<filter id="mb" x="-40%" y="-40%" width="180%" height="180%">` +
  `<feGaussianBlur stdDeviation="95"/>` +
  `</filter>` +
  `<filter id="grain">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>` +
  `<feColorMatrix type="saturate" values="0"/>` +
  `</filter>` +
  `</defs>` +
  `<rect width="${BANNER_W}" height="${BANNER_H}" fill="${bg}"/>` +
  `<g filter="url(#mb)">` +
  blobs
    .map(b => `<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="${b.color}"/>`)
    .join('') +
  `</g>` +
  // a whisper of monochrome grain for a less "flat" finish
  `<rect width="${BANNER_W}" height="${BANNER_H}" filter="url(#grain)" opacity="0.04"/>` +
  `</svg>`;

export interface BannerPreset {
  id: string;
  name: string;
  svg: string;
}

export const BANNER_PRESETS: BannerPreset[] = [
  {
    id: 'sunset',
    name: 'Sunset',
    svg: mesh('#2a1a3e', [
      { x: 200, y: 120, r: 260, color: '#ff6b6b' },
      { x: 520, y: 300, r: 240, color: '#ffa94d' },
      { x: 950, y: 150, r: 280, color: '#cc5de8' },
    ]),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    svg: mesh('#0b1e3a', [
      { x: 250, y: 300, r: 280, color: '#4dabf7' },
      { x: 700, y: 120, r: 260, color: '#22b8cf' },
      { x: 1000, y: 320, r: 240, color: '#3bc9db' },
    ]),
  },
  {
    id: 'forest',
    name: 'Forest',
    svg: mesh('#0d1f14', [
      { x: 200, y: 280, r: 260, color: '#51cf66' },
      { x: 600, y: 120, r: 260, color: '#20c997' },
      { x: 1000, y: 300, r: 240, color: '#94d82d' },
    ]),
  },
  {
    id: 'dusk',
    name: 'Dusk',
    svg: mesh('#1a1030', [
      { x: 250, y: 150, r: 280, color: '#845ef7' },
      { x: 650, y: 300, r: 260, color: '#e64980' },
      { x: 1000, y: 130, r: 260, color: '#5c7cfa' },
    ]),
  },
  {
    id: 'ember',
    name: 'Ember',
    svg: mesh('#1a0d0d', [
      { x: 200, y: 300, r: 260, color: '#ff922b' },
      { x: 600, y: 150, r: 260, color: '#ff6b6b' },
      { x: 1000, y: 320, r: 240, color: '#f03e3e' },
    ]),
  },
  {
    id: 'aurora',
    name: 'Aurora',
    svg: mesh('#071a1a', [
      { x: 250, y: 300, r: 280, color: '#63e6be' },
      { x: 650, y: 140, r: 270, color: '#4dabf7' },
      { x: 1000, y: 300, r: 250, color: '#b197fc' },
    ]),
  },
  {
    id: 'peach',
    name: 'Peach',
    svg: mesh('#2e1f26', [
      { x: 200, y: 150, r: 260, color: '#ffa8a8' },
      { x: 600, y: 300, r: 250, color: '#ffd8a8' },
      { x: 1000, y: 140, r: 260, color: '#fcc2d7' },
    ]),
  },
  {
    id: 'slate',
    name: 'Slate',
    svg: mesh('#141821', [
      { x: 250, y: 280, r: 300, color: '#495057' },
      { x: 700, y: 140, r: 240, color: '#748ffc' },
      { x: 1000, y: 320, r: 260, color: '#868e96' },
    ]),
  },
  {
    id: 'gold',
    name: 'Gold',
    svg: mesh('#241a0a', [
      { x: 250, y: 150, r: 260, color: '#ffd43b' },
      { x: 650, y: 300, r: 250, color: '#ffa94d' },
      { x: 1000, y: 150, r: 250, color: '#f59f00' },
    ]),
  },
  {
    id: 'berry',
    name: 'Berry',
    svg: mesh('#230f1e', [
      { x: 250, y: 150, r: 270, color: '#f06595' },
      { x: 650, y: 300, r: 260, color: '#cc5de8' },
      { x: 1000, y: 140, r: 260, color: '#e64980' },
    ]),
  },
  {
    id: 'mint',
    name: 'Mint',
    svg: mesh('#0d2420', [
      { x: 250, y: 300, r: 280, color: '#63e6be' },
      { x: 650, y: 130, r: 250, color: '#96f2d7' },
      { x: 1000, y: 320, r: 250, color: '#38d9a9' },
    ]),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    svg: mesh('#0a0a1f', [
      { x: 250, y: 150, r: 280, color: '#5c7cfa' },
      { x: 650, y: 300, r: 270, color: '#7048e8' },
      { x: 1000, y: 140, r: 260, color: '#4263eb' },
    ]),
  },
];

/** A preset's SVG as a data URL, for rendering a thumbnail in the picker. */
export const bannerPresetDataUrl = (preset: BannerPreset): string =>
  `data:image/svg+xml,${encodeURIComponent(preset.svg)}`;

/** A preset's SVG as an image Blob, for storing as the doc's banner. */
export const bannerPresetToBlob = (preset: BannerPreset): Blob =>
  new Blob([preset.svg], { type: 'image/svg+xml' });
