import { useSyncExternalStore } from 'react';

/** App-wide preferences (not per board), kept in localStorage. */
export interface Settings {
  /** Only load heavy card content (images, link previews, code) near the view. */
  lazyLoad: boolean;
  /** How far beyond the screen to keep things loaded. */
  preload: 'near' | 'medium' | 'far';
  /** Show the built-in tour boards (sidebar section, board switching, search). */
  showTour: boolean;
}

/** Extra screens of content kept loaded on each side of the view. */
export const PRELOAD_SCREENS: Record<Settings['preload'], number> = { near: 0.5, medium: 1, far: 2 };

const KEY = 'codeboard:settings';
const DEFAULTS: Settings = { lazyLoad: false, preload: 'medium', showTour: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let state = load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: setting lasts for this session */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
