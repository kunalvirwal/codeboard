/**
 * Shortcuts are written Mac-style throughout the app (⌘, ⇧, ⌫). On Windows
 * and Linux, `keys()` rewrites them to what's printed on those keyboards:
 * "⌘⇧↓" -> "Ctrl+Shift+↓", "⌫" -> "Backspace". The key handlers themselves
 * already accept Ctrl wherever they accept ⌘.
 */

const platform =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
  navigator.platform ||
  navigator.userAgent;

export const IS_MAC = /mac|iphone|ipad|ipod/i.test(platform);
export const IS_WINDOWS = /win/i.test(platform);

/** The main modifier's name, for prose like "hold ⌘ and scroll". */
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

const MODIFIERS: Record<string, string> = { '⌘': 'Ctrl', '⇧': 'Shift', '⌥': 'Alt', '⌃': 'Ctrl' };

/** Localise every Mac-style shortcut inside `text` (a single key or a whole sentence). */
export function keys(text: string): string {
  if (IS_MAC) return text;
  return (
    text
      // macOS "snip to clipboard" has its own equivalent on each platform.
      .replace(/⌘⇧⌃4/g, IS_WINDOWS ? 'Win+Shift+S' : 'PrtSc')
      // A run of modifiers, optionally followed by one key: ⌘⇧↓ -> Ctrl+Shift+↓.
      .replace(/([⌘⇧⌥⌃]+)([A-Za-z0-9←→↑↓\\]|⌫)?/g, (_, mods: string, key?: string) => {
        const parts = [...new Set([...mods].map((m) => MODIFIERS[m]))];
        if (key) parts.push(key === '⌫' ? 'Backspace' : key.toUpperCase());
        return parts.join('+');
      })
      .replace(/⌫/g, 'Backspace')
  );
}
