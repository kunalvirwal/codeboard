import { useInternalNode } from '@xyflow/react';
import { useRef, useSyncExternalStore } from 'react';

/**
 * The "load zone": the part of the board (in flow coordinates) where cards
 * render their full content. It's the visible area plus a margin, stretched
 * ahead in the direction of travel while gliding. `null` means everything
 * loads (the setting is off).
 *
 * Cards outside the zone stay on the board, so arrows, boxes, the minimap
 * and search keep working, but they render a lightweight placeholder: no
 * decoded images, no link preview images, no syntax highlighting.
 */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let zone: ZoneRect | null = null;
const listeners = new Set<() => void>();

export function setLoadZone(next: ZoneRect | null) {
  zone = next;
  listeners.forEach((l) => l());
}

export function getLoadZone() {
  return zone;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Cards have a 1px border on each side; the placeholder sits inside it. */
const BORDER = 2;

/**
 * Whether card `id` should render its full content, plus the height to give
 * its placeholder so the card keeps its size while unloaded.
 */
export function useNearView(id: string, fallbackHeight: number) {
  const node = useInternalNode(id);
  // Last height measured while the real content was showing. Only recorded
  // then: measuring the placeholder itself would feed its own size (plus the
  // border) back in and grow the card a little on every render.
  const liveHeight = useRef<number | undefined>(undefined);
  const measured = node?.measured.height;

  const x = node?.internals.positionAbsolute.x ?? 0;
  const y = node?.internals.positionAbsolute.y ?? 0;
  const w = node?.measured.width ?? node?.width ?? 0;
  const h = measured ?? node?.height ?? fallbackHeight;
  const selected = node?.selected ?? false;

  const near = useSyncExternalStore(subscribe, () => {
    const z = zone;
    if (!z || !node || selected) return true;
    return x < z.x + z.w && x + w > z.x && y < z.y + z.h && y + h > z.y;
  });

  if (near && measured) liveHeight.current = measured;
  const outer = liveHeight.current ?? node?.height ?? fallbackHeight;
  return { near, height: Math.max(0, outer - BORDER) };
}
