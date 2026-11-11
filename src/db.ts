import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { buildTour } from './tour';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardAppearance {
  /** Pattern id from appearance.ts */
  pattern: string;
  /** Canvas colour preset id from appearance.ts, or a custom `#rrggbb`. */
  color: string;
}

/**
 * A saved spot to jump between with ⌘←/⌘→ (or ⌘↑/⌘↓). Either a view
 * (centre point in flow coordinates + zoom) or a frame (zooms to fit it).
 */
export interface Marker {
  id: string;
  name: string;
  x: number;
  y: number;
  zoom: number;
  /** Set when the marker points at a frame; the frame's live bounds win over x/y/zoom. */
  cardId?: string;
}

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport?: Viewport;
  appearance?: BoardAppearance;
  markers?: Marker[];
  /** One of the built-in tour boards (shown in the sidebar's Tour section). */
  tour?: boolean;
}

/** `none` = no background: free-floating text on the canvas. */
export const NOTE_COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'gray', 'black', 'none'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_FONTS = ['sans', 'serif', 'mono', 'hand'] as const;
export type NoteFont = (typeof NOTE_FONTS)[number];
export const NOTE_SIZES = ['s', 'm', 'l', 'xl'] as const;
export type NoteSize = (typeof NOTE_SIZES)[number];

export interface NoteData {
  text: string;
  color: NoteColor;
  font?: NoteFont;
  size?: NoteSize;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Written with Mac shortcut symbols; shown with Ctrl/Shift/... on other platforms (tour notes). */
  localizeKeys?: boolean;
}

export const FRAME_COLORS = ['gray', 'blue', 'purple', 'pink', 'orange', 'green'] as const;
export type FrameColor = (typeof FRAME_COLORS)[number];

export interface FrameData {
  title: string;
  color: FrameColor;
}

export interface CodeData {
  code: string;
  language: string;
  /** Optional label, e.g. the filename when a file was dropped. */
  title?: string;
}

export interface ImageCardData {
  blobId: string;
  naturalWidth: number;
  naturalHeight: number;
  name?: string;
}

export interface GithubInfo {
  kind: 'pull' | 'issue';
  state: 'open' | 'closed' | 'merged' | 'draft';
  repo: string;
  number: number;
}

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  /** Larger icon, shown as a banner when there's no image. */
  logo?: string;
  /** The site couldn't be read; title was guessed from the URL. */
  partial?: boolean;
  /** 'image': the picture is the point (e.g. a Pinterest pin); show it full, no text. */
  display?: 'image';
  github?: GithubInfo;
}

export interface LinkData {
  url: string;
  status: 'loading' | 'ok' | 'error';
  preview?: LinkPreview;
  error?: string;
  /** Preview format version; older cards re-fetch once when the format improves. */
  version?: number;
  /** Local copy of preview.image, so the card survives the remote image going away. */
  imageBlobId?: string;
  /** Image-first cards: resize without distorting the picture. Defaults to on. */
  keepAspect?: boolean;
}

interface CardBase {
  id: string;
  boardId: string;
  x: number;
  y: number;
  width: number;
  /** Undefined means "size to content" until the user resizes the card. */
  height?: number;
  /** Degrees clockwise, 0–359 (image and pin cards). */
  rotation?: number;
  createdAt: number;
  updatedAt: number;
}

export type NoteCard = CardBase & { type: 'note'; data: NoteData };
export type CodeCard = CardBase & { type: 'code'; data: CodeData };
export type ImageCard = CardBase & { type: 'image'; data: ImageCardData };
export type LinkCard = CardBase & { type: 'link'; data: LinkData };
/** A translucent box that groups the cards inside it. */
export type FrameCard = CardBase & { type: 'frame'; data: FrameData };
export type Card = NoteCard | CodeCard | ImageCard | LinkCard | FrameCard;
export type CardType = Card['type'];

export interface StoredBlob {
  id: string;
  blob: Blob;
}

export const EDGE_COLORS = ['ink', 'gray', 'black', 'blue', 'purple', 'pink', 'orange', 'green'] as const;
export type EdgeColor = (typeof EDGE_COLORS)[number];

/** An arrow between two cards. */
export interface BoardEdge {
  id: string;
  boardId: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  color: EdgeColor;
  path: 'curve' | 'straight' | 'step';
  dashed: boolean;
  arrows: 'end' | 'both' | 'none';
  label?: string;
  /** Label uses Mac shortcut symbols; shown with Ctrl/Shift/... on other platforms (tour arrows). */
  localizeKeys?: boolean;
  createdAt: number;
}

export const db = new Dexie('codeboard') as Dexie & {
  boards: EntityTable<Board, 'id'>;
  cards: EntityTable<Card, 'id'>;
  blobs: EntityTable<StoredBlob, 'id'>;
  edges: EntityTable<BoardEdge, 'id'>;
};

db.version(1).stores({
  boards: 'id, createdAt',
  cards: 'id, boardId',
  blobs: 'id',
});
db.version(2).stores({
  edges: 'id, boardId, source, target',
});
// v3: existing users get the tour boards once (added at the end of their list).
db.version(3)
  .stores({ boards: 'id, createdAt' })
  .upgrade((tx) => {
    writeTour(tx);
  });
