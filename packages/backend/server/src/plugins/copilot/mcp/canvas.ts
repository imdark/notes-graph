import { crc32, deflateSync } from 'node:zlib';

import * as Y from 'yjs';

/**
 * Reading a doc's Edgeless canvas for an agent: what is on it, where, and a
 * picture of it. The server can't recognise handwriting itself, so the scene
 * gives positions and relations (frames, groups, connectors, nearest
 * neighbours) and the PNG gives a multimodal agent the ink to read:
 * handwriting, equations and hand-drawn diagrams.
 *
 * Canvas elements (ink, shapes, connectors, text, groups, mind maps) live in
 * the surface block's boxed `prop:elements` map; frames, notes, LaTeX and
 * edgeless text are blocks with a `prop:xywh`. Ink points are stored relative
 * to the stroke's xywh.
 */

export type Bounds = [x: number, y: number, w: number, h: number];

export type CanvasKind =
  | 'ink'
  | 'highlighter'
  | 'shape'
  | 'text'
  | 'connector'
  | 'group'
  | 'mindmap'
  | 'frame'
  | 'note'
  | 'latex'
  | 'edgeless-text'
  | 'image'
  | 'embed';

export type CanvasElement = {
  id: string;
  kind: CanvasKind;
  bounds: Bounds;
  /** Degrees, clockwise about the centre (ink and shapes). */
  rotate?: number;
  text?: string;
  shape?: string;
  latex?: string;
  /** Connector ends: an element id when attached, else a canvas point. */
  from?: string | [number, number];
  to?: string | [number, number];
  /** Group, mind map and frame members. */
  children?: string[];
  /** Ink geometry, absolute canvas points; not part of the scene output. */
  strokes?: [number, number][][];
  lineWidth?: number;
  /** Connector end points on the canvas; not part of the scene output. */
  ends?: [[number, number], [number, number]];
};

export type InkRegion = {
  id: string;
  bounds: Bounds;
  strokes: number;
  strokeIds: string[];
};

export type Neighbour = {
  id: string;
  kind: CanvasKind;
  label?: string;
  /** Where the neighbour is, seen from the region. */
  direction: 'overlaps' | 'left' | 'right' | 'above' | 'below';
  gap: number;
};

export type CanvasScene = {
  bounds: Bounds | null;
  inkRegions: (InkRegion & {
    frame?: string;
    group?: string;
    near: Neighbour[];
  })[];
  elements: (Omit<CanvasElement, 'strokes' | 'lineWidth' | 'ends'> & {
    frame?: string;
    group?: string;
  })[];
  /** Ink regions and labelled elements, top-to-bottom then left-to-right. */
  readingOrder: string[];
};

const KIND_BY_ELEMENT: Record<string, CanvasKind> = {
  brush: 'ink',
  highlighter: 'highlighter',
  shape: 'shape',
  text: 'text',
  connector: 'connector',
  group: 'group',
  mindmap: 'mindmap',
};

const KIND_BY_BLOCK: Record<string, CanvasKind> = {
  frame: 'frame',
  note: 'note',
  latex: 'latex',
  'edgeless-text': 'edgeless-text',
  image: 'image',
};

/** Ink strokes this close (canvas units) belong to one region. */
export const INK_REGION_GAP = 40;
const NEAR_LIMIT = 3;
const BLOCK_TEXT_CHARS = 200;

function parseXYWH(value: unknown): Bounds | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every(n => typeof n === 'number' && Number.isFinite(n))
    ) {
      return parsed as Bounds;
    }
  } catch {
    // not an xywh
  }
  return null;
}

function plain(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.toJSON() : value;
}

function textOf(value: unknown): string | undefined {
  const text =
    value instanceof Y.Text
      ? value.toString()
      : typeof value === 'string'
        ? value
        : undefined;
  return text?.trim() ? text.trim() : undefined;
}

