import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

/**
 * The doc's canvas (its edgeless surface) for agents: what is on it, a
 * picture of all of it or of one region, and drawing on it — freehand ink,
 * shapes, text and connectors.
 *
 * Read and written straight from the doc's CRDT with plain yjs, as
 * blocksuite-headless.ts does, so the server needs no blocksuite at runtime.
 * The surface block keeps its elements boxed: `prop:elements` is a Y.Map
 * `{ type: '$blocksuite:internal:native$', value: Y.Map<id, Y.Map> }`, and
 * each element is a Y.Map of its `@field` props (blocksuite/notesgraph/model
 * /src/elements). Brush points are stored relative to the element's xywh.
 * Blocks placed on the canvas (notes, images, frames) carry `prop:xywh`.
 */

const SURFACE_FLAVOUR = 'notesgraph:surface';
const NATIVE_BOX = '$blocksuite:internal:native$';
const FONT_INTER = 'blocksuite:surface:Inter';
const DEFAULT_ROUGHNESS = 1.4;
/** TextResizing.AUTO_HEIGHT */
const AUTO_HEIGHT = 1;
/** ConnectorMode.Straight */
const STRAIGHT = 0;

export type Region = { x: number; y: number; w: number; h: number };

export type CanvasItem = {
  id: string;
  /** Element type (brush, shape, text, connector…) or block flavour (note, image…). */
  type: string;
  kind: 'element' | 'block';
  x: number;
  y: number;
  w: number;
  h: number;
  index: string;
  text?: string;
  shapeType?: string;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  fontSize?: number;
  /** Absolute points, for brush and highlighter strokes. */
  points?: number[][];
  source?: Connection;
  target?: Connection;
};

type Connection = { id?: string; position?: [number, number] };

type Point = [number, number] | [number, number, number];

export type DrawItem =
  | {
      type: 'stroke';
      key?: string;
      points: Point[];
      color?: string;
      width?: number;
    }
  | {
      type: 'shape';
      key?: string;
      shape?: 'rect' | 'ellipse' | 'diamond' | 'triangle';
      x: number;
      y: number;
      w: number;
      h: number;
      text?: string;
      color?: string;
      fill?: string;
    }
  | {
      type: 'text';
      key?: string;
      x: number;
      y: number;
      text: string;
      fontSize?: number;
      color?: string;
    }
  | {
      type: 'connector';
      key?: string;
      from: string | [number, number];
      to: string | [number, number];
      color?: string;
    };

export class CanvasError extends Error {}

function parseXYWH(value: unknown): [number, number, number, number] | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every(n => typeof n === 'number' && Number.isFinite(n))
    ) {
      return parsed as [number, number, number, number];
    }
  } catch {
    // fall through
  }
  return null;
}

/** A stored colour as something SVG can paint, or undefined. */
function paint(value: unknown): string | undefined {
  if (typeof value === 'string') {
    // Older docs store theme CSS variables, which only the app can resolve.
    return value.startsWith('--') || value.startsWith('var(')
      ? undefined
      : value;
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return paint(v.normal ?? v.light);
  }
  return;
}

function textOf(value: unknown): string | undefined {
  if (value instanceof Y.Text) return value.toString();
  if (typeof value === 'string') return value;
  return;
}

function loadDoc(binary: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  return doc;
}

function surfaceElements(doc: Y.Doc): Y.Map<Y.Map<unknown>> | null {
  let elements: Y.Map<Y.Map<unknown>> | null = null;
  doc.getMap<Y.Map<unknown>>('blocks').forEach(block => {
    if (!(block instanceof Y.Map)) return;
    if (block.get('sys:flavour') !== SURFACE_FLAVOUR) return;
    const boxed = block.get('prop:elements');
    if (boxed instanceof Y.Map && boxed.get('type') === NATIVE_BOX) {
      const value = boxed.get('value');
      if (value instanceof Y.Map) elements = value as Y.Map<Y.Map<unknown>>;
    }
  });
  return elements;
}

