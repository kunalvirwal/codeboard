import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface WheelItem {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
}

interface Props {
  /** Centre, in px relative to the canvas wrapper. */
  x: number;
  y: number;
  items: WheelItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}

const RADIUS = 128;
const DEAD_ZONE = 22;

/**
 * Blender-style pie menu: items sit in a ring and the one in the direction of
 * the cursor is highlighted, so you only need to flick towards it and click.
 */
export function RadialMenu({ x, y, items, onPick, onClose }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const step = 360 / items.length;

  // Shortcut letters pick directly; Esc closes. Capture phase so the canvas
  // shortcuts don't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      const item = items.find((i) => i.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (item) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onPick(item.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, onPick, onClose]);

  const indexFor = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const dx = clientX - (rect.left + x);
    const dy = clientY - (rect.top + y);
    if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
    // 0° = straight up, clockwise.
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return Math.round(((angle + 360) % 360) / step) % items.length;
  };

  const active = hover !== null ? items[hover] : null;

  return (
    <div
      ref={ref}
      className="wheel-backdrop"
      onPointerMove={(e) => setHover(indexFor(e.clientX, e.clientY))}
      onPointerDown={(e) => e.stopPropagation()}
      // Pick on click (not pointerdown) so the whole press lands on the wheel;
      // otherwise the mouse-up hits the canvas and steals focus from whatever
      // the option opens (like the link box).
      onClick={(e) => {
        e.stopPropagation();
        const i = indexFor(e.clientX, e.clientY);
        if (i === null) onClose();
        else onPick(items[i].id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      onWheel={onClose}
    >
      <div className="wheel" style={{ left: x, top: y }}>
        <div className="wheel-disc" style={{ width: RADIUS * 2 + 150, height: RADIUS * 2 + 150 }} />
        <svg className="wheel-ring" width={RADIUS * 2 + 80} height={RADIUS * 2 + 80} aria-hidden>
          <circle cx={RADIUS + 40} cy={RADIUS + 40} r={RADIUS} />
        </svg>
        {hover !== null && (
          <div className="wheel-pointer" style={{ transform: `rotate(${hover * step}deg)` }}>
            <span />
          </div>
        )}
        <div className={`wheel-center${active ? ' has-label' : ''}`}>{active ? active.label : 'Add'}</div>
        {items.map((item, i) => {
          const a = ((i * step - 90) * Math.PI) / 180;
          return (
            <div
              key={item.id}
              className={`wheel-item${hover === i ? ' hover' : ''}${item.active ? ' on' : ''}`}
              style={{
                transform: `translate(-50%, -50%) translate(${Math.cos(a) * RADIUS}px, ${Math.sin(a) * RADIUS}px)`,
                animationDelay: `${i * 14}ms`,
              }}
            >
              {item.icon}
              <span className="wheel-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small floating input used by the wheel's "Link" option. */
export function LinkPrompt(props: { x: number; y: number; onSubmit: (value: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.focus());
    const outside = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', outside);
    };
  }, [onClose]);

  return (
    <div ref={boxRef} className="link-prompt glass" style={{ left: props.x, top: props.y }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        placeholder="Paste a link and press Enter"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const value = e.currentTarget.value.trim();
            if (value) props.onSubmit(value);
            props.onClose();
          } else if (e.key === 'Escape') {
            props.onClose();
          }
        }}
      />
    </div>
  );
}