function idsOf(value: unknown): string[] {
  const object = plain(value);
  if (!object || typeof object !== 'object') return [];
  return Object.keys(object as Record<string, unknown>);
}

function flavourName(flavour: unknown): string {
  return typeof flavour === 'string'
    ? flavour.slice(flavour.indexOf(':') + 1)
    : '';
}

function rotatePoint(
  [x, y]: [number, number],
  [cx, cy]: [number, number],
  degrees: number
): [number, number] {
  if (!degrees) return [x, y];
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function centre([x, y, w, h]: Bounds): [number, number] {
  return [x + w / 2, y + h / 2];
}

function union(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y, w, h] of list) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

function contains([x, y, w, h]: Bounds, [px, py]: [number, number]) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function round(bounds: Bounds): Bounds {
  return bounds.map(n => Math.round(n)) as Bounds;
}

/** The ink strokes of a brush element, as absolute canvas points. */
function inkStrokes(
  points: unknown,
  bounds: Bounds,
  rotate: number
): [number, number][] {
  if (!Array.isArray(points)) return [];
  const mid = centre(bounds);
  return points
    .filter(
      (p): p is number[] =>
        Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
    )
    .map(p => rotatePoint([bounds[0] + p[0], bounds[1] + p[1]], mid, rotate));
}

/** Plain text of a block and its descendants, cut to a preview. */
function blockText(
  blocks: Y.Map<Y.Map<unknown>>,
  id: string,
  out: string[] = []
): string[] {
  const block = blocks.get(id);
  if (!(block instanceof Y.Map)) return out;
  const text = textOf(block.get('prop:text'));
  if (text) out.push(text);
  const latex = block.get('prop:latex');
  if (typeof latex === 'string' && latex.trim())
    out.push(`$$${latex.trim()}$$`);
  const children = block.get('sys:children');
  if (children instanceof Y.Array) {
    for (const child of children.toArray()) {
      if (typeof child === 'string') blockText(blocks, child, out);
    }
  }
  return out;
}

function preview(parts: string[]): string | undefined {
  const text = parts.join('\n').trim();
  if (!text) return undefined;
  return text.length > BLOCK_TEXT_CHARS
    ? `${text.slice(0, BLOCK_TEXT_CHARS)}…`
    : text;
}

