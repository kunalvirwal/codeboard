import { useReactFlow, useStore } from '@xyflow/react';
import { BookmarkPlus, Code2, Frame, Map as MapIcon, Maximize, Minus, Move, Plus, Spline, StickyNote, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { keys } from '../lib/keys';

interface DockProps {
  onNote: () => void;
  onText: () => void;
  onCode: () => void;
  onFrame: () => void;
  onArrowHint: () => void;
  onMarker: () => void;
  glide: boolean;
  onGlide: () => void;
}

function DockButton(props: { label: string; shortcut?: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" className={`dock-btn${props.active ? ' active' : ''}`} onClick={props.onClick} aria-label={props.label}>
      {props.children}
      <span className="dock-tip">
        {props.label}
        {props.shortcut && <kbd>{props.shortcut}</kbd>}
      </span>
    </button>
  );
}

/** Bottom-centre tool dock. */
export function Dock(props: DockProps) {
  return (
    <div className="dock glass">
      <DockButton label="Sticky note" shortcut="N" onClick={props.onNote}>
        <StickyNote size={19} />
      </DockButton>
      <DockButton label="Text" shortcut="T" onClick={props.onText}>
        <Type size={19} />
      </DockButton>
      <DockButton label="Code" shortcut="C" onClick={props.onCode}>
        <Code2 size={19} />
      </DockButton>
      <DockButton label="Box around selection" shortcut="F" onClick={props.onFrame}>
        <Frame size={19} />
      </DockButton>
      <DockButton label="Arrow" onClick={props.onArrowHint}>
        <Spline size={19} />
      </DockButton>
      <span className="dock-divider" />
      <DockButton label="Mark this spot" shortcut="M" onClick={props.onMarker}>
        <BookmarkPlus size={19} />
      </DockButton>
      <DockButton label={props.glide ? 'Glide on (edge scrolling)' : 'Glide: scroll by moving to an edge'} shortcut="G" onClick={props.onGlide} active={props.glide}>
        <Move size={19} />
      </DockButton>
    </div>
  );
}

/** Bottom-left zoom controls. */
export function ZoomPill({ minimap, onToggleMinimap }: { minimap: boolean; onToggleMinimap: () => void }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="zoom-pill glass">
      <button type="button" title="Zoom out" onClick={() => void rf.zoomOut({ duration: 200 })}>
        <Minus size={15} />
      </button>
      <button type="button" className="zoom-value" title="Reset to 100%" onClick={() => void rf.zoomTo(1, { duration: 250 })}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" title="Zoom in" onClick={() => void rf.zoomIn({ duration: 200 })}>
        <Plus size={15} />
      </button>
      <span className="pill-divider" />
      <button type="button" title={keys('Zoom to fit (⇧1)')} onClick={() => void rf.fitView({ duration: 450, maxZoom: 1, padding: 0.15 })}>
        <Maximize size={15} />
      </button>
      <button type="button" title="Minimap" className={minimap ? 'active' : ''} onClick={onToggleMinimap}>
        <MapIcon size={15} />
      </button>
    </div>
  );
}
