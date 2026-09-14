import { HomeDocService } from '@notesgraph/core/modules/home-doc';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './graph.css';
import type { GraphData, GraphLinkData, GraphNodeData } from './use-graph-data';

interface LayoutNode extends GraphNodeData {
  /** current (animated) position */
  x: number;
  y: number;
  /** target position from the latest layout (animated towards) */
  tx: number;
  ty: number;
  /** off the current page of its parent's children — not laid out or drawn */
  hidden: boolean;
  /** number of tree children (for paging controls) */
  childCount: number;
}

interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  /** Default root→parentless-node link added by the layout (drawn dashed). */
  synthetic?: boolean;
}

interface SyntheticLink {
  source: string;
  target: string;
}

/** Persisted, user-pinned node positions, keyed by docId. */
export type PinnedPositions = Record<string, { x: number; y: number }>;

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface Colors {
  background: string;
  edge: string;
  edgeActive: string;
  node: string;
  nodeDim: string;
  label: string;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/**
 * Wheel-zoom sensitivity. The zoom factor is exp(-delta * this), so zoom is
 * proportional to how far you scroll/pinch rather than a fixed step per event.
 * A macOS trackpad pinch fires many small-delta `wheel` events in quick
 * succession; a fixed per-event factor compounds them into a runaway zoom, so
 * scaling by the actual delta keeps it smooth and controllable.
 */
const ZOOM_SENSITIVITY = 0.0015;
const BASE_RADIUS = 4;
const HIT_PADDING = 4;
/** Distance between successive rings (tree depth levels). */
const LEVEL_RADIUS = 160;
/** Max children shown per node at once; the rest are reachable via ◀ / ▶. */
const NODE_PAGE_SIZE = 12;
/** Screen-space gap (px) from a node edge to its page buttons + their hit area. */
const PAGE_BTN_GAP = 12;
const PAGE_BTN_HIT = 11;
/** Padding (px) around the graph when fitting it to the viewport. */
const FIT_PADDING = 80;
/** Don't zoom in past this when fitting a tiny graph to view. */
const MAX_FIT_ZOOM = 1.6;

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--notesgraph-background-primary-color', '#0e0e14'),
    edge: v('--notesgraph-border-color', '#262633'),
    // Cyan relational edges, violet nodes — the "Synapse" graph language.
    edgeActive: v('--notesgraph-text-emphasis-color', '#22d3ee'),
    node: v('--notesgraph-primary-color', '#7c6cff'),
    nodeDim: v('--notesgraph-text-secondary-color', '#9b9bb0'),
    label: v('--notesgraph-text-primary-color', '#e7e7f2'),
  };
}

function nodeRadius(node: GraphNodeData): number {
  return BASE_RADIUS + Math.min(10, 1.6 * Math.sqrt(node.degree));
}

// Focus the title of the just-opened doc peek so the user can type immediately.
// (The `+` flow only runs from the graph, so the peek's is the only doc-title.)
function focusPeekTitle(attempt = 0) {
  const editable = document.querySelector<HTMLElement>(
    'doc-title [contenteditable="true"]'
  );
  if (editable) {
    editable.focus();
  } else if (attempt < 40) {
    setTimeout(() => focusPeekTitle(attempt + 1), 75);
  }
}

interface TreeNode {
  id: string;
  children: TreeNode[];
  leaves: number;
}

/**
 * Concentric radial-tree layout, in the spirit of mind-link's
 * `drawConcentricCircleTreeSimulationInOrder`: pick the most-connected doc as a
 * root, lay its neighbours out on successive rings (one ring per depth), and
 * give each subtree an angular wedge proportional to its leaf count so siblings
 * don't overlap. Every other parentless node (other component roots + isolated
 * docs) is attached to the root as a default child (returned as synthetic
 * links), so nothing piles up at the origin. Positions are written onto `nodes`.
 */
