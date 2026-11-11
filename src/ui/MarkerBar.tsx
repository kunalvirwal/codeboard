import { Bookmark, ChevronDown, ChevronLeft, ChevronRight, Frame, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Marker } from '../db';
import { MOD, keys } from '../lib/keys';

interface MarkerBarProps {
  markers: Marker[];
  current: number;
  onGo: (index: number) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

/** Top-centre navigator: ‹ name (2/5) › with a list of all markers. */
export function MarkerBar({ markers, current, onGo, onRename, onRemove }: MarkerBarProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  if (!markers.length) return null;
  const active = markers[current];
  const n = markers.length;

  return (
    <div className="marker-bar glass" ref={ref}>
      <button type="button" className="marker-step" title={keys('Previous marker (⌘← or ⌘↑)')} onClick={() => onGo((current - 1 + n) % n)}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" className="marker-current" onClick={() => setOpen((o) => !o)}>
        <Bookmark size={13} fill="currentColor" />
        <span className="marker-name">{active ? active.name : 'Markers'}</span>
        <span className="marker-count">{active ? `${current + 1}/${n}` : n}</span>
        <ChevronDown size={14} />
      </button>
      <button type="button" className="marker-step" title={keys('Next marker (⌘→ or ⌘↓)')} onClick={() => onGo((current + 1) % n)}>
        <ChevronRight size={16} />
      </button>

      {open && (
        <div className="marker-menu glass">
          {markers.map((m, i) => (
            <div key={m.id} className={`marker-item${i === current ? ' active' : ''}`} onClick={() => onGo(i)}>
              <span className="marker-index">{i + 1}</span>
              {m.cardId ? <Frame size={13} /> : <Bookmark size={13} />}
              {renaming === m.id ? (
                <input
                  autoFocus
                  defaultValue={m.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    setRenaming(null);
                    const name = e.currentTarget.value.trim();
                    if (name && name !== m.name) onRename(m.id, name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                  }}
                />
              ) : (
                <span
                  className="marker-item-name"
                  title="Double-click to rename"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming(m.id);
                  }}
                >
                  {m.name}
                </span>
              )}
              <button
                type="button"
                className="marker-remove"
                title="Remove marker"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(m.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="marker-hint">
            <kbd>{MOD}</kbd>
            <kbd>←</kbd>
            <kbd>→</kbd> or <kbd>↑</kbd>
            <kbd>↓</kbd> to jump · <kbd>M</kbd> to add
          </div>
        </div>
      )}
    </div>
  );
}