/** Every element and canvas block of a doc's Edgeless canvas. */
export function readCanvasElements(bin: Uint8Array): CanvasElement[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const elements: CanvasElement[] = [];
  const pending: { element: CanvasElement; raw: Map<string, unknown> }[] = [];

  blocks.forEach((block, id) => {
    if (!(block instanceof Y.Map)) return;
    const name = flavourName(block.get('sys:flavour'));
    if (name === 'surface') {
      const boxed = block.get('prop:elements');
      const map = boxed instanceof Y.Map ? boxed.get('value') : undefined;
      if (!(map instanceof Y.Map)) return;
      map.forEach((value, elementId) => {
        if (!(value instanceof Y.Map)) return;
        const raw = new Map<string, unknown>(value.entries());
        const kind = KIND_BY_ELEMENT[String(raw.get('type'))];
        if (!kind) return;
        const element: CanvasElement = {
          id: String(raw.get('id') ?? elementId),
          kind,
          bounds: parseXYWH(raw.get('xywh')) ?? [0, 0, 0, 0],
        };
        const rotate = Number(raw.get('rotate')) || 0;
        if (rotate && (kind === 'ink' || kind === 'shape' || kind === 'text')) {
          element.rotate = rotate;
        }
        if (kind === 'ink' || kind === 'highlighter') {
          element.strokes = [
            inkStrokes(plain(raw.get('points')), element.bounds, rotate),
          ];
          element.lineWidth = Number(raw.get('lineWidth')) || 4;
        }
        if (kind === 'shape') {
          element.shape = String(raw.get('shapeType') ?? 'rect');
        }
        const text = textOf(raw.get('text')) ?? textOf(raw.get('title'));
        if (text) element.text = text;
        if (kind === 'group') element.children = idsOf(raw.get('children'));
        if (kind === 'mindmap') element.children = idsOf(raw.get('children'));
        pending.push({ element, raw });
        elements.push(element);
      });
      return;
    }
    const kind = name.startsWith('embed') ? 'embed' : KIND_BY_BLOCK[name];
    const bounds = parseXYWH(block.get('prop:xywh'));
    if (!kind || !bounds) return;
    // A note shown only in page mode isn't on the canvas.
    if (kind === 'note' && block.get('prop:displayMode') === 'doc') return;
    const element: CanvasElement = { id, kind, bounds };
    if (kind === 'frame') {
      const title = textOf(block.get('prop:title'));
      if (title) element.text = title;
      element.children = idsOf(block.get('prop:childElementIds'));
    } else if (kind === 'latex') {
      const latex = block.get('prop:latex');
      if (typeof latex === 'string' && latex.trim())
        element.latex = latex.trim();
    } else if (kind === 'note' || kind === 'edgeless-text') {
      const text = preview(blockText(blocks, id));
      if (text) element.text = text;
    } else if (kind === 'image') {
      const caption = textOf(block.get('prop:caption'));
      if (caption) element.text = caption;
    }
    elements.push(element);
  });
  doc.destroy();

  const byId = new Map(elements.map(e => [e.id, e]));
  // Container bounds and connector ends depend on other elements.
  for (const element of elements) {
    if (
      (element.kind === 'group' || element.kind === 'mindmap') &&
      element.bounds.every(n => n === 0)
    ) {
      const members = (element.children ?? [])
        .map(id => byId.get(id)?.bounds)
        .filter((b): b is Bounds => !!b);
      element.bounds = union(members) ?? element.bounds;
    }
  }
  for (const { element, raw } of pending) {
    if (element.kind === 'connector') {
      const end = (value: unknown) => {
        const connection = plain(value) as
          | { id?: string; position?: [number, number] }
          | undefined;
        if (connection?.id) {
          const target = byId.get(connection.id);
          const [x, y, w, h] = target?.bounds ?? [0, 0, 0, 0];
          const [rx, ry] = connection.position ?? [0.5, 0.5];
          return {
            ref: connection.id as string | [number, number],
            point: [x + w * rx, y + h * ry] as [number, number],
          };
        }
        const point = (connection?.position ?? [0, 0]) as [number, number];
        return { ref: point, point };
      };
      const from = end(raw.get('source'));
      const to = end(raw.get('target'));
      element.from = from.ref;
      element.to = to.ref;
      element.ends = [from.point, to.point];
      const [x1, y1] = from.point;
      const [x2, y2] = to.point;
      element.bounds = [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.abs(x2 - x1),
        Math.abs(y2 - y1),
      ];
      const label = textOf(raw.get('text'));
      if (label) element.text = label;
    }
  }
  return elements;
}

/**
 * Groups ink strokes into regions: strokes whose bounds come within `gap` of
 * each other are one region, so a handwritten word, equation or sketch reads
 * as one thing.
 */
export function inkRegions(
  elements: CanvasElement[],
  gap = INK_REGION_GAP
): InkRegion[] {
  const ink = elements
    .filter(e => e.kind === 'ink')
    .sort((a, b) => a.bounds[0] - b.bounds[0]);
  const parent = ink.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < ink.length; i++) {
    const [ax, ay, aw, ah] = ink[i].bounds;
    for (let j = i + 1; j < ink.length; j++) {
      const [bx, by, , bh] = ink[j].bounds;
      if (bx > ax + aw + gap) break;
      if (by <= ay + ah + gap && ay <= by + bh + gap) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, CanvasElement[]>();
  ink.forEach((stroke, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), stroke]);
  });
  const regions = [...groups.values()].map(strokes => ({
    bounds: union(strokes.map(s => s.bounds)) as Bounds,
    strokes: strokes.length,
    strokeIds: strokes.map(s => s.id),
  }));
  return sortReading(regions, r => r.bounds).map((region, i) => ({
    id: `ink-${i + 1}`,
    ...region,
  }));
}

