import { db, uid, type Card } from '../db';
import type { Incoming } from '../lib/classify';
import { detectLanguage } from '../lib/code';

export interface Built {
  card: Card;
  /** Estimated rendered height, used to centre the card on the drop point. */
  height: number;
}

/** Cards that should open straight into edit mode when they first render. */
export const autoEdit = new Set<string>();

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const isSvg = (blob: Blob) => blob.type === 'image/svg+xml';

/**
 * Decode an image just enough to learn its size. `createImageBitmap` can't
 * read SVG, so SVGs (and anything else it rejects) go through an <img>,
 * falling back to the SVG's viewBox when it declares no width/height.
 */
export async function imageSize(blob: Blob): Promise<{ w: number; h: number } | null> {
  if (!isSvg(blob)) {
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (bitmap) {
      const size = { w: bitmap.width, h: bitmap.height };
      bitmap.close();
      return size;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if ((!w || !h) && isSvg(blob)) {
      const vb = (await blob.text()).match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      if (vb) {
        w = Number(vb[1]);
        h = Number(vb[2]);
      }
    }
    return w && h ? { w, h } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function buildCard(boardId: string, item: Incoming): Promise<Built | null> {
  const now = Date.now();
  const base = { id: uid(), boardId, x: 0, y: 0, createdAt: now, updatedAt: now };

  switch (item.kind) {
    case 'image': {
      const size = await imageSize(item.file);
      if (!size) return null;
      const { w: nw, h: nh } = size;
      // Screenshots are captured at device resolution; show them at "real" size.
      // SVG sizes are already in CSS pixels.
      const scale = isSvg(item.file) ? 1 : window.devicePixelRatio || 1;
      const width = Math.round(clamp(nw / scale, 80, 560));
      const blobId = uid();
      await db.blobs.add({ id: blobId, blob: item.file });
      return {
        card: { ...base, type: 'image', width, data: { blobId, naturalWidth: nw, naturalHeight: nh, name: item.name } },
        height: (width * nh) / nw,
      };
    }
    case 'textfile': {
      const code = await item.file.text();
      return codeCard(base, code, detectLanguage(code, item.file.name), item.file.name);
    }
    case 'code':
      return codeCard(base, item.code, item.language ?? detectLanguage(item.code), item.title);
    case 'link':
      return {
        card: { ...base, type: 'link', width: 320, data: { url: item.url, status: 'loading' } },
        height: 280,
      };
    case 'note': {
      const width = item.text.length > 320 ? 360 : 260;
      const lines = Math.ceil(item.text.length / (width / 8)) + (item.text.match(/\n/g)?.length ?? 0);
      return {
        card: { ...base, type: 'note', width, data: { text: item.text, color: item.color ?? 'yellow', size: item.size } },
        height: clamp(lines * 21 + 32, 80, 420),
      };
    }
  }
}

function codeCard(base: Omit<Card, 'type' | 'data' | 'width'>, code: string, language: string, title?: string): Built {
  const lines = code.split('\n');
  const longest = Math.max(0, ...lines.map((l) => l.replace(/\t/g, '  ').length));
  return {
    card: { ...base, type: 'code', width: Math.round(clamp(longest * 7.4 + 44, 300, 760)), data: { code, language, title } },
    height: Math.min(lines.length * 19.5 + 56, 476),
  };
}
