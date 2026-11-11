import { Handle, NodeResizer, NodeToolbar, Position } from '@xyflow/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { db, deleteCards, patchCard } from '../db';
import { keys } from '../lib/keys';

interface CardFrameProps {
  id: string;
  selected: boolean;
  className?: string;
  keepAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
  toolbar?: ReactNode;
  children: ReactNode;
  onDoubleClick?: () => void;
  /** Rendered next to the card instead of inside it, so it can poke out past the edge. */
  outside?: ReactNode;
  /** Show a rotation handle when selected; `rotation` is the saved angle. */
  rotatable?: boolean;
  rotation?: number;
}

/** Drag from any side to draw an arrow to another card. */
export function ConnectHandles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className="card-handle" />
      <Handle type="source" position={Position.Right} id="r" className="card-handle" />
      <Handle type="source" position={Position.Bottom} id="b" className="card-handle" />
      <Handle type="source" position={Position.Left} id="l" className="card-handle" />
    </>
  );
}

export function persistResize(id: string, p: { x: number; y: number; width: number; height: number }) {
  void patchCard(id, (c) => {
    c.x = p.x;
    c.y = p.y;
    c.width = p.width;
    c.height = p.height;
  });
}

/** Shared chrome for every card: resize handles, connect handles, floating toolbar. */
export function CardFrame(props: CardFrameProps) {
  const { id, selected, className = '', keepAspectRatio, minWidth = 120, minHeight = 48, toolbar, children, onDoubleClick, outside, rotatable, rotation = 0 } = props;
  // Live angle while dragging the handle; saved on release.
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  const angle = dragAngle ?? rotation;
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        keepAspectRatio={keepAspectRatio}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeEnd={(_, p) => persistResize(id, p)}
      />
      {/* Rotatable cards keep the space just above them free for the rotation handle. */}
      {/* Toolbar buttons never take focus, so styling a note you're typing in
          (even an empty one) doesn't end the edit. */}
      <NodeToolbar position={Position.Top} offset={rotatable ? 52 : 12} className="card-toolbar" onMouseDown={keepFocus}>
        {toolbar}
        <ToolbarDivider />
        <ToolbarButton danger onClick={() => void deleteCards([id])} title={keys('Delete (⌫)')}>
          <Trash2 size={15} />
        </ToolbarButton>
      </NodeToolbar>
      <ConnectHandles />
      {rotatable ? (
        // The rotor turns the card (and anything poking out of it) around its centre.
        <div className="card-rotor" style={angle ? { transform: `rotate(${angle}deg)` } : undefined}>
          <div className={`card ${className}`} onDoubleClick={onDoubleClick}>
            {children}
          </div>
          {outside}
          {selected && (
            <RotateHandle
              onChange={setDragAngle}
              onCommit={(deg) => {
                setDragAngle(null);
                if (deg !== rotation) void patchCard(id, (c) => void (c.rotation = deg));
              }}
              onReset={() => void patchCard(id, (c) => void (c.rotation = 0))}
            />
          )}
        </div>
      ) : (
        <>
          <div className={`card ${className}`} onDoubleClick={onDoubleClick}>
            {children}
          </div>
          {outside}
        </>
      )}
    </>
  );
}

const normalize = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/** Next quarter turn clockwise from any angle (37° -> 90°, 90° -> 180°, 270° -> 0°). */
export const nextQuarterTurn = (deg: number) => normalize((Math.floor(normalize(deg) / 90) + 1) * 90);

/**
 * Drag to rotate around the card's centre. Snaps to straight angles within a
 * few degrees; hold Shift for 15° steps; double-click to reset.
 */
function RotateHandle(props: { onChange: (deg: number) => void; onCommit: (deg: number) => void; onReset: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // The node wrapper isn't rotated, so its box centre is the pivot.
    const node = ref.current!.closest('.react-flow__node')!.getBoundingClientRect();
    const cx = node.left + node.width / 2;
    const cy = node.top + node.height / 2;
    let last = 0;
    const move = (ev: PointerEvent) => {
      let deg = normalize((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
      if (ev.shiftKey) deg = normalize(Math.round(deg / 15) * 15);
      else {
        const straight = Math.round(deg / 90) * 90;
        if (Math.abs(deg - straight) < 5) deg = normalize(straight);
      }
      last = deg;
      props.onChange(deg);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      props.onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  return (
    <div
      ref={ref}
      className="rotate-handle nodrag nopan"
      title="Drag to rotate · Shift snaps to 15° · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onReset();
      }}
    >
      <RotateCw size={12} />
    </div>
  );
}

/** Mouse-down handler that stops a toolbar click from stealing focus from a field being edited. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function ToolbarButton(props: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  danger?: boolean;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={props.title}
      className={`tb-btn${props.danger ? ' danger' : ''}${props.active ? ' active' : ''}${props.wide ? ' wide' : ''}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export const ToolbarDivider = () => <span className="tb-divider" />;

/** Run an async copy action and show "Copied" briefly. */
export function useCopy(): [boolean, (fn: () => Promise<void>) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = useCallback((fn: () => Promise<void>) => {
    fn()
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch((err) => console.error('Copy failed', err));
  }, []);
  return [copied, run];
}

/** Object URL for a blob stored in IndexedDB (revoked on change/unmount). */
export function useBlobUrl(blobId: string | undefined) {
  const stored = useLiveQuery(() => (blobId ? db.blobs.get(blobId) : undefined), [blobId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!stored) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(stored.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [stored]);
  return { url, blob: stored?.blob };
}

/**
 * True when the element has content to scroll. Used to add React Flow's `nowheel`
 * class only when needed, so the wheel still pans the canvas over short cards.
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return overflow;
}

/**
 * Focus a field inside a freshly added node. React Flow keeps new nodes
 * `visibility: hidden` until measured, and hidden elements can't take focus,
 * so retry for a few frames. Returns a cancel function.
 */
export function focusWhenVisible(el: HTMLTextAreaElement | HTMLInputElement | null) {
  let frame = 0;
  let tries = 0;
  const attempt = () => {
    if (!el || !el.isConnected) return;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } else if (tries++ < 30) {
      frame = requestAnimationFrame(attempt);
    }
  };
  attempt();
  return () => cancelAnimationFrame(frame);
}

export function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