/** The text under a block, its descendants' included, cut at `max` chars. */
function blockText(
  blocks: Y.Map<Y.Map<unknown>>,
  block: Y.Map<unknown>,
  max = 400
): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (node: Y.Map<unknown>, depth: number) => {
    if (length >= max || depth > 20) return;
    const text =
      textOf(node.get('prop:text')) ?? textOf(node.get('prop:title'));
    if (text?.trim()) {
      parts.push(text.trim());
      length += text.length;
    }
    const children = node.get('sys:children');
    if (children instanceof Y.Array) {
      for (const id of children.toArray()) {
        const child = blocks.get(id as string);
        if (child instanceof Y.Map) walk(child, depth + 1);
      }
    }
  };
  walk(block, 0);
  const joined = parts.join('\n');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/** Everything on the doc's canvas, back to front. */
export function readCanvas(binary: Uint8Array): {
  hasSurface: boolean;
  items: CanvasItem[];
} {
  const doc = loadDoc(binary);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const elements = surfaceElements(doc);
  const items: CanvasItem[] = [];

  elements?.forEach((el, id) => {
    if (!(el instanceof Y.Map)) return;
    const type = String(el.get('type') ?? 'unknown');
    const xywh = parseXYWH(el.get('xywh'));
    const item: CanvasItem = {
      id,
      type,
      kind: 'element',
      x: xywh?.[0] ?? 0,
      y: xywh?.[1] ?? 0,
      w: xywh?.[2] ?? 0,
      h: xywh?.[3] ?? 0,
      index: String(el.get('index') ?? ''),
    };
    const text = textOf(el.get('text'));
    if (text) item.text = text;
    switch (type) {
      case 'brush':
      case 'highlighter': {
        item.color = paint(el.get('color'));
        item.strokeWidth = Number(el.get('lineWidth') ?? 4);
        const points = el.get('points');
        if (Array.isArray(points)) {
          item.points = points
            .filter(p => Array.isArray(p) && p.length >= 2)
            .map(([px, py]) => [item.x + px, item.y + py]);
        }
        break;
      }
      case 'shape':
        item.shapeType = String(el.get('shapeType') ?? 'rect');
        item.color = paint(el.get('strokeColor'));
        item.strokeWidth = Number(el.get('strokeWidth') ?? 4);
        if (el.get('filled')) item.fill = paint(el.get('fillColor'));
        break;
      case 'text':
        item.color = paint(el.get('color'));
        item.fontSize = Number(el.get('fontSize') ?? 16);
        break;
      case 'connector': {
        item.color = paint(el.get('stroke'));
        item.strokeWidth = Number(el.get('strokeWidth') ?? 4);
        item.source = el.get('source') as Connection | undefined;
        item.target = el.get('target') as Connection | undefined;
        const label = textOf(el.get('text'));
        if (label) item.text = label;
        break;
      }
    }
    items.push(item);
  });

  blocks.forEach((block, id) => {
    if (!(block instanceof Y.Map)) return;
    const xywh = parseXYWH(block.get('prop:xywh'));
    if (!xywh) return;
    const flavour = String(block.get('sys:flavour') ?? '');
    const item: CanvasItem = {
      id,
      type: flavour.replace(/^notesgraph:/, ''),
      kind: 'block',
      x: xywh[0],
      y: xywh[1],
      w: xywh[2],
      h: xywh[3],
      index: String(block.get('prop:index') ?? ''),
    };
    const text = blockText(blocks, block);
    if (text) item.text = text;
    items.push(item);
  });

  items.sort((a, b) =>
    a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1
  );
  return { hasSurface: elements !== null, items };
}

export function intersects(item: CanvasItem, region: Region): boolean {
  return (
    item.x <= region.x + region.w &&
    item.x + item.w >= region.x &&
    item.y <= region.y + region.h &&
    item.y + item.h >= region.y
  );
}

/** What an agent reads about an item: its geometry and text, not its ink. */
export function describeItem(item: CanvasItem) {
  const { points, index: _index, ...rest } = item;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...rest,
    x: round(item.x),
    y: round(item.y),
    w: round(item.w),
    h: round(item.h),
    ...(points ? { pointCount: points.length } : {}),
  };
}

/** The box around some items, padded, or null when there are none. */
export function boundsOf(items: CanvasItem[], pad = 40): Region | null {
  if (!items.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const item of items) {
    x0 = Math.min(x0, item.x);
    y0 = Math.min(y0, item.y);
    x1 = Math.max(x1, item.x + item.w);
    y1 = Math.max(y1, item.y + item.h);
  }
  return {
    x: x0 - pad,
    y: y0 - pad,
    w: x1 - x0 + 2 * pad,
    h: y1 - y0 + 2 * pad,
  };
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textLines(
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  anchor: 'start' | 'middle' = 'start',
  maxLines = 12
): string {
  const lines = text.split('\n').slice(0, maxLines);
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : size * 1.25}">${esc(line.slice(0, 120))}</tspan>`
    )
    .join('');
  return `<text x="${x}" y="${y}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${tspans}</text>`;
}