function computeRadialTreeLayout(
  nodes: LayoutNode[],
  links: GraphLinkData[],
  pinned: PinnedPositions,
  pageIndex: Map<string, number>,
  sortKeys: Map<string, number>,
  preferredRootId: string | null
): {
  synthetic: SyntheticLink[];
  rootId: string | null;
  childrenByParent: Map<string, string[]>;
} {
  const childrenByParent = new Map<string, string[]>();
  if (nodes.length === 0) {
    return { synthetic: [], rootId: null, childrenByParent };
  }

  const byId = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
    degree.set(n.id, 0);
  }
  for (const l of links) {
    if (!byId.has(l.source) || !byId.has(l.target)) continue;
    outgoing.get(l.source)?.push(l.target);
    incoming.get(l.target)?.push(l.source);
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }

  // Neighbours for tree-building: prefer outgoing (references) then incoming,
  // so the tree reads parent → child but every connected node is still reached.
  const neighbours = (id: string): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of outgoing.get(id) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }
    for (const s of incoming.get(id) ?? []) {
      if (!seen.has(s)) {
        seen.add(s);
        result.push(s);
      }
    }
    // Order children by their manual sort key (fractional), falling back to
    // createDate. A new node gets a key that slots it onto the current page.
    const keyOf = (nid: string) =>
      sortKeys.get(nid) ?? byId.get(nid)?.createdAt ?? 0;
    result.sort((a, b) => keyOf(a) - keyOf(b));
    return result;
  };

  const visited = new Set<string>();
  const buildTree = (rootId: string): TreeNode => {
    visited.add(rootId);
    const root: TreeNode = { id: rootId, children: [], leaves: 0 };
    const fill = (node: TreeNode) => {
      for (const nb of neighbours(node.id)) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        const child: TreeNode = { id: nb, children: [], leaves: 0 };
        node.children.push(child);
        fill(child);
      }
      childrenByParent.set(
        node.id,
        node.children.map(c => c.id)
      );
      const self = byId.get(node.id);
      if (self) self.childCount = node.children.length;
      node.leaves = node.children.length
        ? node.children.reduce((sum, c) => sum + c.leaves, 0)
        : 1;
    };
    fill(root);
    return root;
  };

  const roots: TreeNode[] = [];
  // Pin the preferred root (the Home doc) as the center, so every other
  // parentless node attaches beneath it.
  if (
    preferredRootId &&
    byId.has(preferredRootId) &&
    !visited.has(preferredRootId)
  ) {
    roots.push(buildTree(preferredRootId));
  }
  // Highest-degree unvisited node seeds each remaining component.
  const order = [...nodes].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
  );
  for (const n of order) {
    if (!visited.has(n.id)) roots.push(buildTree(n.id));
  }

  const placed = new Set<string>();
  const place = (node: TreeNode, depth: number, a0: number, a1: number) => {
    const mid = (a0 + a1) / 2;
    const r = depth * LEVEL_RADIUS;
    const target = byId.get(node.id);
    if (target) {
      target.x = r * Math.cos(mid);
      target.y = r * Math.sin(mid);
    }
    if (node.id) placed.add(node.id);

    // Only lay out the current page of this node's children; off-page subtrees
    // stay hidden.
    const start = (pageIndex.get(node.id) ?? 0) * NODE_PAGE_SIZE;
    const pageChildren = node.children.slice(start, start + NODE_PAGE_SIZE);
    const pageLeaves = pageChildren.reduce((sum, c) => sum + c.leaves, 0) || 1;
    let a = a0;
    for (const child of pageChildren) {
      const wedge = (a1 - a0) * (child.leaves / pageLeaves);
      place(child, depth + 1, a, a + wedge);
      a += wedge;
    }
  };

  // A single root sits at the center; every other parentless node (other
  // component roots + isolated docs) is attached to it as a default child, so
  // they ring the root instead of piling up at the origin.
  const synthetic: SyntheticLink[] = [];
  let rootId: string | null = null;
  if (roots.length > 0) {
    const main = roots[0];
    rootId = main.id;
    for (let i = 1; i < roots.length; i++) {
      main.children.push(roots[i]);
      synthetic.push({ source: main.id, target: roots[i].id });
    }
    main.leaves = main.children.reduce((sum, c) => sum + c.leaves, 0) || 1;
    const mainSelf = byId.get(main.id);
    if (mainSelf) mainSelf.childCount = main.children.length;
    childrenByParent.set(
      main.id,
      main.children.map(c => c.id)
    );
    place(main, 0, 0, Math.PI * 2);
  }

  // Hide off-page nodes; pinned nodes stay visible at their stored position.
  for (const node of nodes) {
    const pin = pinned[node.id];
    if (pin) {
      node.x = pin.x;
      node.y = pin.y;
      node.hidden = false;
    } else {
      node.hidden = !placed.has(node.id);
    }
  }

  return { synthetic, rootId, childrenByParent };
}

/**
 * Canvas-rendered, concentric radial-tree view of the workspace document graph.
 * Layout is deterministic ({@link computeRadialTreeLayout}); pan/zoom/drag are
 * handled with native pointer events for predictable behavior on a single
 * canvas.
 */
