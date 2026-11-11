import {
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type XYPosition,
} from '@xyflow/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, Code2, Frame, ImagePlus, Link2, Move, StickyNote, Type } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type RefObject } from 'react';
import { DEFAULT_APPEARANCE, resolveColor } from './appearance';
import { ArrowEdge, type ArrowEdgeType } from './ArrowEdge';
import { CanvasBackground } from './CanvasBackground';
import { CodeNode } from './cards/CodeNode';
import { autoEdit, buildCard, type Built } from './cards/create';
import { FrameNode } from './cards/FrameNode';
import { ImageNode } from './cards/ImageNode';
import { LinkNode } from './cards/LinkNode';
import { NoteNode } from './cards/NoteNode';
import {
  addEdge,
  db,
  deleteCards,
  deleteEdges,
  moveCards,
  patchEdge,
  saveViewport,
  setAppearance,
  touchBoard,
  uid,
  updateMarkers,
  type Board,
  type BoardEdge,
  type Card,
  type FrameCard,
} from './db';
import { captureClip, clipHtml, matchesClip, pasteClip, summarize, writeSystemClipboard } from './lib/boardClipboard';
import { setLoadZone } from './lib/loadZone';
import { PRELOAD_SCREENS, useSettings } from './lib/settings';
import { classifyText, incomingFromTransfer, type Incoming } from './lib/classify';
import { AppearanceMenu } from './ui/AppearanceMenu';
import { Dock, ZoomPill } from './ui/Dock';
import { MarkerBar } from './ui/MarkerBar';
import { LinkPrompt, RadialMenu, type WheelItem } from './ui/RadialMenu';
import { IS_MAC, MOD, keys } from './lib/keys';

type CardNode = Node<{ card: Card }>;

const nodeTypes: NodeTypes = { note: NoteNode, code: CodeNode, image: ImageNode, link: LinkNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { arrow: ArrowEdge };

const MINIMAP_COLORS: Record<Card['type'], string> = {
  note: '#f2c94c',
  code: '#7b8cff',
  image: '#9aa0a6',
  link: '#3fbf86',
  frame: 'rgba(140,140,160,0.25)',
};

// ------------------------------------------------------------------ mapping

function toNode(card: Card): CardNode {
  const isFrame = card.type === 'frame';
  return {
    id: card.id,
    type: card.type,
    position: { x: card.x, y: card.y },
    width: card.width,
    height: card.height,
    data: { card },
    // Frames sit behind everything and are grabbed by their title or edge.
    // Box-selection only picks them up when fully enclosed (see onSelectionEnd).
    ...(isFrame && { zIndex: -1000, dragHandle: '.frame-drag' }),
  };
}

/** Frames first so they render underneath cards. */
const byLayer = (a: Card, b: Card) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1) || a.createdAt - b.createdAt;

/** Fold fresh DB rows into React Flow's node state without clobbering in-progress drags/resizes. */
function mergeNodes(prev: CardNode[], cards: Card[], select: Set<string>): CardNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  const selectingNew = cards.some((c) => select.has(c.id) && !byId.has(c.id));
  return [...cards].sort(byLayer).map((card) => {
    const next = toNode(card);
    const old = byId.get(card.id);
    if (!old) return { ...next, selected: select.has(card.id) };
    const busy = old.dragging || old.resizing;
    return {
      ...old,
      ...next,
      position: busy ? old.position : next.position,
      width: busy ? old.width : next.width,
      height: busy ? old.height : next.height,
      selected: selectingNew ? false : old.selected,
    };
  });
}

function toEdge(e: BoardEdge, prev?: ArrowEdgeType): ArrowEdgeType {
  // Ends stay on the sides you chose. (Arrowheads are drawn by ArrowEdge.)
  return {
    id: e.id,
    type: 'arrow',
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    data: { edge: e },
    selected: prev?.selected,
  };
}

