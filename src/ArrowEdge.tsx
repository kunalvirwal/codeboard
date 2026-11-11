import {
  Position,
  useStore,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { ArrowLeftRight, ArrowRight, Minus, Spline, Trash2, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteEdges, EDGE_COLORS, patchEdge, type BoardEdge } from './db';
import { keys } from './lib/keys';

export type ArrowEdgeType = Edge<{ edge: BoardEdge; editLabel?: boolean }, 'arrow'>;

export const EDGE_STROKE: Record<string, string> = {
  ink: 'var(--canvas-ink)',
  gray: '#8e8e98',
  black: '#17171a',
  blue: '#4c8dff',
  purple: '#9b6bff',
  pink: '#f0609e',
  orange: '#f59e3d',
  green: '#2fb36b',
};

const PATHS: { id: BoardEdge['path']; label: string; icon: ReactNode }[] = [
  { id: 'curve', label: 'Curved', icon: <Spline size={15} /> },
  { id: 'straight', label: 'Straight', icon: <Minus size={15} style={{ transform: 'rotate(-45deg)' }} /> },
  { id: 'step', label: 'Elbow', icon: <ElbowIcon /> },
];

function ElbowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 5h8v14h8" />
    </svg>
  );
}

const GAP = 3;

function pullBack(x: number, y: number, side: Position): [number, number] {
  switch (side) {
    case Position.Left:
      return [x - GAP, y];
    case Position.Right:
      return [x + GAP, y];
    case Position.Top:
      return [x, y - GAP];
    default:
      return [x, y + GAP];
  }
}

export function ArrowEdge(props: EdgeProps<ArrowEdgeType>) {
  const { id, data, selected, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const edge = data!.edge;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Stop arrow-headed ends a few px short of the card so the head reads cleanly.
  const [tx, ty] = edge.arrows !== 'none' ? pullBack(targetX, targetY, targetPosition) : [targetX, targetY];
  const [sx, sy] = edge.arrows === 'both' ? pullBack(sourceX, sourceY, sourcePosition) : [sourceX, sourceY];
  const args = { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    edge.path === 'straight' ? getStraightPath(args) : edge.path === 'step' ? getSmoothStepPath({ ...args, borderRadius: 14 }) : getBezierPath(args);

  // Opened from the canvas on double-click.
  useEffect(() => {
    if (data?.editLabel) setEditing(true);
  }, [data?.editLabel]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const set = (fn: (e: BoardEdge) => void) => void patchEdge(id, fn);
  // Only show the toolbar when this arrow is the one thing selected; a
  // drag-selection over several cards also selects their arrows.
  const soleSelection = useStore((s) => s.edges.filter((e) => e.selected).length === 1 && !s.nodes.some((n) => n.selected));
  const stroke = EDGE_STROKE[edge.color] ?? EDGE_STROKE.ink;
  const label = edge.label && edge.localizeKeys ? keys(edge.label) : edge.label;

  return (
    <>
      <defs>
        {/* One head shape for both ends: auto-start-reverse flips it at the start. */}
        <marker
          id={`head-${id}`}
          viewBox="0 0 12 12"
          refX="10.5"
          refY="6"
          markerWidth="13"
          markerHeight="13"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M1.5 1.8 L10.8 6 L1.5 10.2 L3.6 6 Z" style={{ fill: stroke, stroke, strokeWidth: 1, strokeLinejoin: 'round' }} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={edge.arrows !== 'none' ? `url(#head-${id})` : undefined}
        markerStart={edge.arrows === 'both' ? `url(#head-${id})` : undefined}
        interactionWidth={22}
        style={{
          stroke,
          strokeWidth: selected ? 2.6 : 2,
          strokeDasharray: edge.dashed ? '7 6' : undefined,
          filter: selected ? 'drop-shadow(0 0 3px var(--accent))' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {(label || editing) && (
          <div
            className="edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: stroke }}
            onDoubleClick={() => setEditing(true)}
          >
            {editing ? (
              <input
                ref={inputRef}
                defaultValue={label}
                placeholder="Label"
                size={Math.max(6, (label ?? '').length + 1)}
                onBlur={(e) => {
                  setEditing(false);
                  const label = e.currentTarget.value.trim();
                  set((x) => (x.label = label || undefined));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                }}
              />
            ) : (
              label
            )}
          </div>
        )}
        {selected && soleSelection && !editing && (
          <div
            className="card-toolbar edge-toolbar nodrag nopan"
            style={{ transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - (label ? 22 : 14)}px)` }}
          >
            <div className="tb-colors">
              {EDGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  className={`tb-color${c === edge.color ? ' active' : ''}`}
                  style={{ background: EDGE_STROKE[c] }}
                  onClick={() => set((x) => (x.color = c))}
                />
              ))}
            </div>
            <span className="tb-divider" />
            {PATHS.map((p) => (
              <button key={p.id} type="button" title={p.label} className={`tb-btn${edge.path === p.id ? ' active' : ''}`} onClick={() => set((x) => (x.path = p.id))}>
                {p.icon}
              </button>
            ))}
            <span className="tb-divider" />
            <button type="button" title="Dashed" className={`tb-btn${edge.dashed ? ' active' : ''}`} onClick={() => set((x) => (x.dashed = !x.dashed))}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M3 12h4M10 12h4M17 12h4" />
              </svg>
            </button>
            <button
              type="button"
              title="Arrowheads"
              className="tb-btn"
              onClick={() => set((x) => (x.arrows = x.arrows === 'end' ? 'both' : x.arrows === 'both' ? 'none' : 'end'))}
            >
              {edge.arrows === 'both' ? <ArrowLeftRight size={15} /> : edge.arrows === 'end' ? <ArrowRight size={15} /> : <Minus size={15} />}
            </button>
            <button type="button" title="Label" className="tb-btn" onClick={() => setEditing(true)}>
              <Type size={15} />
            </button>
            <span className="tb-divider" />
            <button type="button" title="Delete arrow" className="tb-btn danger" onClick={() => void deleteEdges([id])}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