/** Top-to-bottom rows, left-to-right inside a row. */
function sortReading<T>(items: T[], boundsOf: (item: T) => Bounds): T[] {
  const sorted = [...items].sort((a, b) => boundsOf(a)[1] - boundsOf(b)[1]);
  const rows: T[][] = [];
  let rowBottom = -Infinity;
  for (const item of sorted) {
    const [, y, , h] = boundsOf(item);
    const row = rows.at(-1);
    // Same row while it starts above the middle of the row so far.
    if (row && y < rowBottom) {
      row.push(item);
      rowBottom = Math.max(rowBottom, y + h / 2);
    } else {
      rows.push([item]);
      rowBottom = y + h / 2;
    }
  }
  return rows.flatMap(row =>
    row.sort((a, b) => boundsOf(a)[0] - boundsOf(b)[0])
  );
}

function relation(
  [ax, ay, aw, ah]: Bounds,
  [bx, by, bw, bh]: Bounds
): { direction: Neighbour['direction']; gap: number } {
  const dx = Math.max(bx - (ax + aw), ax - (bx + bw), 0);
  const dy = Math.max(by - (ay + ah), ay - (by + bh), 0);
  if (!dx && !dy) return { direction: 'overlaps', gap: 0 };
  if (dx >= dy) {
    return {
      direction: bx >= ax + aw ? 'right' : 'left',
      gap: Math.hypot(dx, dy),
    };
  }
  return {
    direction: by >= ay + ah ? 'below' : 'above',
    gap: Math.hypot(dx, dy),
  };
}

const CONTAINERS: CanvasKind[] = ['frame', 'group', 'mindmap'];

/** The scene an agent reads: regions of ink, the other elements, relations. */
export function buildScene(elements: CanvasElement[]): CanvasScene {
  const regions = inkRegions(elements);
  const frames = elements.filter(e => e.kind === 'frame');
  const groupOf = new Map<string, string>();
  for (const group of elements.filter(e => e.kind === 'group')) {
    for (const child of group.children ?? []) groupOf.set(child, group.id);
  }
  const frameOf = (id: string, bounds: Bounds) => {
    const listed = frames.find(f => f.children?.includes(id));
    if (listed) return listed.id;
    // Frames don't list ink drawn into them; the smallest one around it.
    const around = frames
      .filter(f => f.id !== id && contains(f.bounds, centre(bounds)))
      .sort((a, b) => a.bounds[2] * a.bounds[3] - b.bounds[2] * b.bounds[3]);
    return around[0]?.id;
  };
  const labelled = elements.filter(
    e =>
      e.kind !== 'ink' && e.kind !== 'connector' && !CONTAINERS.includes(e.kind)
  );

  const sceneRegions = regions.map(region => {
    const groups = new Set(region.strokeIds.map(id => groupOf.get(id)));
    const near = labelled
      .map(e => ({ e, ...relation(region.bounds, e.bounds) }))
      .sort((a, b) => a.gap - b.gap)
      .slice(0, NEAR_LIMIT)
      .map(({ e, direction, gap }) => ({
        id: e.id,
        kind: e.kind,
        ...(e.text || e.latex
          ? { label: (e.latex ?? e.text ?? '').slice(0, 80) }
          : {}),
        direction,
        gap: Math.round(gap),
      }));
    const group = groups.size === 1 ? [...groups][0] : undefined;
    const frame = frameOf(region.id, region.bounds);
    return {
      ...region,
      bounds: round(region.bounds),
      ...(frame ? { frame } : {}),
      ...(group ? { group } : {}),
      near,
    };
  });

  const sceneElements = elements
    .filter(e => e.kind !== 'ink')
    .map(({ strokes: _strokes, lineWidth: _lineWidth, ends: _ends, ...e }) => {
      const frame = e.kind === 'frame' ? undefined : frameOf(e.id, e.bounds);
      const group = groupOf.get(e.id);
      return {
        ...e,
        bounds: round(e.bounds),
        ...(e.from && typeof e.from !== 'string'
          ? { from: e.from.map(Math.round) as [number, number] }
          : {}),
        ...(e.to && typeof e.to !== 'string'
          ? { to: e.to.map(Math.round) as [number, number] }
          : {}),
        ...(frame ? { frame } : {}),
        ...(group ? { group } : {}),
      };
    });

  const readingOrder = sortReading(
    [
      ...sceneRegions.map(r => ({ id: r.id, bounds: r.bounds })),
      ...labelled.map(e => ({ id: e.id, bounds: e.bounds })),
    ],
    item => item.bounds
  ).map(item => item.id);

  return {
    bounds: union(
      elements.filter(e => e.kind !== 'group').map(e => e.bounds)
    )?.map(Math.round) as Bounds | null,
    inkRegions: sceneRegions,
    elements: sceneElements,
    readingOrder,
  };
}