/** The side of `r` closest to point `p`, relative to the card's shape. */
function nearestSide(r: Rect, p: XYPosition): string {
  const dx = (p.x - (r.x + r.w / 2)) / (r.w / 2 || 1);
  const dy = (p.y - (r.y + r.h / 2)) / (r.h / 2 || 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'r' : 'l';
  return dy >= 0 ? 'b' : 't';
}

/** Sides of two cards that face each other. Only a fallback for arrows saved without a side. */
function facingSides(a: Rect, b: Rect): [string, string] {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (hGap >= vGap) return b.x + b.w / 2 >= a.x + a.w / 2 ? ['r', 'l'] : ['l', 'r'];
  return b.y + b.h / 2 >= a.y + a.h / 2 ? ['b', 't'] : ['t', 'b'];
}

// ------------------------------------------------------------------ geometry

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const rectOf = (n: Node): Rect => ({
  x: n.position.x,
  y: n.position.y,
  w: n.measured?.width ?? n.width ?? 240,
  h: n.measured?.height ?? n.height ?? 160,
});

const containsPoint = (r: Rect, p: XYPosition) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

const PAD = 16;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;

/** Nearest position to `want` (searching outward in rings) that doesn't cover an existing card. */
function freeSpot(want: Rect, taken: Rect[]): Rect {
  if (!taken.some((t) => overlaps(want, t))) return want;
  const step = 40;
  for (let ring = 1; ring <= 40; ring++) {
    const candidates: Rect[] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push(
        { ...want, x: want.x + i * step, y: want.y - ring * step },
        { ...want, x: want.x + i * step, y: want.y + ring * step },
        { ...want, x: want.x - ring * step, y: want.y + i * step },
        { ...want, x: want.x + ring * step, y: want.y + i * step },
      );
    }
    const dist = (r: Rect) => Math.hypot(r.x - want.x, r.y - want.y);
    const free = candidates.filter((c) => !taken.some((t) => overlaps(c, t))).sort((a, b) => dist(a) - dist(b));
    if (free.length) return free[0];
  }
  return want;
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

// ------------------------------------------------------------------ component

interface CanvasProps {
  board: Board;
  focusCardId: string | null;
  onFocusHandled: () => void;
}

export function BoardCanvas(props: CanvasProps) {
  const cards = useLiveQuery(() => db.cards.where('boardId').equals(props.board.id).toArray(), [props.board.id]);
  const edges = useLiveQuery(() => db.edges.where('boardId').equals(props.board.id).toArray(), [props.board.id]);
  if (!cards || !edges) return <div className="canvas" />;
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} cards={cards} dbEdges={edges} />
    </ReactFlowProvider>
  );
}

function readMinimapPref() {
  try {
    return localStorage.getItem('codeboard:minimap') !== '0';
  } catch {
    return true;
  }
}

/**
 * "Glide" pointer mode: while on, bringing the cursor near any edge of the
 * canvas scrolls the board that way, faster the closer you get.
 */