function center(item: CanvasItem): [number, number] {
  return [item.x + item.w / 2, item.y + item.h / 2];
}

function endpoint(
  connection: Connection | undefined,
  byId: Map<string, CanvasItem>
): [number, number] | null {
  if (!connection) return null;
  if (connection.id) {
    const item = byId.get(connection.id);
    if (!item) return null;
    // With an id, position is an anchor relative to the element's box.
    if (connection.position) {
      return [
        item.x + connection.position[0] * item.w,
        item.y + connection.position[1] * item.h,
      ];
    }
    return center(item);
  }
  return connection.position ?? null;
}

/** Where the line from `inside` toward `toward` leaves the box. */
function boxEdge(
  box: CanvasItem,
  inside: [number, number],
  toward: [number, number]
): [number, number] {
  const dx = toward[0] - inside[0];
  const dy = toward[1] - inside[1];
  const tx = dx
    ? (dx > 0 ? box.x + box.w - inside[0] : box.x - inside[0]) / dx
    : Infinity;
  const ty = dy
    ? (dy > 0 ? box.y + box.h - inside[1] : box.y - inside[1]) / dy
    : Infinity;
  const t = Math.min(1, tx, ty);
  return [inside[0] + dx * t, inside[1] + dy * t];
}

function renderItem(item: CanvasItem, byId: Map<string, CanvasItem>): string {
  const stroke = item.color ?? '#1e1e1e';
  switch (item.type) {
    case 'brush':
    case 'highlighter': {
      if (!item.points?.length) return '';
      const d = item.points
        .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ');
      const opacity =
        item.type === 'highlighter' ? ' stroke-opacity="0.4"' : '';
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${item.strokeWidth ?? 4}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
    }
    case 'shape': {
      const { x, y, w, h } = item;
      const fill = item.fill ?? 'none';
      const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${item.strokeWidth ?? 4}"`;
      let shape: string;
      switch (item.shapeType) {
        case 'ellipse':
          shape = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
          break;
        case 'diamond':
          shape = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`;
          break;
        case 'triangle':
          shape = `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${attrs}/>`;
          break;
        default:
          shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`;
      }
      const label = item.text
        ? textLines(x + w / 2, y + h / 2 + 6, item.text, 20, stroke, 'middle')
        : '';
      return shape + label;
    }
    case 'text': {
      const size = item.fontSize ?? 16;
      return textLines(item.x, item.y + size, item.text ?? '', size, stroke);
    }
    case 'connector': {
      let from = endpoint(item.source, byId);
      let to = endpoint(item.target, byId);
      if (!from || !to) return '';
      // An end attached to an element stops at its box, not its centre.
      const fromBox = item.source?.id ? byId.get(item.source.id) : undefined;
      const toBox = item.target?.id ? byId.get(item.target.id) : undefined;
      const start = from;
      if (fromBox && !item.source?.position) from = boxEdge(fromBox, from, to);
      if (toBox && !item.target?.position) to = boxEdge(toBox, to, start);
      const line = `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="${stroke}" stroke-width="${item.strokeWidth ?? 4}" marker-end="url(#arrow)"/>`;
      const label = item.text
        ? textLines(
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
            item.text,
            16,
            stroke,
            'middle'
          )
        : '';
      return line + label;
    }
    case 'group':
    case 'mindmap':
      return '';
    default: {
      // A block on the canvas (note, image, frame…): its box and some text.
      const { x, y, w, h } = item;
      const frame = item.type === 'frame';
      const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${frame ? 'none' : '#fafafa'}" stroke="#c8c8c8" stroke-width="2"${frame ? ' stroke-dasharray="8 6"' : ''}/>`;
      const label = item.text ?? (item.type === 'image' ? '[image]' : '');
      const lines = Math.max(1, Math.floor((h - 16) / 20));
      return (
        box +
        (label
          ? textLines(
              x + 12,
              y + 26,
              label,
              16,
              '#333333',
              'start',
              frame ? 1 : lines
            )
          : '')
      );
    }
  }
}

