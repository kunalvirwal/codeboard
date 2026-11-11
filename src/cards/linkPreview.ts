import { db, patchCard, uid, type LinkPreview } from '../db';

const inflight = new Set<string>();

/** Bump when the server returns meaningfully better previews, so existing cards refresh once. */
export const PREVIEW_VERSION = 4;

async function postJson(path: string, body: unknown) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Download the preview image through our server and keep it in IndexedDB. */
async function saveImage(imageUrl: string): Promise<string | undefined> {
  try {
    const res = await postJson('/api/image', { url: imageUrl });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    const id = uid();
    await db.blobs.add({ id, blob });
    return id;
  } catch {
    return undefined; // the card falls back to the remote URL
  }
}

/** Fetch a preview through our own server (browsers can't read other sites directly). */
export async function loadPreview(cardId: string, url: string) {
  if (inflight.has(cardId)) return;
  inflight.add(cardId);
  try {
    const res = await postJson('/api/preview', { url });
    const preview = (await res.json().catch(() => ({}))) as LinkPreview & { error?: string };
    if (!res.ok) throw new Error(preview.error ?? `HTTP ${res.status}`);
    const imageBlobId = preview.image ? await saveImage(preview.image) : undefined;

    let oldBlob: string | undefined;
    await patchCard(cardId, (c) => {
      if (c.type !== 'link') return;
      oldBlob = c.data.imageBlobId;
      c.data.status = 'ok';
      c.data.preview = preview;
      c.data.version = PREVIEW_VERSION;
      c.data.imageBlobId = imageBlobId;
      delete c.data.error;
    });
    if (oldBlob && oldBlob !== imageBlobId) await db.blobs.delete(oldBlob);
  } catch (err) {
    await patchCard(cardId, (c) => {
      if (c.type !== 'link') return;
      c.data.status = 'error';
      c.data.version = PREVIEW_VERSION;
      c.data.error = err instanceof Error ? err.message : String(err);
    });
  } finally {
    inflight.delete(cardId);
  }
}