function useEdgeGlide(
  enabled: boolean,
  wrapperRef: RefObject<HTMLDivElement | null>,
  pointer: RefObject<{ x: number; y: number } | null>,
  overUi: RefObject<boolean>,
  velocity: RefObject<{ x: number; y: number }>,
) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!enabled) {
      velocity.current = { x: 0, y: 0 };
      return;
    }
    // Gliding starts a third of the way in from each edge and speeds up
    // towards the edge, so the middle of the screen is a calm "rest" zone.
    const ZONE = 0.34;
    const MAX = 42; // px per frame at the very edge
    const push = (d: number, margin: number) => (d < margin ? ((margin - Math.max(d, 0)) / margin) ** 1.6 * MAX : 0);
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(48, t - last) / 16.67;
      last = t;
      const p = pointer.current;
      const el = wrapperRef.current;
      velocity.current = { x: 0, y: 0 };
      if (p && el && !overUi.current) {
        const r = el.getBoundingClientRect();
        const mx = Math.max(140, r.width * ZONE);
        const my = Math.max(120, r.height * ZONE);
        const vx = push(p.x - r.left, mx) - push(r.right - p.x, mx);
        const vy = push(p.y - r.top, my) - push(r.bottom - p.y, my);
        velocity.current = { x: vx, y: vy };
        if (vx || vy) {
          const vp = rf.getViewport();
          void rf.setViewport({ x: vp.x + vx * dt, y: vp.y + vy * dt, zoom: vp.zoom });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      velocity.current = { x: 0, y: 0 };
    };
  }, [enabled, rf, wrapperRef, pointer, overUi, velocity]);
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Remembers the last drag-selection rectangle (pane pixels); React Flow clears it on release. */
function SelectionRectTracker({ into }: { into: RefObject<SelectionRect | null> }) {
  const rect = useStore((s) => s.userSelectionRect);
  useEffect(() => {
    if (rect && rect.width + rect.height > 0) into.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, [rect, into]);
  return null;
}

/**
 * Keeps the lazy-load zone in sync with the view: the visible area plus
 * `buffer` screens on every side, stretched ~1.5s ahead while gliding.
 */
function LoadZoneTracker({ enabled, buffer, velocity }: { enabled: boolean; buffer: number; velocity: RefObject<{ x: number; y: number }> }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  useEffect(() => {
    if (!enabled || !width || !height) {
      setLoadZone(null);
      return;
    }
    const w = width / zoom;
    const h = height / zoom;
    const x = -tx / zoom;
    const y = -ty / zoom;
    let left = x - w * buffer;
    let right = x + w + w * buffer;
    let top = y - h * buffer;
    let bottom = y + h + h * buffer;
    // Glide velocity is in screen px/frame; the view moving +x means travelling left.
    const v = velocity.current;
    const ahead = 90 / zoom; // ~1.5s of frames
    if (v.x > 0) left -= v.x * ahead;
    if (v.x < 0) right -= v.x * ahead;
    if (v.y > 0) top -= v.y * ahead;
    if (v.y < 0) bottom -= v.y * ahead;
    setLoadZone({ x: left, y: top, w: right - left, h: bottom - top });
  }, [enabled, buffer, tx, ty, zoom, width, height, velocity]);

  useEffect(() => () => setLoadZone(null), []);
  return null;
}

/** UI that should never trigger gliding while the cursor is over it. */
const UI_SELECTOR = '.react-flow__panel, .react-flow__minimap, .card-toolbar, .wheel-backdrop, .link-prompt, .react-flow__node-toolbar';

function usePrefersDark() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

function CanvasInner({ board, cards, dbEdges, focusCardId, onFocusHandled }: CanvasProps & { cards: Card[]; dbEdges: BoardEdge[] }) {
  const rf = useReactFlow<CardNode, ArrowEdgeType>();
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(mergeNodes([], cards, new Set()));
  const [edges, setEdges, onEdgesChange] = useEdgesState<ArrowEdgeType>(dbEdges.map((e) => toEdge(e)));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pendingSelect = useRef(new Set<string>());
  const viewportTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [minimap, setMinimap] = useState(readMinimapPref);
  const [markerIndex, setMarkerIndex] = useState(-1);
  const [glide, setGlide] = useState(false);
  const [wheel, setWheel] = useState<{ x: number; y: number; at: XYPosition } | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<{ x: number; y: number; at: XYPosition } | null>(null);
  const overUi = useRef(false);
  const clickTimer = useRef<number | undefined>(undefined);
  const beforeClick = useRef({ busy: false });
  const fileInput = useRef<HTMLInputElement>(null);
  const imageAt = useRef<XYPosition | null>(null);
  const glideVelocity = useRef({ x: 0, y: 0 });
  const lastSelectionRect = useRef<SelectionRect | null>(null);
  const settings = useSettings();
  useEdgeGlide(glide, wrapperRef, pointer, overUi, glideVelocity);

  // Arrows keep the sides you chose; only ones saved without a side get the
  // sides facing each other filled in.
  const displayEdges = useMemo(() => {
    if (edges.every((e) => e.sourceHandle && e.targetHandle)) return edges;
    const rects = new Map(nodes.map((n) => [n.id, rectOf(n)]));
    return edges.map((e) => {
      if (e.sourceHandle && e.targetHandle) return e;
      const a = rects.get(e.source);
      const b = rects.get(e.target);
      if (!a || !b) return e;
      const [s, t] = facingSides(a, b);
      return { ...e, sourceHandle: e.sourceHandle ?? s, targetHandle: e.targetHandle ?? t };
    });
  }, [edges, nodes]);

  /** The card under a point: cards win over boxes, and the smallest box wins among boxes. */
  const cardAt = useCallback(
    (p: XYPosition, exclude?: string) => {
      const hits = rf.getNodes().filter((n) => n.id !== exclude && containsPoint(rectOf(n), p));
      const card = hits.filter((n) => n.type !== 'frame').pop();
      if (card) return card;
      return hits.sort((m, n) => rectOf(m).w * rectOf(m).h - rectOf(n).w * rectOf(n).h)[0];
    },
    [rf],
  );

  const appearance = board.appearance ?? DEFAULT_APPEARANCE;
  const color = resolveColor(appearance.color);
  const prefersDark = usePrefersDark();
  const isDark = color.id === 'auto' ? prefersDark : color.dark;
  const markers = useMemo(() => board.markers ?? [], [board.markers]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // DB -> canvas.
  useEffect(() => {
    const select = new Set(pendingSelect.current);
    setNodes((prev) => mergeNodes(prev, cards, select));
    // New cards take over the selection: drop selected arrows too, so a
    // following ⌫ only deletes what was just added.
    if (cards.some((c) => select.has(c.id))) {
      setEdges((es) => (es.some((e) => e.selected) ? es.map((e) => (e.selected ? { ...e, selected: false } : e)) : es));
    }
    for (const c of cards) pendingSelect.current.delete(c.id);
  }, [cards, setNodes, setEdges]);

  useEffect(() => {
    setEdges((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      return dbEdges.map((e) => toEdge(e, byId.get(e.id)));
    });
  }, [dbEdges, setEdges]);

  useEffect(
    () => () => {
      window.clearTimeout(viewportTimer.current);
      window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // ---------------------------------------------------------------- adding

  /** Where new cards go: under the cursor if it's over the canvas, else the centre of the view. */
  const insertPoint = useCallback(
    (preferPointer = true): XYPosition => {
      const rect = wrapperRef.current!.getBoundingClientRect();
      const p = pointer.current;
      const inside = p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
      const screen = preferPointer && inside ? p : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return rf.screenToFlowPosition(screen);
    },
    [rf],
  );

  const addItems = useCallback(
    async (items: Incoming[], at: XYPosition, opts: { edit?: boolean; exact?: boolean } = {}) => {
      const built = (await Promise.all(items.map((i) => buildCard(board.id, i)))).filter((b): b is Built => !!b);
      if (!built.length) return [];

      // Lay multiple items out in a row centred on the insert point, avoiding other cards.
      const gap = 24;
      const total = built.reduce((sum, b) => sum + b.card.width, 0) + gap * (built.length - 1);
      let x = at.x - total / 2;
      const taken: Rect[] = rf.getNodes().filter((n) => n.type !== 'frame').map(rectOf);
      for (const { card, height } of built) {
        const want = { x, y: at.y - height / 2, w: card.width, h: height };
        const spot = opts.exact ? want : freeSpot(want, taken);
        card.x = Math.round(spot.x);
        card.y = Math.round(spot.y);
        taken.push({ ...spot, w: card.width, h: height });
        x += card.width + gap;
        pendingSelect.current.add(card.id);
        if (opts.edit) autoEdit.add(card.id);
      }
      await db.cards.bulkAdd(built.map((b) => b.card));
      void touchBoard(board.id);
      return built.map((b) => b.card);
    },
    [board.id, rf],
  );

  const addNote = useCallback(
    (at = insertPoint(false)) => void addItems([{ kind: 'note', text: '' }], at, { edit: true }),
    [addItems, insertPoint],
  );
  const addText = useCallback(
    (at = insertPoint(false)) => void addItems([{ kind: 'note', text: '', color: 'none', size: 'l' }], at, { edit: true }),
    [addItems, insertPoint],
  );
  const addCode = useCallback(
    (at = insertPoint(false)) => void addItems([{ kind: 'code', code: '', language: 'plaintext' }], at, { edit: true }),
    [addItems, insertPoint],
  );

  /** Box around the selected cards, or an empty box in the middle of the view. */
  const addFrame = useCallback(async (at?: XYPosition) => {
    const selected = at ? [] : rf.getNodes().filter((n) => n.selected);
    let rect: Rect;
    if (selected.length) {
      const rs = selected.map(rectOf);
      const minX = Math.min(...rs.map((r) => r.x));
      const minY = Math.min(...rs.map((r) => r.y));
      const maxX = Math.max(...rs.map((r) => r.x + r.w));
      const maxY = Math.max(...rs.map((r) => r.y + r.h));
      rect = { x: minX - 40, y: minY - 64, w: maxX - minX + 80, h: maxY - minY + 104 };
    } else {
      const c = at ?? insertPoint(false);
      rect = { x: c.x - 300, y: c.y - 200, w: 600, h: 400 };
    }
    const now = Date.now();
    const frame: FrameCard = {
      id: uid(),
      boardId: board.id,
      type: 'frame',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.w),
      height: Math.round(rect.h),
      createdAt: now,
      updatedAt: now,
      data: { title: '', color: 'gray' },
    };
    autoEdit.add(frame.id);
    await db.cards.add(frame);
  }, [board.id, insertPoint, rf]);

  // ---------------------------------------------------------------- markers

  /** Animate so `r` fills the view. (fitView in React Flow 12 waits for the next node change.) */
  const zoomToRect = useCallback(
    (r: Rect, maxZoom = 1.5, padding = 0.08) => {
      const el = wrapperRef.current;
      if (!el) return;
      // Fit into the part of the screen not covered by the floating sidebar.
      const bounds = el.getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      const inset = sidebar ? Math.max(0, sidebar.right - bounds.left + 12) : 0;
      const availW = el.clientWidth - inset;
      const zoom = Math.min((availW * (1 - 2 * padding)) / r.w, (el.clientHeight * (1 - 2 * padding)) / r.h, maxZoom);
      void rf.setCenter(r.x + r.w / 2 - inset / 2 / zoom, r.y + r.h / 2, { zoom, duration: 550 });
    },
    [rf],
  );

  const goToMarker = useCallback(
    (index: number) => {
      const m = markers[index];
      if (!m) return;
      setMarkerIndex(index);
      if (m.cardId) {
        const node = rf.getNode(m.cardId);
        if (!node) {
          showToast(`“${m.name}” box no longer exists`);
          return;
        }
        zoomToRect(rectOf(node));
      } else {
        void rf.setCenter(m.x, m.y, { zoom: m.zoom, duration: 550 });
      }
    },
    [markers, rf, showToast, zoomToRect],
  );

  const addViewMarker = useCallback((at?: XYPosition) => {
    const center = at ?? insertPoint(false);
    // Name it after the box you're looking at, if any.
    const frame = rf
      .getNodes()
      .filter((n): n is Node<{ card: FrameCard }> => n.type === 'frame')
      .find((n) => contains(rectOf(n), { ...center, w: 0, h: 0 }));
    const name = frame?.data.card.data.title || `Spot ${markers.length + 1}`;
    void updateMarkers(board.id, (ms) => [...ms, { id: uid(), name, x: center.x, y: center.y, zoom: rf.getZoom() }]);
    setMarkerIndex(markers.length);
    showToast(keys(`Marked “${name}”. ⌘← / ⌘→ to jump between markers`));
  }, [board.id, insertPoint, markers.length, rf, showToast]);

  const toggleGlide = useCallback(() => {
    setGlide(!glide);
    showToast(glide ? 'Glide off' : 'Glide on: move the cursor to an edge to travel that way. G or Esc to stop');
  }, [glide, showToast]);

  // ---------------------------------------------------------------- radial wheel

  const wheelItems: WheelItem[] = useMemo(
    () => [
      { id: 'note', label: 'Note', icon: <StickyNote size={18} />, shortcut: 'N' },
      { id: 'text', label: 'Text', icon: <Type size={18} />, shortcut: 'T' },
      { id: 'code', label: 'Code', icon: <Code2 size={18} />, shortcut: 'C' },
      { id: 'link', label: 'Link', icon: <Link2 size={18} />, shortcut: 'L' },
      { id: 'image', label: 'Image', icon: <ImagePlus size={18} />, shortcut: 'I' },
      { id: 'box', label: 'Box', icon: <Frame size={18} />, shortcut: 'F' },
      { id: 'marker', label: 'Marker', icon: <BookmarkPlus size={18} />, shortcut: 'M' },
      { id: 'glide', label: glide ? 'Glide on' : 'Glide', icon: <Move size={18} />, shortcut: 'G', active: glide },
    ],
    [glide],
  );

  const closeLinkPrompt = useCallback(() => setLinkPrompt(null), []);

  const pickFromWheel = useCallback(
    (id: string) => {
      const w = wheel;
      setWheel(null);
      if (!w) return;
      switch (id) {
        case 'note':
          addNote(w.at);
          break;
        case 'text':
          addText(w.at);
          break;
        case 'code':
          addCode(w.at);
          break;
        case 'link':
          setLinkPrompt(w);
          break;
        case 'image':
          imageAt.current = w.at;
          fileInput.current?.click();
          break;
        case 'box':
          void addFrame(w.at);
          break;
        case 'marker':
          addViewMarker(w.at);
          break;
        case 'glide':
          toggleGlide();
          break;
      }
    },
    [wheel, addNote, addText, addCode, addFrame, addViewMarker, toggleGlide],
  );

  /**
   * Single click on the canvas. Inside a box: select the box (its body lets
   * clicks through, so this is how you pick it). On truly empty canvas: open
   * the wheel, unless the click was just to deselect or blur something.
   */
  const onPaneClick = useCallback(
    (e: MouseEvent) => {
      const { clientX, clientY } = e;
      window.clearTimeout(clickTimer.current);
      const at = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const box = rf
        .getNodes()
        .filter((n) => n.type === 'frame' && containsPoint(rectOf(n), at))
        .sort((a, b) => rectOf(a).w * rectOf(a).h - rectOf(b).w * rectOf(b).h)[0];
      if (box) {
        setNodes((ns) => ns.map((n) => (n.selected === (n.id === box.id) ? n : { ...n, selected: n.id === box.id })));
        setEdges((es) => (es.some((ed) => ed.selected) ? es.map((ed) => (ed.selected ? { ...ed, selected: false } : ed)) : es));
        return;
      }
      if (beforeClick.current.busy) return;
      // Wait a beat so a double-click (new note) doesn't also open the wheel.
      clickTimer.current = window.setTimeout(() => {
        const rect = wrapperRef.current!.getBoundingClientRect();
        setWheel({ x: clientX - rect.left, y: clientY - rect.top, at });
      }, 240);
    },
    [rf, setNodes, setEdges],
  );

  // ---------------------------------------------------------------- keyboard & clipboard

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !e.clipboardData) return;
      // Cards copied from a board (⌘C / ⌘X) paste back as cards, arrows and all.
      if (matchesClip(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'))) {
        e.preventDefault();
        void pasteClip(board.id, insertPoint()).then((ids) => {
          ids.forEach((id) => pendingSelect.current.add(id));
          void touchBoard(board.id);
        });
        return;
      }
      const items = incomingFromTransfer(e.clipboardData);
      if (!items.length) return;
      e.preventDefault();
      void addItems(items, insertPoint());
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape gets you out of everything: glide, the wheel, prompts, field
      // edits (fields blur themselves) and the current selection.
      if (e.key === 'Escape') {
        if (glide) {
          setGlide(false);
          showToast('Glide off');
        }
        setWheel(null);
        setLinkPrompt(null);
        if (isEditable(e.target)) (e.target as HTMLElement).blur();
        else {
          setNodes((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns));
          setEdges((es) => (es.some((ed) => ed.selected) ? es.map((ed) => (ed.selected ? { ...ed, selected: false } : ed)) : es));
        }
        return;
      }
      if (isEditable(e.target) || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      // (⌘⇧↑ / ⌘⇧↓ switch boards; handled in App.)
      if (mod && !e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (!markers.length) {
          showToast('No markers yet. Press M to mark this spot, or bookmark a box');
          return;
        }
        e.preventDefault();
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const from = markerIndex < 0 ? (step > 0 ? -1 : 0) : markerIndex;
        goToMarker((from + step + markers.length) % markers.length);
        return;
      }
      // ⌘C / ⌘X on selected cards (handled on the key: browsers don't fire a
      // native cut/copy when no text is selected). A box brings its contents.
      if (mod && !e.shiftKey && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        if (window.getSelection()?.toString()) return; // copying selected text
        const nodes = rf.getNodes();
        const selected = nodes.filter((n) => n.selected);
        if (!selected.length) return;
        e.preventDefault();
        const cut = e.key.toLowerCase() === 'x';
        const ids = new Set(selected.map((n) => n.id));
        for (const f of selected.filter((n) => n.type === 'frame')) {
          const fr = rectOf(f);
          for (const n of nodes) if (contains(fr, rectOf(n))) ids.add(n.id);
        }
        const clipId = uid();
        const summary = summarize(cards.filter((c) => ids.has(c.id)));
        void writeSystemClipboard(summary, clipHtml(clipId, summary));
        void captureClip(clipId, summary, [...ids]).then(() => {
          if (cut) void deleteCards([...ids]);
        });
        showToast(keys(`${cut ? 'Cut' : 'Copied'} ${ids.size} item${ids.size === 1 ? '' : 's'}. ⌘V to paste here or on another board`));
        return;
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        void addFrame();
        return;
      }
      if (mod || e.repeat) return;
      if (e.shiftKey && e.key === '!') {
        void rf.fitView({ duration: 450, maxZoom: 1, padding: 0.15 });
        return;
      }
      const at = insertPoint();
      switch (e.key.toLowerCase()) {
        case 'n':
          addNote(at);
          break;
        case 't':
          addText(at);
          break;
        case 'c':
          addCode(at);
          break;
        case 'f':
          void addFrame();
          break;
        case 'm':
          addViewMarker();
          break;
        case 'g':
          toggleGlide();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [addItems, insertPoint, addNote, addText, addCode, addFrame, addViewMarker, goToMarker, markers.length, markerIndex, rf, showToast, glide, toggleGlide, setNodes, setEdges, board.id, cards]);

  // First visit to a board with markers (like the tour): start at the first
  // marker instead of a zoomed-out overview, so ⌘→ reads like slides.
  const openedAtMarker = useRef(false);
  useEffect(() => {
    if (openedAtMarker.current || board.viewport || !markers.length || focusCardId) return;
    const first = markers[0];
    if (first.cardId && !rf.getNode(first.cardId)?.measured?.width) return; // wait for measurement
    openedAtMarker.current = true;
    goToMarker(0);
  }, [nodes, markers, board.viewport, focusCardId, goToMarker, rf]);

  // Jump to a card picked from search.
  useEffect(() => {
    if (!focusCardId) return;
    const node = rf.getNode(focusCardId);
    if (!node?.measured?.width) return; // wait until React Flow has measured it
    void rf.fitView({ nodes: [{ id: focusCardId }], duration: 450, maxZoom: 1.25, padding: 0.5 });
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === focusCardId })));
    onFocusHandled();
  }, [focusCardId, nodes, rf, setNodes, onFocusHandled]);

  // ---------------------------------------------------------------- frames carry their contents

  const frameDrag = useRef<{ starts: Map<string, XYPosition>; children: Map<string, XYPosition & { frameId: string }> } | null>(null);

  const onNodeDragStart = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      const frames = dragged.filter((n) => n.type === 'frame');
      if (!frames.length) {
        frameDrag.current = null;
        return;
      }
      const draggedIds = new Set(dragged.map((n) => n.id));
      const all = rf.getNodes();
      const children = new Map<string, XYPosition & { frameId: string }>();
      for (const f of frames) {
        const fr = rectOf(f);
        for (const n of all) {
          if (draggedIds.has(n.id) || children.has(n.id) || n.id === f.id) continue;
          if (contains(fr, rectOf(n))) children.set(n.id, { ...n.position, frameId: f.id });
        }
      }
      frameDrag.current = { starts: new Map(frames.map((f) => [f.id, { ...f.position }])), children };
    },
    [rf],
  );

  const onNodeDrag = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      const fd = frameDrag.current;
      if (!fd?.children.size) return;
      const delta = new Map<string, XYPosition>();
      for (const n of dragged) {
        const s = fd.starts.get(n.id);
        if (s) delta.set(n.id, { x: n.position.x - s.x, y: n.position.y - s.y });
      }
      setNodes((ns) =>
        ns.map((n) => {
          const c = fd.children.get(n.id);
          const d = c && delta.get(c.frameId);
          return d ? { ...n, position: { x: c.x + d.x, y: c.y + d.y } } : n;
        }),
      );
    },
    [setNodes],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      const ids = new Set([...dragged.map((n) => n.id), ...(frameDrag.current?.children.keys() ?? [])]);
      frameDrag.current = null;
      const moves = rf
        .getNodes()
        .filter((n) => ids.has(n.id))
        .map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
      void moveCards(moves);
    },
    [rf],
  );

  // ---------------------------------------------------------------- drag & drop / double-click

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent) => {
    const items = incomingFromTransfer(e.dataTransfer);
    if (!items.length) return;
    e.preventDefault();
    void addItems(items, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const onDoubleClick = (e: MouseEvent) => {
    window.clearTimeout(clickTimer.current);
    if (!(e.target as Element).classList.contains('react-flow__pane')) return;
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void addItems([{ kind: 'note', text: '' }], { x: at.x, y: at.y + 30 }, { edit: true, exact: true });
  };

  const canvasStyle = {
    '--canvas-bg': color.bg,
    '--canvas-ink': color.id === 'auto' ? 'var(--text)' : color.dark ? '#eef0f4' : '#22252b',
    '--canvas-ink-muted': color.id === 'auto' ? 'var(--text-3)' : color.dark ? 'rgba(238,240,244,0.55)' : 'rgba(34,37,43,0.5)',
  } as CSSProperties;

  return (
    <div
      ref={wrapperRef}
      className={`canvas${isDark ? ' canvas-dark' : ''}${connecting ? ' is-connecting' : ''}${glide ? ' gliding' : ''}`}
      style={canvasStyle}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        overUi.current = !!(e.target as Element).closest?.(UI_SELECTOR);
      }}
      onPointerLeave={() => (pointer.current = null)}
      onPointerDownCapture={() => {
        // Remember whether this click is "busy" (deselecting, finishing an edit,
        // closing a menu) so it doesn't also open the wheel.
        beforeClick.current.busy =
          !!wheel ||
          !!linkPrompt ||
          isEditable(document.activeElement) ||
          !!document.querySelector('.marker-menu, .appearance-menu') ||
          rf.getNodes().some((n) => n.selected) ||
          rf.getEdges().some((ed) => ed.selected);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={onDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="system"
        defaultViewport={board.viewport}
        fitView={!board.viewport}
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.05}
        maxZoom={4}
        // Figma-style navigation: scroll/trackpad pans, pinch or ⌘+scroll zooms,
        // drag on empty space box-selects, space/middle/right-drag pans.
        panOnScroll
        // ⌘ on a Mac, Ctrl elsewhere: hold it to zoom with the wheel or to add to a selection.
        zoomActivationKeyCode={IS_MAC ? 'Meta' : 'Control'}
        multiSelectionKeyCode={IS_MAC ? 'Meta' : 'Control'}
        zoomOnDoubleClick={false}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2, strokeDasharray: '6 5' }}
        isValidConnection={(c) => c.source !== c.target}
        onPaneClick={onPaneClick}
        onSelectionEnd={() => {
          // Boxes only count as selected when the drag fully encloses them, so
          // selecting a few cards inside a box doesn't grab the whole box.
          const r = lastSelectionRect.current;
          lastSelectionRect.current = null;
          if (!r) return;
          const vp = rf.getViewport();
          const area = { x: (r.x - vp.x) / vp.zoom, y: (r.y - vp.y) / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom };
          setNodes((ns) =>
            ns.map((n) => (n.type === 'frame' && n.selected && !contains(area, rectOf(n)) ? { ...n, selected: false } : n)),
          );
        }}
        onConnectStart={() => setConnecting(true)}
        onConnect={(c) => {
          void addEdge({
            boardId: board.id,
            source: c.source,
            target: c.target,
            sourceHandle: c.sourceHandle,
            targetHandle: c.targetHandle,
            color: 'ink',
            path: 'curve',
            dashed: false,
            arrows: 'end',
          });
        }}
        onConnectEnd={(event, state) => {
          setConnecting(false);
          if (state.isValid || !state.fromNode) return;
          const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
          const at = rf.screenToFlowPosition({ x: clientX, y: clientY });
          const fromId = state.fromNode.id;
          // Dropped anywhere on a card (not just its dot): connect to the side
          // nearest where you let go.
          const target = cardAt(at, fromId);
          if (target) {
            void addEdge({
              boardId: board.id,
              source: fromId,
              target: target.id,
              sourceHandle: state.fromHandle?.id ?? null,
              targetHandle: nearestSide(rectOf(target), at),
              color: 'ink',
              path: 'curve',
              dashed: false,
              arrows: 'end',
            });
            return;
          }
          // Dropped on empty canvas: create a note there and connect to it.
          const fromHandle = state.fromHandle?.id ?? null;
          void addItems([{ kind: 'note', text: '' }], { x: at.x, y: at.y + 40 }, { edit: true, exact: true }).then((created) => {
            const note = created[0];
            if (!note) return;
            const fromNode = rf.getNode(fromId);
            const noteRect = { x: note.x, y: note.y, w: note.width, h: 80 };
            void addEdge({
              boardId: board.id,
              source: fromId,
              target: note.id,
              sourceHandle: fromHandle,
              targetHandle: fromNode ? facingSides(rectOf(fromNode), noteRect)[1] : 't',
              color: 'ink',
              path: 'curve',
              dashed: false,
              arrows: 'end',
            });
          });
        }}
        // Grab an arrow by either end and drop it on another card to re-attach it.
        edgesReconnectable
        // A selected arrow floats above the cards so its ends can be grabbed
        // (otherwise the card's own connection dots sit on top of them).
        elevateEdgesOnSelect
        reconnectRadius={12}
        onReconnectStart={() => setConnecting(true)}
        onReconnectEnd={(event, edge, handleType, state) => {
          setConnecting(false);
          if (state.isValid) return;
          // Dropped an arrow end anywhere on a card: re-attach it there.
          const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
          const other = handleType === 'source' ? edge.target : edge.source;
          const at = rf.screenToFlowPosition({ x: clientX, y: clientY });
          const target = cardAt(at, other);
          if (!target) return;
          const side = nearestSide(rectOf(target), at);
          void patchEdge(edge.id, (e) => {
            if (handleType === 'source') {
              e.source = target.id;
              e.sourceHandle = side;
            } else {
              e.target = target.id;
              e.targetHandle = side;
            }
          });
        }}
        onReconnect={(old, c) => {
          if (c.source === c.target) return;
          void patchEdge(old.id, (e) => {
            e.source = c.source;
            e.target = c.target;
            e.sourceHandle = c.sourceHandle;
            e.targetHandle = c.targetHandle;
          });
        }}
        onEdgeDoubleClick={(_, edge) =>
          setEdges((es) => es.map((e) => (e.id === edge.id ? { ...e, data: { ...e.data!, editLabel: true } } : e)))
        }
        onEdgesDelete={(deleted: Edge[]) => void deleteEdges(deleted.map((e) => e.id))}
        onNodesDelete={(deleted) => void deleteCards(deleted.map((n) => n.id))}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={(_, viewport) => {
          window.clearTimeout(viewportTimer.current);
          viewportTimer.current = window.setTimeout(() => void saveViewport(board.id, viewport), 300);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasBackground pattern={appearance.pattern} color={color} />
        <SelectionRectTracker into={lastSelectionRect} />
        <LoadZoneTracker enabled={settings.lazyLoad} buffer={PRELOAD_SCREENS[settings.preload]} velocity={glideVelocity} />

        <Panel position="top-center" className="panel-flat">
          <MarkerBar
            markers={markers}
            current={markerIndex}
            onGo={goToMarker}
            onRename={(id, name) => void updateMarkers(board.id, (ms) => ms.map((m) => (m.id === id ? { ...m, name } : m)))}
            onRemove={(id) => {
              void updateMarkers(board.id, (ms) => ms.filter((m) => m.id !== id));
              setMarkerIndex(-1);
            }}
          />
        </Panel>

        <Panel position="top-right" className="panel-flat">
          <AppearanceMenu value={appearance} onChange={(next) => void setAppearance(board.id, next)} />
        </Panel>

        <Panel position="bottom-center" className="panel-flat">
          <Dock
            onNote={() => addNote()}
            onText={() => addText()}
            onCode={() => addCode()}
            onFrame={() => void addFrame()}
            onMarker={addViewMarker}
            glide={glide}
            onGlide={toggleGlide}
            onArrowHint={() => showToast('Hover a card and drag from a dot on its edge to another card, or to empty space for a new note')}
          />
        </Panel>

        <Panel position="bottom-left" className="panel-flat">
          <ZoomPill
            minimap={minimap}
            onToggleMinimap={() =>
              setMinimap((m) => {
                try {
                  localStorage.setItem('codeboard:minimap', m ? '0' : '1');
                } catch {
                  /* ignore */
                }
                return !m;
              })
            }
          />
        </Panel>

        {minimap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeBorderRadius={6}
            nodeColor={(n) => MINIMAP_COLORS[(n as CardNode).data.card.type]}
            maskColor="rgba(120,120,140,0.14)"
          />
        )}

        {wheel && <RadialMenu x={wheel.x} y={wheel.y} items={wheelItems} onPick={pickFromWheel} onClose={() => setWheel(null)} />}
        {linkPrompt && (
          <LinkPrompt
            x={linkPrompt.x}
            y={linkPrompt.y}
            onClose={closeLinkPrompt}
            onSubmit={(value) => void addItems(classifyText(value), linkPrompt.at)}
          />
        )}

        {toast && (
          <Panel position="bottom-center" className="panel-flat toast-panel">
            <div className="toast glass">{toast}</div>
          </Panel>
        )}

        {cards.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">Paste anything here</div>
            <div className="empty-sub">
              Screenshots, code, links or text with <kbd>{MOD}</kbd>
              <kbd>V</kbd>
              <br />
              Drop files in, or double-click to write a note
            </div>
          </div>
        )}
      </ReactFlow>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          const at = imageAt.current ?? insertPoint(false);
          if (files.length) void addItems(files.map((file): Incoming => ({ kind: 'image', file, name: file.name })), at);
        }}
      />
    </div>
  );
}