// ---------------------------------------------------------------------------
// Drawing: a small anti-aliased rasteriser, so the server needs no native
// image library. Ink is near-black, machine shapes and connectors blue-grey,
// and blocks (notes, text, LaTeX, images, frames) a faint outline: the agent
// sees which marks are handwriting.

type Rgb = [number, number, number];

const INK: Rgb = [17, 17, 17];
const HIGHLIGHT: Rgb = [250, 204, 21];
const SHAPE: Rgb = [59, 94, 150];
const CONNECTOR: Rgb = [110, 110, 110];
const BLOCK: Rgb = [190, 190, 190];

export const MAX_IMAGE_SIDE = 1568;
const MAX_ZOOM = 4;
const PADDING = 16;

export type CanvasImage = {
  png: Buffer;
  width: number;
  height: number;
  /** The canvas area drawn; canvas (x, y) is pixel ((x - region.x) * scale, …). */
  region: Bounds;
  scale: number;
};

class Raster {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.pixels = new Uint8Array(width * height * 3).fill(255);
  }

  /** One polyline, its coverage taken per pixel once so joints don't darken. */
  stroke(points: [number, number][], width: number, color: Rgb, alpha = 1) {
    if (!points.length) return;
    const half = Math.max(width, 1) / 2;
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - half - 1));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - half - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(Math.max(...xs) + half + 1));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys) + half + 1));
    if (x1 < x0 || y1 < y0) return;
    const cw = x1 - x0 + 1;
    const coverage = new Float32Array(cw * (y1 - y0 + 1));
    const segments = points.length === 1 ? [[points[0], points[0]]] : [];
    for (let i = 1; i < points.length; i++) {
      segments.push([points[i - 1], points[i]]);
    }
    for (const [[ax, ay], [bx, by]] of segments) {
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - half - 1));
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - half - 1));
      const sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + half + 1));
      const sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + half + 1));
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      for (let y = sy0; y <= sy1; y++) {
        for (let x = sx0; x <= sx1; x++) {
          const px = x + 0.5 - ax;
          const py = y + 0.5 - ay;
          const t = length2
            ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2))
            : 0;
          const d = Math.hypot(px - t * dx, py - t * dy);
          const c = Math.min(1, Math.max(0, half + 0.5 - d));
          const k = (y - y0) * cw + (x - x0);
          if (c > coverage[k]) coverage[k] = c;
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = coverage[(y - y0) * cw + (x - x0)] * alpha;
        if (!a) continue;
        const p = (y * this.width + x) * 3;
        for (let c = 0; c < 3; c++) {
          this.pixels[p + c] = Math.round(
            this.pixels[p + c] * (1 - a) + color[c] * a
          );
        }
      }
    }
  }

  png(): Buffer {
    const row = this.width * 3 + 1;
    const raw = Buffer.alloc(row * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * row] = 0;
      raw.set(
        this.pixels.subarray(y * this.width * 3, (y + 1) * this.width * 3),
        y * row + 1
      );
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function outline(element: CanvasElement): [number, number][] {
  const [x, y, w, h] = element.bounds;
  let points: [number, number][];
  switch (element.shape) {
    case 'ellipse':
      points = Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return [
          x + w / 2 + (w / 2) * Math.cos(a),
          y + h / 2 + (h / 2) * Math.sin(a),
        ];
      });
      break;
    case 'diamond':
      points = [
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
        [x + w / 2, y],
      ];
      break;
    case 'triangle':
      points = [
        [x + w / 2, y],
        [x + w, y + h],
        [x, y + h],
        [x + w / 2, y],
      ];
      break;
    default:
      points = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ];
  }
  const mid = centre(element.bounds);
  return points.map(p => rotatePoint(p, mid, element.rotate ?? 0));
}

