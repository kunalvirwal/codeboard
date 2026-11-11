import { db, uid, type BoardEdge, type Card } from '../db';

/**
 * In-app clipboard for cards. The system clipboard only gets a text summary
 * (handy for pasting into a chat) plus a marker; the real payload, including
 * image data, lives here in memory so it survives a cut deleting the originals
 * and can be pasted onto any board.
 */
interface ClipPayload {
  id: string;
  /** Plain-text summary also placed on the system clipboard. */
  summary: string;
  cards: Card[];
  edges: BoardEdge[];
  blobs: Map<string, Blob>;
}

let clip: ClipPayload | null = null;

const blobIdOf = (c: Card) =>
  c.type === 'image' ? c.data.blobId : c.type === 'link' ? c.data.imageBlobId : undefined;

export function summarize(cards: Card[]): string {
  return cards
    .map((c) => {
      switch (c.type) {
        case 'note':
          return c.data.text;
        case 'code':
          return '```' + (c.data.language === 'plaintext' ? '' : c.data.language) + '\n' + c.data.code + '\n```';
        case 'link':
          return c.data.preview?.title ? `${c.data.preview.title}: ${c.data.url}` : c.data.url;
        case 'frame':
          return c.data.title ? `## ${c.data.title}` : '';
        case 'image':
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Snapshot cards (and arrows between them, and their images) into the clipboard. */
export async function captureClip(id: string, summary: string, cardIds: string[]): Promise<void> {
  const cards = (await db.cards.bulkGet(cardIds)).filter((c): c is Card => !!c);
  const ids = new Set(cards.map((c) => c.id));
  const edges = (await db.edges.where('source').anyOf([...ids]).toArray()).filter((e) => ids.has(e.target));
  const blobs = new Map<string, Blob>();
  for (const c of cards) {
    const blobId = blobIdOf(c);
    const stored = blobId ? await db.blobs.get(blobId) : undefined;
    if (blobId && stored) blobs.set(blobId, stored.blob);
  }
  clip = { id, summary, cards: structuredClone(cards), edges: structuredClone(edges), blobs };
}

/** True when the system clipboard still holds our last copy (not something copied since). */
export function matchesClip(html: string, text: string): boolean {
  if (!clip) return false;
  // The id is written as both a data attribute and a class, since clipboard
  // HTML sanitizers don't always keep data attributes.
  const marker = html.match(/data-codeboard-clip="([^"]+)"/)?.[1] ?? html.match(/codeboard-clip-([\w-]+)/)?.[1];
  return marker ? marker === clip.id : text === clip.summary && text !== '';
}

export function clipHtml(id: string, summary: string) {
  const escaped = summary.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<div class="codeboard-clip-${id}" data-codeboard-clip="${id}"><pre>${escaped}</pre></div>`;
}

/**
 * Put text + marker HTML on the system clipboard from a key handler. Uses the
 * async Clipboard API, falling back to a synthetic copy command.
 */
export async function writeSystemClipboard(text: string, html: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  } catch {
    /* not allowed here; try the legacy route */
  }
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', text);
    e.clipboardData?.setData('text/html', html);
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy, { once: true });
  document.execCommand('copy');
  document.removeEventListener('copy', onCopy);
}

export const hasClip = () => !!clip;
export const currentClipId = () => clip?.id ?? null;

/**
 * Paste the clipboard onto `boardId`, centred on `at`. Everything gets fresh
 * ids so pasting twice gives two independent copies. Returns the new card ids.
 */
export async function pasteClip(boardId: string, at: { x: number; y: number }): Promise<string[]> {
  if (!clip || !clip.cards.length) return [];
  const { cards, edges, blobs } = clip;

  const minX = Math.min(...cards.map((c) => c.x));
  const minY = Math.min(...cards.map((c) => c.y));
  const maxX = Math.max(...cards.map((c) => c.x + c.width));
  const maxY = Math.max(...cards.map((c) => c.y + (c.height ?? 160)));
  const dx = Math.round(at.x - (minX + maxX) / 2);
  const dy = Math.round(at.y - (minY + maxY) / 2);

  const idMap = new Map<string, string>();
  const blobMap = new Map<string, string>();
  for (const c of cards) idMap.set(c.id, uid());
  for (const old of blobs.keys()) blobMap.set(old, uid());

  const now = Date.now();
  const newCards: Card[] = cards.map((c, i) => {
    const copy = structuredClone(c);
    copy.id = idMap.get(c.id)!;
    copy.boardId = boardId;
    copy.x = c.x + dx;
    copy.y = c.y + dy;
    copy.createdAt = now + i; // keep the original stacking order
    copy.updatedAt = now;
    if (copy.type === 'image') copy.data.blobId = blobMap.get(copy.data.blobId) ?? copy.data.blobId;
    if (copy.type === 'link' && copy.data.imageBlobId) copy.data.imageBlobId = blobMap.get(copy.data.imageBlobId);
    return copy;
  });
  const newEdges: BoardEdge[] = edges.map((e) => ({
    ...structuredClone(e),
    id: uid(),
    boardId,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
    createdAt: now,
  }));

  await db.transaction('rw', [db.cards, db.edges, db.blobs], async () => {
    await db.blobs.bulkAdd([...blobs].map(([old, blob]) => ({ id: blobMap.get(old)!, blob })));
    await db.cards.bulkAdd(newCards);
    await db.edges.bulkAdd(newEdges);
  });
  return newCards.map((c) => c.id);
}