/**
 * The canvas as SVG: everything, or the items touching `region`, drawn at
 * most `maxSize` pixels on its longer side.
 */
export function canvasSvg(
  items: CanvasItem[],
  region?: Region,
  maxSize = 1600
): { svg: string; region: Region; width: number; height: number } {
  const shown = region ? items.filter(item => intersects(item, region)) : items;
  const view = region ?? boundsOf(shown) ?? { x: 0, y: 0, w: 800, h: 600 };
  const scale = Math.min(1, maxSize / Math.max(view.w, view.h));
  const width = Math.max(1, Math.round(view.w * scale));
  const height = Math.max(1, Math.round(view.h * scale));
  const byId = new Map(items.map(item => [item.id, item]));
  const body = shown.map(item => renderItem(item, byId)).join('\n');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}">`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>',
    `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="#ffffff"/>`,
    body,
    '</svg>',
  ].join('\n');
  return { svg, region: view, width, height };
}

// @resvg/resvg-js is a native module the server does not depend on directly;
// it is loaded lazily, as link-card does, and when it is missing a capture
// comes back as SVG instead of PNG.
let resvgPromise: Promise<ResvgCtor | null> | undefined;
type ResvgCtor = new (
  svg: string,
  options?: Record<string, unknown>
) => { render(): { asPng(): Uint8Array } };

function loadResvg(): Promise<ResvgCtor | null> {
  if (!resvgPromise) {
    const name = '@resvg/resvg-js';
    resvgPromise = import(name)
      .then(
        mod => (mod.Resvg ?? mod.default?.Resvg ?? null) as ResvgCtor | null
      )
      .catch(() => null);
  }
  return resvgPromise;
}

/** The SVG as PNG, or null when no rasteriser is available. */
export async function svgToPng(svg: string): Promise<Buffer | null> {
  const Resvg = await loadResvg();
  if (!Resvg) return null;
  try {
    const png = new Resvg(svg, {
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    })
      .render()
      .asPng();
    return Buffer.from(png);
  } catch {
    return null;
  }
}

function seed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function nextIndex(after: string | null): string {
  try {
    return generateKeyBetween(after, null);
  } catch {
    // An index fractional-indexing can't read; start a fresh run on top.
    return generateKeyBetween(null, null) + 'z';
  }
}

function strokeElement(
  item: Extract<DrawItem, { type: 'stroke' }>,
  props: Y.Map<unknown>
) {
  const width = item.width ?? 4;
  const xs = item.points.map(p => p[0]);
  const ys = item.points.map(p => p[1]);
  // Same as BrushElementModel: the points' box grown by the line width,
  // with points stored relative to it.
  const x = Math.min(...xs) - width / 2;
  const y = Math.min(...ys) - width / 2;
  const w = Math.max(...xs) - Math.min(...xs) + width;
  const h = Math.max(...ys) - Math.min(...ys) + width;
  props.set('type', 'brush');
  props.set('color', item.color ?? '#1e1e1e');
  props.set('lineWidth', width);
  props.set(
    'points',
    item.points.map(([px, py, pressure]) =>
      pressure === undefined ? [px - x, py - y] : [px - x, py - y, pressure]
    )
  );
  props.set('rotate', 0);
  props.set('xywh', JSON.stringify([x, y, w, h]));
}

function shapeElement(
  item: Extract<DrawItem, { type: 'shape' }>,
  props: Y.Map<unknown>
) {
  props.set('type', 'shape');
  props.set('shapeType', item.shape ?? 'rect');
  props.set('shapeStyle', 'General');
  props.set('xywh', JSON.stringify([item.x, item.y, item.w, item.h]));
  props.set('strokeColor', item.color ?? '#1e1e1e');
  props.set('strokeWidth', 2);
  props.set('strokeStyle', 'solid');
  props.set('filled', item.fill !== undefined);
  props.set('fillColor', item.fill ?? '#ffffff');
  props.set('radius', 0);
  props.set('rotate', 0);
  props.set('roughness', DEFAULT_ROUGHNESS);
  props.set('shadow', null);
  props.set('color', item.color ?? '#1e1e1e');
  props.set('fontFamily', FONT_INTER);
  props.set('fontSize', 20);
  props.set('textAlign', 'center');
  props.set('textHorizontalAlign', 'center');
  props.set('textVerticalAlign', 'center');
  props.set('textResizing', AUTO_HEIGHT);
  if (item.text) props.set('text', new Y.Text(item.text));
}