/**
 * Draws the canvas, or the part of it inside `region`, as a PNG whose long
 * side is at most `maxSide` pixels. Small regions are zoomed in (up to 4×)
 * so handwriting stays legible.
 */
export function renderCanvas(
  elements: CanvasElement[],
  region?: Bounds,
  maxSide = MAX_IMAGE_SIDE
): CanvasImage | null {
  const drawn = elements.filter(
    e => e.kind !== 'group' && e.kind !== 'mindmap'
  );
  const area = region ?? union(drawn.map(e => e.bounds));
  if (!area) return null;
  const [rx, ry, rw, rh] = [
    area[0] - PADDING,
    area[1] - PADDING,
    area[2] + PADDING * 2,
    area[3] + PADDING * 2,
  ];
  const scale = Math.min(MAX_ZOOM, maxSide / Math.max(rw, rh, 1));
  const width = Math.max(1, Math.round(rw * scale));
  const height = Math.max(1, Math.round(rh * scale));
  const raster = new Raster(width, height);
  const toPx = ([x, y]: [number, number]): [number, number] => [
    (x - rx) * scale,
    (y - ry) * scale,
  ];
  const order: CanvasKind[] = [
    'frame',
    'note',
    'edgeless-text',
    'latex',
    'image',
    'embed',
    'text',
    'highlighter',
    'shape',
    'connector',
    'ink',
  ];
  for (const kind of order) {
    for (const element of drawn.filter(e => e.kind === kind)) {
      switch (kind) {
        case 'ink':
        case 'highlighter':
          for (const stroke of element.strokes ?? []) {
            raster.stroke(
              stroke.map(toPx),
              (element.lineWidth ?? 4) * scale,
              kind === 'ink' ? INK : HIGHLIGHT,
              kind === 'ink' ? 1 : 0.4
            );
          }
          break;
        case 'shape':
          raster.stroke(
            outline(element).map(toPx),
            Math.max(1.5, 2 * scale),
            SHAPE
          );
          break;
        case 'connector': {
          if (!element.ends) break;
          const [from, to] = element.ends.map(toPx);
          raster.stroke([from, to], Math.max(1.5, 2 * scale), CONNECTOR);
          // Arrow head at the target end.
          const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
          const size = Math.max(8, 12 * scale);
          for (const side of [-1, 1]) {
            const a = angle + Math.PI + (side * Math.PI) / 7;
            raster.stroke(
              [to, [to[0] + size * Math.cos(a), to[1] + size * Math.sin(a)]],
              Math.max(1.5, 2 * scale),
              CONNECTOR
            );
          }
          break;
        }
        default:
          raster.stroke(
            outline({ ...element, shape: 'rect' }).map(toPx),
            1,
            BLOCK
          );
      }
    }
  }
  return {
    png: raster.png(),
    width,
    height,
    region: round([rx, ry, rw, rh]),
    scale: Math.round(scale * 1000) / 1000,
  };
}