export const GraphView = ({
  data,
  query = '',
  pinned,
  onPin,
  onUnpin,
  onLink,
  initialViewport = null,
  onViewportChange,
  initialNodePages,
  onNodePageChange,
  onTrash,
  onDeleteNode,
  onCreateNode,
  initialSortKeys,
  onSortKeyChange,
}: {
  data: GraphData;
  query?: string;
  pinned: PinnedPositions;
  onPin: (id: string, x: number, y: number) => void;
  onUnpin: (id: string) => void;
  onLink: (draggedId: string, targetId: string) => void;
  /** Saved pan/zoom to start from; `null` means fit-to-view as before. */
  initialViewport?: Transform | null;
  onViewportChange?: (viewport: Transform) => void;
  /** Saved per-node child page (docId -> page index). */
  initialNodePages?: Record<string, number>;
  onNodePageChange?: (id: string, page: number) => void;
  /** Move the given docs to trash (Backspace on a selection). */
  onTrash?: (ids: string[]) => void;
  /** Delete a single node via its X button: asks to confirm, then re-links the
   * node's children to its parent (`parentId` is null if it has no parent). */
  onDeleteNode?: (
    id: string,
    childIds: string[],
    parentId: string | null
  ) => void;
  /** Create a new doc/node; `parentId` links it under that node, `x`/`y` pin it. */
  onCreateNode?: () => string | undefined;
  /** Saved manual child sort keys (docId -> key). */
  initialSortKeys?: Record<string, number>;
  onSortKeyChange?: (id: string, key: number) => void;
}) => {
  const workbench = useService(WorkbenchService).workbench;
  const peekView = useService(PeekViewService).peekView;
  const homeDocService = useService(HomeDocService);
  const homeDocId = useLiveData(homeDocService.homeDocId$);
  // Mirror for draw()/hit-tests, which read it without re-subscribing.
  const homeDocIdRef = useRef(homeDocId);
  homeDocIdRef.current = homeDocId;
  useEffect(() => {
    homeDocService.ensureHomeDoc();
  }, [homeDocService]);
  const onTrashRef = useRef(onTrash);
  onTrashRef.current = onTrash;
  const onDeleteNodeRef = useRef(onDeleteNode);
  onDeleteNodeRef.current = onDeleteNode;
  const onCreateNodeRef = useRef(onCreateNode);
  onCreateNodeRef.current = onCreateNode;
  const onSortKeyChangeRef = useRef(onSortKeyChange);
  onSortKeyChangeRef.current = onSortKeyChange;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nodesRef = useRef<LayoutNode[]>([]);
  const linksRef = useRef<LayoutLink[]>([]);
  const nodeByIdRef = useRef<Map<string, LayoutNode>>(new Map());
  /** id -> set of neighbor ids, for hover highlighting */
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());

  const transformRef = useRef<Transform>(
    initialViewport ? { ...initialViewport } : { x: 0, y: 0, k: 1 }
  );
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  /** Re-fit the graph to the viewport on the next draw (set when nodes change). */
  const needsFitRef = useRef(initialViewport == null);
  /** Once the user pans/zooms (or a saved viewport is restored), stop auto-fitting. */
  const userAdjustedRef = useRef(initialViewport != null);
  const prevNodeCountRef = useRef(-1);

  // Debounced persistence of the current pan/zoom.
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistViewport = useCallback(() => {
    userAdjustedRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onViewportChangeRef.current?.({ ...transformRef.current });
    }, 400);
  }, []);
  const colorsRef = useRef<Colors>({
    background: '#0e0e14',
    edge: '#262633',
    edgeActive: '#22d3ee',
    node: '#7c6cff',
    nodeDim: '#9b9bb0',
    label: '#e7e7f2',
  });

  const hoveredRef = useRef<LayoutNode | null>(null);
  /** Node currently under a node being dragged — the link drop target. */
  const dropTargetRef = useRef<LayoutNode | null>(null);
  /** Selected node ids (single-click sets one; shift-drag marquee sets many). */
  const selectedRef = useRef<Set<string>>(new Set());
  /** Mirror of the selection size, to render the selection hint. */
  const [selectedCount, setSelectedCount] = useState(0);
  /** Active shift-drag marquee rectangle, in canvas/screen px. */
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  /** Id of a freshly created node being placed (it follows the cursor until the
   * user clicks a parent node); null when not placing. */
  const placingIdRef = useRef<string | null>(null);
  /** Id of a new node whose peek is open; on peek close it enters placement. */
  const pendingPeekIdRef = useRef<string | null>(null);
  /** The central root node id — a new node dropped on empty space links here. */
  const rootIdRef = useRef<string | null>(null);
  const queryRef = useRef('');
  const pinnedRef = useRef<PinnedPositions>(pinned);
  pinnedRef.current = pinned;
  /** Per-node child page (docId -> page index), seeded from the saved pages.
   * Bumping `layoutVersion` re-runs the layout after a page change. */
  const pageIndexRef = useRef<Map<string, number>>(
    new Map(Object.entries(initialNodePages ?? {}))
  );
  /** Nodes the user paged this session — don't let a late DB read overwrite them. */
  const touchedPagesRef = useRef<Set<string>>(new Set());
  const onNodePageChangeRef = useRef(onNodePageChange);
  onNodePageChangeRef.current = onNodePageChange;
  /** Manual sort keys (docId -> key), seeded from the saved keys. */
  const sortKeysRef = useRef<Map<string, number>>(
    new Map(Object.entries(initialSortKeys ?? {}))
  );
  /** Sort keys the user set this session — protected from late DB reads. */
  const touchedSortRef = useRef<Set<string>>(new Set());
  /** Latest layout's sorted children per parent (for fractional inserts). */
  const childrenByParentRef = useRef<Map<string, string[]>>(new Map());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const dragRef = useRef<{
    node: LayoutNode | null;
    panning: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  }>({
    node: null,
    panning: false,
    moved: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
  });
  /** When dragging a node that's part of a multi-selection, move the whole
   * group: start world position + each selected node's start position. */
  const groupDragRef = useRef<{
    startWx: number;
    startWy: number;
    positions: Map<string, { x: number; y: number }>;
  } | null>(null);

  /** Center the graph's bounding box in the viewport, zoomed to fit. */
  const fitToView = useCallback(() => {
    const nodes = nodesRef.current;
    const { w, h } = sizeRef.current;
    if (nodes.length === 0 || w === 0 || h === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.hidden) continue;
      const r = nodeRadius(n);
      // Frame the settled (target) layout so framing doesn't shift mid-anim.
      minX = Math.min(minX, n.tx - r);
      minY = Math.min(minY, n.ty - r);
      maxX = Math.max(maxX, n.tx + r);
      maxY = Math.max(maxY, n.ty + r);
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const k = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_FIT_ZOOM,
        (w - FIT_PADDING * 2) / contentW,
        (h - FIT_PADDING * 2) / contentH
      )
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transformRef.current = { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (needsFitRef.current) {
      fitToView();
      needsFitRef.current = false;
    }

    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const { x: tx, y: ty, k } = transformRef.current;
    const colors = colorsRef.current;
    const hovered = hoveredRef.current;
    const q = queryRef.current.trim().toLowerCase();

    // A "focus" is active whenever the user is hovering a node or searching.
    const hasFocus = !!hovered || q.length > 0;
    const highlight = hovered ? adjacencyRef.current.get(hovered.id) : null;
    const nodeActive = (node: LayoutNode) => {
      if (hovered) {
        return hovered.id === node.id || (highlight?.has(node.id) ?? false);
      }
      if (q) {
        return node.title.toLowerCase().includes(q);
      }
      return true;
    };
    const edgeActive = (s: LayoutNode, t: LayoutNode) => {
      if (hovered) {
        return hovered.id === s.id || hovered.id === t.id;
      }
      if (q) {
        return nodeActive(s) || nodeActive(t);
      }
      return false;
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // edges
    ctx.lineWidth = 1;
    for (const link of linksRef.current) {
      const s = link.source;
      const t = link.target;
      if (s.hidden || t.hidden) continue;
      const active = edgeActive(s, t);
      ctx.strokeStyle = active ? colors.edgeActive : colors.edge;
      // Default root links are dashed + fainter so they read as implicit.
      ctx.setLineDash(link.synthetic ? [4, 4] : []);
      ctx.globalAlpha = link.synthetic
        ? hasFocus && !active
          ? 0.15
          : 0.4
        : hasFocus && !active
          ? 0.25
          : 1;
      ctx.beginPath();
      ctx.moveTo(s.x * k + tx, s.y * k + ty);
      ctx.lineTo(t.x * k + tx, t.y * k + ty);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // nodes
    const showAllLabels = k > 1.3;
    for (const node of nodesRef.current) {
      if (node.hidden) continue;
      const sx = node.x * k + tx;
      const sy = node.y * k + ty;
      const r = nodeRadius(node) * k;
      const active = nodeActive(node);
      const selected = selectedRef.current.has(node.id);
      ctx.globalAlpha = active ? 1 : 0.3;
      // If the doc has an emoji icon, draw it as the node (once it's big enough
      // to read); otherwise fall back to the colored dot.
      if (node.icon && r >= 5) {
        ctx.font = `${r * 2}px "Inter", -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.icon, sx, sy);
      } else {
        ctx.fillStyle = active ? colors.node : colors.nodeDim;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pinned nodes get a small pin badge at the top-right so it's clear
      // they're anchored — without the cyan ring, which read as "selected".
      if (pinnedRef.current[node.id]) {
        ctx.globalAlpha = active ? 1 : 0.4;
        const pinSize = Math.max(11, Math.min(r * 0.9, 20));
        ctx.font = `${pinSize}px "Inter", -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📌', sx + r, sy - r);
        ctx.globalAlpha = 1;
      }

      // The node being dropped onto gets a prominent halo (link target).
      if (dropTargetRef.current === node) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.edgeActive;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // The single-click-selected node gets a filled halo + solid ring.
      if (selected) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = colors.edgeActive;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.edgeActive;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Hovering or selecting a node reveals an X delete button (top-left).
      // Clicking it asks to delete the node (re-linking children to its parent).
      // The home doc is the graph's anchor and can't be deleted, so no button.
      if (
        (hovered?.id === node.id || selected) &&
        node.id !== homeDocIdRef.current
      ) {
        const xSize = Math.max(12, Math.min(r * 0.9, 20));
        const cx = sx - r;
        const cy = sy - r;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, xSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        const d = xSize * 0.22;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, xSize * 0.14);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - d, cy - d);
        ctx.lineTo(cx + d, cy + d);
        ctx.moveTo(cx + d, cy - d);
        ctx.lineTo(cx - d, cy + d);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }

      if (showAllLabels || (hasFocus && active) || selected) {
        ctx.globalAlpha = active || selected ? 1 : 0.4;
        ctx.fillStyle = colors.label;
        ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label =
          node.title.length > 28 ? node.title.slice(0, 27) + '…' : node.title;
        ctx.fillText(label, sx, sy + r + 2);
      }

      // Paging controls for nodes whose children span more than one page.
      if (node.childCount > NODE_PAGE_SIZE) {
        const page = pageIndexRef.current.get(node.id) ?? 0;
        const pageCount = Math.ceil(node.childCount / NODE_PAGE_SIZE);
        const hasPrev = page > 0;
        const hasNext = page < pageCount - 1;
        ctx.globalAlpha = active ? 1 : 0.45;
        ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'middle';
        if (hasPrev) {
          ctx.fillStyle = colors.edgeActive;
          ctx.textAlign = 'right';
          ctx.fillText('◀', sx - r - PAGE_BTN_GAP, sy);
        }
        if (hasNext) {
          ctx.fillStyle = colors.edgeActive;
          ctx.textAlign = 'left';
          ctx.fillText('▶', sx + r + PAGE_BTN_GAP, sy);
        }
        ctx.fillStyle = colors.nodeDim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '10px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(`${page + 1}/${pageCount}`, sx, sy - r - 2);
      }
    }
    ctx.globalAlpha = 1;

    // Shift-drag marquee: a dotted rectangle with a faint fill.
    const marquee = marqueeRef.current;
    if (marquee) {
      const rx = Math.min(marquee.x0, marquee.x1);
      const ry = Math.min(marquee.y0, marquee.y1);
      const rw = Math.abs(marquee.x1 - marquee.x0);
      const rh = Math.abs(marquee.y1 - marquee.y0);
      ctx.save();
      ctx.fillStyle = colors.edgeActive;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = colors.edgeActive;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    // A new node being placed follows the cursor; show a dashed link to the
    // node it would become a child of, and a ring around the node itself.
    const placingId = placingIdRef.current;
    if (placingId) {
      const node = nodeByIdRef.current.get(placingId);
      const target = dropTargetRef.current;
      ctx.save();
      if (node && target && target.id !== placingId) {
        ctx.strokeStyle = colors.edgeActive;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(target.x * k + tx, target.y * k + ty);
        ctx.lineTo(node.x * k + tx, node.y * k + ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (node) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.edgeActive;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(
          node.x * k + tx,
          node.y * k + ty,
          nodeRadius(node) * k + 5,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [fitToView]);

  // Animate node positions towards their targets (tx, ty) using exponential
  // smoothing, so layout changes (links added, nodes added/removed) ease in
  // instead of jumping. Reads `nodesRef` fresh each frame, so it naturally
  // picks up new targets if the data changes mid-animation.
  const animationRef = useRef<number | null>(null);
  const animate = useCallback(() => {
    if (animationRef.current !== null) return;
    const step = () => {
      let moving = false;
      for (const n of nodesRef.current) {
        if (n.hidden) continue;
        const dx = n.tx - n.x;
        const dy = n.ty - n.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          n.x += dx * 0.2;
          n.y += dy * 0.2;
          moving = true;
        } else {
          n.x = n.tx;
          n.y = n.ty;
        }
      }
      draw();
      animationRef.current = moving ? requestAnimationFrame(step) : null;
    };
    animationRef.current = requestAnimationFrame(step);
  }, [draw]);

  // Rebuild the layout whenever the data changes.
  useEffect(() => {
    // Remember where nodes currently are, so they can tween from there.
    const prevPos = new Map(
      nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }])
    );

    const nodes: LayoutNode[] = data.nodes.map(n => ({
      ...n,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      hidden: false,
      childCount: 0,
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));

    // computeRadialTreeLayout writes the target layout into x/y and returns the
    // default root→parentless links, the central root id, and each parent's
    // sorted children.
    const { synthetic, rootId, childrenByParent } = computeRadialTreeLayout(
      nodes,
      data.links,
      pinned,
      pageIndexRef.current,
      sortKeysRef.current,
      homeDocId ?? null
    );
    rootIdRef.current = rootId;
    childrenByParentRef.current = childrenByParent;

    const adjacency = new Map<string, Set<string>>();
    for (const n of nodes) adjacency.set(n.id, new Set());
    const layoutLinks: LayoutLink[] = [];
    const addLink = (
      sourceId: string,
      targetId: string,
      isSynthetic: boolean
    ) => {
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!source || !target) return;
      layoutLinks.push({ source, target, synthetic: isSynthetic });
      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);
    };
    for (const l of data.links) addLink(l.source, l.target, false);
    for (const l of synthetic) addLink(l.source, l.target, true);

    // Move the computed layout into the target (tx, ty) and choose a start
    // position: existing nodes tween from where they were; new nodes grow out
    // of an already-present neighbour (or appear in place).
    for (const n of nodes) {
      n.tx = n.x;
      n.ty = n.y;
      const prev = prevPos.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
      } else {
        let start: { x: number; y: number } | undefined;
        for (const nb of adjacency.get(n.id) ?? []) {
          const nbPrev = prevPos.get(nb);
          if (nbPrev) {
            start = nbPrev;
            break;
          }
        }
        if (start) {
          n.x = start.x;
          n.y = start.y;
        }
      }
    }

    nodesRef.current = nodes;
    linksRef.current = layoutLinks;
    nodeByIdRef.current = byId;
    adjacencyRef.current = adjacency;

    // Re-fit when the set of nodes changes (added/removed), but keep the user's
    // current pan/zoom across unrelated updates — and never override a viewport
    // the user has explicitly set (or that was restored from the DB).
    if (nodes.length !== prevNodeCountRef.current && !userAdjustedRef.current) {
      needsFitRef.current = true;
    }
    prevNodeCountRef.current = nodes.length;
    hoveredRef.current = null;
    // Drop any selected ids whose node is no longer present.
    for (const id of selectedRef.current) {
      if (!byId.has(id)) selectedRef.current.delete(id);
    }
    setSelectedCount(selectedRef.current.size);

    animate();
  }, [data, pinned, animate, layoutVersion, homeDocId]);

  // Apply saved node pages whenever they (re)load — the userdata read can
  // resolve after mount (e.g. cloud sync emits [] first), so seeding once at
  // mount isn't enough. Pages the user changed this session are left untouched.
  useEffect(() => {
    if (!initialNodePages) return;
    let changed = false;
    for (const [id, page] of Object.entries(initialNodePages)) {
      if (touchedPagesRef.current.has(id)) continue;
      if ((pageIndexRef.current.get(id) ?? 0) !== page) {
        pageIndexRef.current.set(id, page);
        changed = true;
      }
    }
    if (changed) setLayoutVersion(v => v + 1);
  }, [initialNodePages]);

  // Likewise apply saved sort keys when they (re)load.
  useEffect(() => {
    if (!initialSortKeys) return;
    let changed = false;
    for (const [id, key] of Object.entries(initialSortKeys)) {
      if (touchedSortRef.current.has(id)) continue;
      if (sortKeysRef.current.get(id) !== key) {
        sortKeysRef.current.set(id, key);
        changed = true;
      }
    }
    if (changed) setLayoutVersion(v => v + 1);
  }, [initialSortKeys]);

  // Size tracking + theme color resolution.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const firstSize = sizeRef.current.w === 0 || sizeRef.current.h === 0;
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // Fit once the viewport size is known for the first time — unless the
      // user already has a saved/adjusted viewport to honor.
      if (firstSize && !userAdjustedRef.current) needsFitRef.current = true;
      draw();
    };

    const refreshColors = () => {
      colorsRef.current = readColors(container);
      draw();
    };

    refreshColors();
    applySize();

    const ro = new ResizeObserver(applySize);
    ro.observe(container);

    // Re-resolve colors when the app theme toggles.
    const mo = new MutationObserver(refreshColors);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [draw]);

  // Redraw when the search query changes (read from a ref inside `draw`).
  useEffect(() => {
    queryRef.current = query;
    draw();
  }, [query, draw]);

  // Cancel any in-flight animation frame + pending viewport save on unmount.
  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Flush the latest viewport so an in-flight pan/zoom isn't lost.
        onViewportChangeRef.current?.({ ...transformRef.current });
        saveTimerRef.current = null;
      }
    };
  }, []);

  const worldFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { px: 0, py: 0, wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { x, y, k } = transformRef.current;
    return { px, py, wx: (px - x) / k, wy: (py - y) / k };
  }, []);

  const hitTest = useCallback(
    (
      px: number,
      py: number,
      exclude?: LayoutNode | null
    ): LayoutNode | null => {
      const { x: tx, y: ty, k } = transformRef.current;
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.hidden) continue;
        if (exclude && n === exclude) continue;
        const sx = n.x * k + tx;
        const sy = n.y * k + ty;
        const r = nodeRadius(n) * k + HIT_PADDING;
        const dx = sx - px;
        const dy = sy - py;
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    },
    []
  );

  /** Hit-test a node's ◀ / ▶ paging button (screen coords). */
  const hitTestPageButton = useCallback(
    (
      px: number,
      py: number
    ): { node: LayoutNode; dir: 'prev' | 'next' } | null => {
      const { x: tx, y: ty, k } = transformRef.current;
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.hidden || n.childCount <= NODE_PAGE_SIZE) continue;
        const sx = n.x * k + tx;
        const sy = n.y * k + ty;
        const r = nodeRadius(n) * k;
        const page = pageIndexRef.current.get(n.id) ?? 0;
        const pageCount = Math.ceil(n.childCount / NODE_PAGE_SIZE);
        const within = (bx: number) =>
          (bx - px) ** 2 + (sy - py) ** 2 <= PAGE_BTN_HIT * PAGE_BTN_HIT;
        if (page > 0 && within(sx - r - PAGE_BTN_GAP)) {
          return { node: n, dir: 'prev' };
        }
        if (page < pageCount - 1 && within(sx + r + PAGE_BTN_GAP)) {
          return { node: n, dir: 'next' };
        }
      }
      return null;
    },
    []
  );

  /** Hit-test a pinned node's 📌 badge (screen coords) so a click unpins it.
   * Mirrors the badge geometry in draw(): centered at the node's top-right. */
  const hitTestPin = useCallback(
    (px: number, py: number): LayoutNode | null => {
      const { x: tx, y: ty, k } = transformRef.current;
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.hidden || !pinnedRef.current[n.id]) continue;
        const r = nodeRadius(n) * k;
        const cx = n.x * k + tx + r;
        const cy = n.y * k + ty - r;
        const pinSize = Math.max(11, Math.min(r * 0.9, 20));
        const hit = Math.max(pinSize * 0.6, 9);
        if ((cx - px) ** 2 + (cy - py) ** 2 <= hit * hit) return n;
      }
      return null;
    },
    []
  );

  /** Hit-test a node's X delete badge (screen coords). The badge is only shown
   * (and thus only clickable) for the hovered node or a selected node; mirrors
   * the badge geometry in draw(): centered at the node's top-left. */
  const hitTestDelete = useCallback(
    (px: number, py: number): LayoutNode | null => {
      const { x: tx, y: ty, k } = transformRef.current;
      const nodes = nodesRef.current;
      const hovered = hoveredRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.hidden || n.id === homeDocIdRef.current) continue;
        if (hovered?.id !== n.id && !selectedRef.current.has(n.id)) continue;
        const r = nodeRadius(n) * k;
        const cx = n.x * k + tx - r;
        const cy = n.y * k + ty - r;
        const xSize = Math.max(12, Math.min(r * 0.9, 20));
        const hit = Math.max(xSize * 0.6, 10);
        if ((cx - px) ** 2 + (cy - py) ** 2 <= hit * hit) return n;
      }
      return null;
    },
    []
  );

  const changePage = useCallback((node: LayoutNode, dir: 'prev' | 'next') => {
    const cur = pageIndexRef.current.get(node.id) ?? 0;
    const pageCount = Math.ceil(node.childCount / NODE_PAGE_SIZE);
    const next = Math.max(
      0,
      Math.min(pageCount - 1, cur + (dir === 'next' ? 1 : -1))
    );
    if (next === cur) return;
    pageIndexRef.current.set(node.id, next);
    touchedPagesRef.current.add(node.id);
    onNodePageChangeRef.current?.(node.id, next);
    setLayoutVersion(v => v + 1);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { px, py, wx, wy } = worldFromClient(e.clientX, e.clientY);
      const t = transformRef.current;
      // Normalize line-mode wheels (some mice) to pixels, then zoom by an amount
      // proportional to the delta so a gentle pinch zooms gently. Clamp the
      // per-event delta so one large momentum tick can't jump the zoom.
      const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const delta = Math.max(-120, Math.min(120, raw));
      const factor = Math.exp(-delta * ZOOM_SENSITIVITY);
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor));
      transformRef.current = { k, x: px - wx * k, y: py - wy * k };
      persistViewport();
      draw();
    },
    [draw, persistViewport, worldFromClient]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Take focus so selection shortcuts (Backspace / Enter) reach the graph.
      containerRef.current?.focus({ preventScroll: true });
      const { px, py, wx, wy } = worldFromClient(e.clientX, e.clientY);
      // Shift-drag draws a marquee to select multiple nodes.
      if (e.shiftKey) {
        canvas.setPointerCapture(e.pointerId);
        marqueeRef.current = { x0: px, y0: py, x1: px, y1: py };
        draw();
        return;
      }
      // Paging buttons take priority over node drag/open.
      const btn = hitTestPageButton(px, py);
      if (btn) {
        changePage(btn.node, btn.dir);
        return;
      }
      // Clicking a pinned node's 📌 badge unpins it.
      const pinHit = hitTestPin(px, py);
      if (pinHit) {
        onUnpin(pinHit.id);
        return;
      }
      // Clicking a node's X badge asks to delete it (re-parenting its children).
      const delHit = hitTestDelete(px, py);
      if (delHit) {
        const childIds = childrenByParentRef.current.get(delHit.id) ?? [];
        let parentId: string | null = null;
        for (const [pid, kids] of childrenByParentRef.current) {
          if (kids.includes(delHit.id)) {
            parentId = pid;
            break;
          }
        }
        onDeleteNodeRef.current?.(delHit.id, [...childIds], parentId);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      const node = hitTest(px, py);
      // Grabbing a node makes the drag authoritative — stop any running tween.
      if (node && animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      // Dragging a node that's part of a multi-selection moves the whole group.
      if (
        node &&
        selectedRef.current.size > 1 &&
        selectedRef.current.has(node.id)
      ) {
        const positions = new Map<string, { x: number; y: number }>();
        for (const id of selectedRef.current) {
          const n = nodeByIdRef.current.get(id);
          if (n) positions.set(id, { x: n.x, y: n.y });
        }
        groupDragRef.current = { startWx: wx, startWy: wy, positions };
      } else {
        groupDragRef.current = null;
      }
      const t = transformRef.current;
      dragRef.current = {
        node,
        panning: !node,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        startTx: t.x,
        startTy: t.y,
      };
    },
    [
      changePage,
      draw,
      hitTest,
      hitTestPageButton,
      hitTestPin,
      hitTestDelete,
      onUnpin,
      worldFromClient,
    ]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // While placing a new node, its own document listeners drive the cursor.
      if (placingIdRef.current) return;
      const drag = dragRef.current;
      const { px, py, wx, wy } = worldFromClient(e.clientX, e.clientY);

      if (marqueeRef.current) {
        marqueeRef.current.x1 = px;
        marqueeRef.current.y1 = py;
        draw();
        return;
      }

      if (drag.node) {
        const group = groupDragRef.current;
        if (group) {
          // Move every selected node by the same delta.
          const dx = wx - group.startWx;
          const dy = wy - group.startWy;
          for (const [id, p] of group.positions) {
            const n = nodeByIdRef.current.get(id);
            if (n) {
              n.x = p.x + dx;
              n.y = p.y + dy;
            }
          }
        } else {
          drag.node.x = wx;
          drag.node.y = wy;
        }
        if (
          Math.abs(e.clientX - drag.startX) > 3 ||
          Math.abs(e.clientY - drag.startY) > 3
        ) {
          drag.moved = true;
        }
        // Highlight a node underneath as the link drop target (single drag only).
        dropTargetRef.current =
          !group && drag.moved ? hitTest(px, py, drag.node) : null;
        draw();
        return;
      }
      if (drag.panning) {
        transformRef.current = {
          ...transformRef.current,
          x: drag.startTx + (e.clientX - drag.startX),
          y: drag.startTy + (e.clientY - drag.startY),
        };
        persistViewport();
        draw();
        return;
      }

      // hover
      let node = hitTest(px, py);
      // Keep a node "hovered" while the pointer sits on its X badge sliver
      // (which pokes outside the node body), so it stays visible + clickable.
      if (!node) node = hitTestDelete(px, py);
      if (node !== hoveredRef.current) {
        hoveredRef.current = node;
        draw();
      }
      // A node — or a badge sliver that pokes outside it — is clickable.
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor =
          node || hitTestPin(px, py) ? 'pointer' : 'default';
      }
    },
    [draw, hitTest, hitTestPin, hitTestDelete, persistViewport, worldFromClient]
  );

  const openNode = useCallback(
    (node: LayoutNode, newTab: boolean) => {
      if (newTab) {
        workbench.openDoc(node.id, { at: 'new-tab' });
      } else {
        // Preview the doc in a modal (like an embed card).
        peekView
          .open({ type: 'doc', docRef: { docId: node.id } })
          .catch(console.error);
      }
    },
    [peekView, workbench]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      canvas?.releasePointerCapture(e.pointerId);

      // Finish a shift gesture. Shift is additive: a drag adds every node in
      // the marquee; a click toggles the node under the cursor.
      const marquee = marqueeRef.current;
      if (marquee) {
        marqueeRef.current = null;
        const dragged =
          Math.abs(marquee.x1 - marquee.x0) > 3 ||
          Math.abs(marquee.y1 - marquee.y0) > 3;
        const sel = new Set(selectedRef.current);
        if (dragged) {
          const minX = Math.min(marquee.x0, marquee.x1);
          const maxX = Math.max(marquee.x0, marquee.x1);
          const minY = Math.min(marquee.y0, marquee.y1);
          const maxY = Math.max(marquee.y0, marquee.y1);
          const { x: tx, y: ty, k } = transformRef.current;
          for (const n of nodesRef.current) {
            if (n.hidden) continue;
            const sx = n.x * k + tx;
            const sy = n.y * k + ty;
            if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
              sel.add(n.id);
            }
          }
        } else {
          const { px, py } = worldFromClient(e.clientX, e.clientY);
          const target = hitTest(px, py);
          if (target) {
            if (sel.has(target.id)) sel.delete(target.id);
            else sel.add(target.id);
          }
        }
        selectedRef.current = sel;
        setSelectedCount(sel.size);
        draw();
        dragRef.current = {
          ...dragRef.current,
          node: null,
          panning: false,
          moved: false,
        };
        return;
      }

      const drag = dragRef.current;
      const node = drag.node;
      const group = groupDragRef.current;
      groupDragRef.current = null;

      const dropTarget = dropTargetRef.current;
      dropTargetRef.current = null;

      if (node) {
        if (group && drag.moved) {
          // Pin every node that moved with the group.
          for (const id of group.positions.keys()) {
            const n = nodeByIdRef.current.get(id);
            if (n) onPin(id, n.x, n.y);
          }
        } else if (drag.moved && dropTarget && dropTarget.id !== node.id) {
          // Dropped onto another node: link the dragged node into the target.
          onLink(node.id, dropTarget.id);
        } else if (drag.moved) {
          // Pin the node where it was dropped and persist it.
          onPin(node.id, node.x, node.y);
        } else if (e.altKey && pinnedRef.current[node.id]) {
          // Alt/Option-click a pinned node to unpin it.
          onUnpin(node.id);
        } else if (e.pointerType === 'touch' || e.pointerType === 'pen') {
          // A touch/pen tap opens the doc; a plain mouse click selects it —
          // mouse uses double-click (onDoubleClick) to open.
          openNode(node, e.metaKey || e.ctrlKey);
        } else {
          // Mouse single-click selects just this node.
          selectedRef.current = new Set([node.id]);
          setSelectedCount(1);
          draw();
        }
      } else if (!drag.moved && selectedRef.current.size > 0) {
        // Click on empty space clears the selection.
        selectedRef.current = new Set();
        setSelectedCount(0);
        draw();
      }
      dragRef.current = { ...drag, node: null, panning: false, moved: false };
    },
    [draw, hitTest, onLink, onPin, onUnpin, openNode, worldFromClient]
  );

  // Mouse double-click opens the node (single click does not).
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { px, py } = worldFromClient(e.clientX, e.clientY);
      const node = hitTest(px, py);
      if (node) openNode(node, e.metaKey || e.ctrlKey);
    },
    [hitTest, openNode, worldFromClient]
  );

  // After the new node's peek closes, the node follows the cursor until the
  // user clicks a node to make it the parent (or empty space to drop it).
  const beginPlacement = useCallback(
    (id: string) => {
      placingIdRef.current = id;
      const onMove = (ev: PointerEvent) => {
        const { px, py, wx, wy } = worldFromClient(ev.clientX, ev.clientY);
        const node = nodeByIdRef.current.get(id);
        if (node) {
          node.x = node.tx = wx;
          node.y = node.ty = wy;
        }
        dropTargetRef.current = hitTest(px, py, node ?? null);
        draw();
      };
      const onClick = (ev: MouseEvent) => {
        const { px, py } = worldFromClient(ev.clientX, ev.clientY);
        const node = nodeByIdRef.current.get(id);
        const target = hitTest(px, py, node ?? null);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('click', onClick, true);
        placingIdRef.current = null;
        dropTargetRef.current = null;
        const parentId =
          target && target.id !== id ? target.id : rootIdRef.current;
        // The clicked node becomes the parent; dropping on empty attaches it to
        // the central root (the current page) so the node is always added.
        if (parentId && parentId !== id) {
          onLink(id, parentId);
          // Give the new node a fractional sort key that slots it at the start
          // of the parent's current page (offsetting the rest), so it's visible
          // without paging — rather than appended onto a hidden last page.
          const siblings = childrenByParentRef.current.get(parentId) ?? [];
          const keyOf = (sid: string | undefined) =>
            sid == null
              ? undefined
              : (sortKeysRef.current.get(sid) ??
                nodeByIdRef.current.get(sid)?.createdAt ??
                0);
          const k = (pageIndexRef.current.get(parentId) ?? 0) * NODE_PAGE_SIZE;
          const before = k > 0 ? keyOf(siblings[k - 1]) : undefined;
          const after = keyOf(siblings[k]);
          let newKey: number;
          if (before != null && after != null) newKey = (before + after) / 2;
          else if (after != null) newKey = after - 1;
          else if (before != null) newKey = before + 1;
          else newKey = Date.now();
          sortKeysRef.current.set(id, newKey);
          touchedSortRef.current.add(id);
          onSortKeyChangeRef.current?.(id, newKey);
        }
        // Re-run the layout so the new node takes its place in the concentric
        // tree rather than staying where it was dropped.
        setLayoutVersion(v => v + 1);
        draw();
      };
      document.addEventListener('pointermove', onMove);
      // Delay so the click that closed the peek doesn't immediately place it.
      setTimeout(() => {
        document.addEventListener('click', onClick, true);
      }, 50);
    },
    [draw, hitTest, onLink, worldFromClient]
  );

  // Click `+` → create a node, open its peek to edit; placement begins on close.
  const onCreateClick = useCallback(() => {
    const id = onCreateNodeRef.current?.();
    if (!id) return;
    pendingPeekIdRef.current = id;
    peekView.open({ type: 'doc', docRef: { docId: id } }).catch(console.error);
    focusPeekTitle();
  }, [peekView]);

  // Detect the new node's peek closing → start placement.
  const peekShown = useLiveData(peekView.show$);
  const prevPeekShownRef = useRef(false);
  useEffect(() => {
    const shown = !!peekShown?.value;
    const wasShown = prevPeekShownRef.current;
    prevPeekShownRef.current = shown;
    if (wasShown && !shown && pendingPeekIdRef.current) {
      const id = pendingPeekIdRef.current;
      pendingPeekIdRef.current = null;
      beginPlacement(id);
    }
  }, [peekShown, beginPlacement]);

  // Selection shortcuts (the container is focusable, so these only fire when
  // the graph has focus — not while typing in the search box).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedRef.current.size === 0) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Hand off to the confirm flow; the selection clears once the docs are
        // trashed and pruned from the graph (so canceling keeps it).
        e.preventDefault();
        onTrashRef.current?.([...selectedRef.current]);
      } else if (e.key === 'Enter') {
        // Open every selected doc in a new tab.
        e.preventDefault();
        for (const id of selectedRef.current) {
          workbench.openDoc(id, { at: 'new-tab' });
        }
      }
    },
    [workbench]
  );

  const truncationNotice = useMemo(
    () =>
      data.truncated
        ? `Showing the ${data.nodes.length} most-linked docs of ${data.totalDocCount}.`
        : null,
    [data.truncated, data.nodes.length, data.totalDocCount]
  );

  return (
    <div
      ref={containerRef}
      className={styles.canvasContainer}
      tabIndex={0}
      style={{ outline: 'none' }}
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      {data.nodes.length > 0 ? (
        <div className={styles.legend}>
          <div className={styles.legendTitle}>Controls</div>
          <div>
            <span className={styles.legendKey}>Click</span> select ·{' '}
            <span className={styles.legendKey}>Shift</span> add / box-select
          </div>
          <div>
            <span className={styles.legendKey}>Double-click</span> open ·{' '}
            <span className={styles.legendKey}>⌘</span> new tab
          </div>
          <div>
            <span className={styles.legendKey}>Drag</span> move/pin · onto node:
            link
          </div>
          <div>
            <span className={styles.legendKey}>Alt-click</span> unpin
          </div>
          <div>
            <span className={styles.legendKey}>Enter</span> open in tabs ·{' '}
            <span className={styles.legendKey}>⌫</span> trash
          </div>
          <div>
            <span className={styles.legendKey}>◀ ▶</span> page children
          </div>
        </div>
      ) : null}
      {data.nodes.length === 0 ? (
        <div className={styles.emptyState}>
          No documents yet. Create and link some docs to see the graph.
        </div>
      ) : null}
      {truncationNotice ? (
        <div className={styles.notice}>{truncationNotice}</div>
      ) : null}
      {selectedCount > 0 ? (
        <div className={styles.selectionHint}>
          {selectedCount} selected · Enter to open · ⌫ to trash
        </div>
      ) : null}
      {onCreateNode ? (
        <button
          type="button"
          className={styles.createButton}
          title="Add a node — edit it, then click a node to set its parent"
          aria-label="Create node"
          onClick={onCreateClick}
        >
          +
        </button>
      ) : null}
    </div>
  );
};