// v4: flag the tour boards added by v3 so they get their own sidebar section.
db.version(4)
  .stores({ boards: 'id, createdAt' })
  .upgrade((tx) =>
    tx
      .table('boards')
      .toCollection()
      .modify((b: Board) => {
        if (b.name.startsWith('Tour ')) b.tour = true;
      }),
  );

/** Queue the tour boards into a transaction; returns the first tour board's id. */
function writeTour(tx: Transaction, startTime?: number) {
  const tour = buildTour(startTime);
  void tx.table('blobs').bulkAdd(tour.blobs);
  void tx.table('boards').bulkAdd(tour.boards);
  void tx.table('cards').bulkAdd(tour.cards);
  void tx.table('edges').bulkAdd(tour.edges);
  return tour.boards[0].id;
}

// First run: the tour (opened first), then an empty Inbox to paste into.
db.on('populate', (tx) => {
  const firstId = writeTour(tx, Date.now() - 1000);
  void tx.table('boards').add(newBoard('Inbox'));
  try {
    localStorage.setItem('codeboard:active-board', firstId);
  } catch {
    /* storage unavailable: the app opens the first board anyway */
  }
});

/**
 * Settings → "Refresh tour boards": throw away the current tour boards (edits
 * included) and put fresh copies back, recreating any that were deleted.
 * Boards that aren't tour boards are never touched. Returns the first tour board's id.
 */
export async function refreshTourBoards(): Promise<string> {
  let firstId = '';
  await db.transaction('rw', [db.boards, db.cards, db.edges, db.blobs], async (tx) => {
    const old = (await db.boards.toArray()).filter((b) => b.tour);
    for (const b of old) {
      const cards = await db.cards.where('boardId').equals(b.id).toArray();
      await db.blobs.bulkDelete(blobIdsOf(cards));
      await db.cards.bulkDelete(cards.map((c) => c.id));
      await db.edges.where('boardId').equals(b.id).delete();
      await db.boards.delete(b.id);
    }
    firstId = writeTour(tx);
  });
  return firstId;
}

export const uid = () => crypto.randomUUID();

function newBoard(name: string): Board {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now };
}

export async function createBoard(name: string): Promise<Board> {
  const board = newBoard(name);
  await db.boards.add(board);
  return board;
}

export async function renameBoard(id: string, name: string) {
  await db.boards.update(id, { name, updatedAt: Date.now() });
}

export async function saveViewport(id: string, viewport: Viewport) {
  await db.boards.update(id, { viewport });
}

export async function touchBoard(id: string) {
  await db.boards.update(id, { updatedAt: Date.now() });
}

function blobIdsOf(cards: Card[]) {
  return cards.flatMap((c) => {
    if (c.type === 'image') return [c.data.blobId];
    if (c.type === 'link' && c.data.imageBlobId) return [c.data.imageBlobId];
    return [];
  });
}

export async function updateMarkers(boardId: string, fn: (markers: Marker[]) => Marker[]) {
  await db.transaction('rw', db.boards, async () => {
    const board = await db.boards.get(boardId);
    if (board) await db.boards.update(boardId, { markers: fn(board.markers ?? []) });
  });
}

export async function setAppearance(id: string, appearance: BoardAppearance) {
  await db.boards.update(id, { appearance });
}

export async function deleteBoard(id: string) {
  await db.transaction('rw', [db.boards, db.cards, db.blobs, db.edges], async () => {
    const cards = await db.cards.where('boardId').equals(id).toArray();
    await db.blobs.bulkDelete(blobIdsOf(cards));
    await db.cards.bulkDelete(cards.map((c) => c.id));
    await db.edges.where('boardId').equals(id).delete();
    await db.boards.delete(id);
  });
}

export async function addEdge(edge: Omit<BoardEdge, 'id' | 'createdAt'>) {
  await db.edges.add({ ...edge, id: uid(), createdAt: Date.now() });
}

export async function patchEdge(id: string, fn: (edge: BoardEdge) => void) {
  await db.edges.where('id').equals(id).modify(fn);
}

export async function deleteEdges(ids: string[]) {
  await db.edges.bulkDelete(ids);
}

/** Mutate a card in place; `updatedAt` is bumped automatically. */
export async function patchCard(id: string, fn: (card: Card) => void) {
  await db.cards
    .where('id')
    .equals(id)
    .modify((card) => {
      fn(card);
      card.updatedAt = Date.now();
    });
}

/** Move many cards in one transaction (so live queries see a single update). */
export async function moveCards(moves: { id: string; x: number; y: number }[]) {
  if (!moves.length) return;
  const now = Date.now();
  await db.transaction('rw', db.cards, async () => {
    for (const m of moves) {
      await db.cards.where('id').equals(m.id).modify((c) => {
        c.x = m.x;
        c.y = m.y;
        c.updatedAt = now;
      });
    }
  });
}

export async function deleteCards(ids: string[]) {
  if (!ids.length) return;
  await db.transaction('rw', [db.cards, db.blobs, db.edges], async () => {
    const cards = (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c);
    await db.blobs.bulkDelete(blobIdsOf(cards));
    await db.cards.bulkDelete(ids);
    // Arrows attached to a deleted card go with it.
    await db.edges.where('source').anyOf(ids).delete();
    await db.edges.where('target').anyOf(ids).delete();
  });
}
