import type { BoardAppearance } from './db';

export interface PatternDef {
  id: string;
  label: string;
}

export const PATTERNS: PatternDef[] = [
  { id: 'dots', label: 'Dots' },
  { id: 'dots-dense', label: 'Fine dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'graph', label: 'Math paper' },
  { id: 'ruled', label: 'Notebook' },
  { id: 'iso', label: 'Isometric' },
  { id: 'cross', label: 'Crosses' },
  { id: 'blank', label: 'Blank' },
];

export interface CanvasColor {
  id: string;
  label: string;
  /** Canvas background. */
  bg: string;
  /** Minor pattern colour. */
  ink: string;
  /** Major lines (math paper) and the notebook margin. */
  major: string;
  margin?: string;
  /** Whether text drawn straight on the canvas should be light. */
  dark: boolean;
}

/** `auto` follows the app's light/dark theme; the rest look the same in both. */
export const CANVAS_COLORS: CanvasColor[] = [
  { id: 'auto', label: 'Auto', bg: 'var(--canvas)', ink: 'var(--dot)', major: 'var(--dot-major)', dark: false },
  { id: 'paper', label: 'Paper', bg: '#f8f5ee', ink: '#ddd5c4', major: '#c9bea6', margin: '#e9a3a0', dark: false },
  { id: 'math', label: 'Math', bg: '#fbfcfe', ink: '#d5e3f1', major: '#a9c6e2', margin: '#f0a5a5', dark: false },
  { id: 'sand', label: 'Sand', bg: '#f1e8d6', ink: '#dccdae', major: '#c8b48c', dark: false },
  { id: 'sage', label: 'Sage', bg: '#e5ece2', ink: '#c7d4c1', major: '#a9bda1', dark: false },
  { id: 'lilac', label: 'Lilac', bg: '#efebf7', ink: '#d8d0ea', major: '#bcb0db', dark: false },
  { id: 'blueprint', label: 'Blueprint', bg: '#1c4a85', ink: 'rgba(255,255,255,0.13)', major: 'rgba(255,255,255,0.3)', margin: 'rgba(255,255,255,0.4)', dark: true },
  { id: 'chalk', label: 'Chalkboard', bg: '#22332c', ink: 'rgba(255,255,255,0.1)', major: 'rgba(255,255,255,0.22)', dark: true },
  { id: 'midnight', label: 'Midnight', bg: '#0f131b', ink: '#222a38', major: '#323d50', dark: true },
  { id: 'graphite', label: 'Graphite', bg: '#1b1b1d', ink: '#2f2f33', major: '#45454b', dark: true },
];

export const DEFAULT_APPEARANCE: BoardAppearance = { pattern: 'dots', color: 'auto' };

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Resolve a preset id or custom hex to concrete colours. */
export function resolveColor(color: string): CanvasColor {
  const preset = CANVAS_COLORS.find((c) => c.id === color);
  if (preset) return preset;
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const dark = luminance(color) < 0.3;
    const overlay = dark ? '255,255,255' : '0,0,0';
    return {
      id: color,
      label: 'Custom',
      bg: color,
      ink: `rgba(${overlay},${dark ? 0.12 : 0.1})`,
      major: `rgba(${overlay},${dark ? 0.25 : 0.2})`,
      dark,
    };
  }
  return CANVAS_COLORS[0];
}
