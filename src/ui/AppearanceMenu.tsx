import { Palette, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CANVAS_COLORS, PATTERNS, resolveColor } from '../appearance';
import type { BoardAppearance } from '../db';

interface Props {
  value: BoardAppearance;
  onChange: (next: BoardAppearance) => void;
}

/** Board background picker: pattern + canvas colour. */
export function AppearanceMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const resolved = resolveColor(value.color);
  const isCustom = !CANVAS_COLORS.some((c) => c.id === value.color);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="appearance" ref={ref}>
      <button type="button" className={`icon-pill glass${open ? ' active' : ''}`} title="Background" onClick={() => setOpen((o) => !o)}>
        <Palette size={17} />
      </button>
      {open && (
        <div className="appearance-menu glass">
          <div className="menu-label">Pattern</div>
          <div className="pattern-grid">
            {PATTERNS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pattern-tile${p.id === value.pattern ? ' active' : ''}`}
                onClick={() => onChange({ ...value, pattern: p.id })}
              >
                <span
                  className={`pattern-preview pat-${p.id}`}
                  style={{ '--pv-bg': resolved.bg, '--pv-ink': resolved.ink, '--pv-major': resolved.major } as CSSProperties}
                />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="menu-label">Canvas colour</div>
          <div className="color-grid">
            {CANVAS_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                className={`color-tile${c.id === value.color ? ' active' : ''}`}
                onClick={() => onChange({ ...value, color: c.id })}
              >
                <span className={`color-swatch${c.id === 'auto' ? ' auto' : ''}`} style={{ background: c.id === 'auto' ? undefined : c.bg }} />
                <span>{c.label}</span>
              </button>
            ))}
            <label className={`color-tile${isCustom ? ' active' : ''}`} title="Pick any colour">
              <span className="color-swatch custom" style={isCustom ? { background: value.color } : undefined}>
                {!isCustom && <Plus size={14} />}
              </span>
              <span>Custom</span>
              <input
                type="color"
                value={isCustom ? value.color : '#f4f1ea'}
                onChange={(e) => onChange({ ...value, color: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