function textElement(
  item: Extract<DrawItem, { type: 'text' }>,
  props: Y.Map<unknown>
) {
  const size = item.fontSize ?? 24;
  const lines = item.text.split('\n');
  const longest = Math.max(...lines.map(line => line.length));
  props.set('type', 'text');
  props.set(
    'xywh',
    JSON.stringify([
      item.x,
      item.y,
      Math.max(16, Math.ceil(longest * size * 0.6)),
      Math.ceil(lines.length * size * 1.4),
    ])
  );
  props.set('text', new Y.Text(item.text));
  props.set('color', item.color ?? '#1e1e1e');
  props.set('fontFamily', FONT_INTER);
  props.set('fontSize', size);
  props.set('fontStyle', 'normal');
  props.set('fontWeight', '400');
  props.set('textAlign', 'left');
  props.set('hasMaxWidth', false);
  props.set('rotate', 0);
}

/**
 * Adds `items` on top of the doc's canvas and returns the update to push
 * plus the new elements' ids. A connector end is an [x, y] point, an
 * existing element id, or the `key` of an item drawn earlier in the call.
 */
export function drawOnCanvas(
  binary: Uint8Array,
  items: DrawItem[]
): { update: Uint8Array | null; ids: string[] } {
  const doc = loadDoc(binary);
  const elements = surfaceElements(doc);
  if (!elements) {
    throw new CanvasError(
      'This document has no canvas (no surface block); open it in edgeless mode once in the app, then try again.'
    );
  }
  const { items: existing } = readCanvas(binary);
  const byId = new Map(existing.map(item => [item.id, item]));
  let index = existing.reduce<string | null>(
    (max, item) =>
      item.index && (!max || item.index > max) ? item.index : max,
    null
  );

  const before = Y.encodeStateVector(doc);
  const ids: string[] = [];
  const keys = new Map<string, string>();
  const boxes = new Map<string, Region>();

  const resolveEnd = (
    end: string | [number, number]
  ): { connection: Connection; at: [number, number] } => {
    if (Array.isArray(end)) return { connection: { position: end }, at: end };
    const id = keys.get(end) ?? end;
    const box = boxes.get(id) ?? byId.get(id);
    if (!box) {
      throw new CanvasError(
        `Connector end "${end}" is not an element on this canvas or a key drawn earlier in this call.`
      );
    }
    return {
      connection: { id },
      at: [box.x + box.w / 2, box.y + box.h / 2],
    };
  };

  doc.transact(() => {
    for (const item of items) {
      const id = nanoid();
      const props = new Y.Map<unknown>();
      // Attach first so Y.Text values are integrated with the doc.
      elements.set(id, props);
      props.set('id', id);
      index = nextIndex(index);
      props.set('index', index);
      props.set('seed', seed());
      switch (item.type) {
        case 'stroke':
          strokeElement(item, props);
          break;
        case 'shape':
          shapeElement(item, props);
          break;
        case 'text':
          textElement(item, props);
          break;
        case 'connector': {
          const from = resolveEnd(item.from);
          const to = resolveEnd(item.to);
          const x = Math.min(from.at[0], to.at[0]);
          const y = Math.min(from.at[1], to.at[1]);
          props.set('type', 'connector');
          props.set('mode', STRAIGHT);
          props.set('source', from.connection);
          props.set('target', to.connection);
          props.set('stroke', item.color ?? '#1e1e1e');
          props.set('strokeWidth', 2);
          props.set('strokeStyle', 'solid');
          props.set('roughness', DEFAULT_ROUGHNESS);
          props.set('frontEndpointStyle', 'None');
          props.set('rearEndpointStyle', 'Arrow');
          props.set(
            'xywh',
            JSON.stringify([
              x,
              y,
              Math.abs(from.at[0] - to.at[0]),
              Math.abs(from.at[1] - to.at[1]),
            ])
          );
          break;
        }
      }
      const xywh = parseXYWH(props.get('xywh'));
      if (xywh)
        boxes.set(id, { x: xywh[0], y: xywh[1], w: xywh[2], h: xywh[3] });
      if (item.key) keys.set(item.key, id);
      ids.push(id);
    }
  });

  return {
    update: ids.length ? Y.encodeStateAsUpdate(doc, before) : null,
    ids,
  };
}
