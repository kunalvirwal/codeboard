import { useStore } from '@xyflow/react';
import { useId, type ReactNode } from 'react';
import type { CanvasColor } from './appearance';

/**
 * Board background drawn as an SVG pattern that tracks pan and zoom.
 * (React Flow's built-in Background only covers dots/lines/cross.)
 */
export function CanvasBackground({ pattern, color }: { pattern: string; color: CanvasColor }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const uid = useId().replace(/:/g, '');
  if (pattern === 'blank') return null;

  // Thin lines get hard to see when zoomed out; fade the minor pattern away.
  const minorOpacity = Math.min(1, Math.max(0, (zoom - 0.25) / 0.35));
  const stroke = Math.max(0.6, Math.min(1.2, zoom));

  const tile = (id: string, size: number, children: ReactNode, height = size) => {
    const w = size * zoom;
    const h = height * zoom;
    return (
      <pattern id={id} x={tx % w} y={ty % h} width={w} height={h} patternUnits="userSpaceOnUse">
        {children}
      </pattern>
    );
  };

  let defs: ReactNode;
  let layers: { id: string; opacity?: number }[] = [];

  switch (pattern) {
    case 'dots':
    case 'dots-dense': {
      const gap = pattern === 'dots' ? 24 : 14;
      const r = Math.max(0.7, (pattern === 'dots' ? 1.3 : 0.9) * Math.min(zoom, 1.4));
      defs = tile(`${uid}-p`, gap, <circle cx={r} cy={r} r={r} fill={color.ink} />);
      layers = [{ id: `${uid}-p`, opacity: pattern === 'dots-dense' ? minorOpacity : 1 }];
      break;
    }
    case 'grid': {
      const g = 32 * zoom;
      defs = tile(`${uid}-p`, 32, <path d={`M ${g} 0 L 0 0 0 ${g}`} fill="none" stroke={color.ink} strokeWidth={stroke} />);
      layers = [{ id: `${uid}-p`, opacity: Math.max(0.35, minorOpacity) }];
      break;
    }
    case 'graph': {
      const minor = 20 * zoom;
      const major = 100 * zoom;
      defs = (
        <>
          {tile(`${uid}-minor`, 20, <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" stroke={color.ink} strokeWidth={stroke * 0.8} />)}
          {tile(`${uid}-major`, 100, <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke={color.major} strokeWidth={stroke * 1.3} />)}
        </>
      );
      layers = [{ id: `${uid}-minor`, opacity: minorOpacity }, { id: `${uid}-major` }];
      break;
    }
    case 'ruled': {
      const g = 30 * zoom;
      defs = tile(`${uid}-p`, 30, <path d={`M 0 0 H ${g}`} fill="none" stroke={color.ink} strokeWidth={stroke * 1.1} />);
      layers = [{ id: `${uid}-p`, opacity: Math.max(0.35, minorOpacity) }];
      break;
    }
    case 'iso': {
      // Triangular lattice of dots.
      const s = 28;
      const h = s * Math.sqrt(3);
      const r = Math.max(0.7, 1.2 * Math.min(zoom, 1.4));
      defs = tile(
        `${uid}-p`,
        s,
        <>
          <circle cx={r} cy={r} r={r} fill={color.ink} />
          <circle cx={(s / 2) * zoom + r} cy={(h / 2) * zoom + r} r={r} fill={color.ink} />
        </>,
        h,
      );
      layers = [{ id: `${uid}-p`, opacity: Math.max(0.4, minorOpacity) }];
      break;
    }
    case 'cross': {
      const g = 40 * zoom;
      const arm = Math.max(2.5, 4 * Math.min(zoom, 1.3));
      defs = tile(
        `${uid}-p`,
        40,
        <path d={`M ${g / 2 - arm} ${g / 2} H ${g / 2 + arm} M ${g / 2} ${g / 2 - arm} V ${g / 2 + arm}`} stroke={color.ink} strokeWidth={stroke * 1.2} strokeLinecap="round" />,
      );
      layers = [{ id: `${uid}-p`, opacity: Math.max(0.4, minorOpacity) }];
      break;
    }
  }

  return (
    <svg className="canvas-bg" aria-hidden>
      <defs>{defs}</defs>
      {layers.map((l) => (
        <rect key={l.id} width="100%" height="100%" fill={`url(#${l.id})`} opacity={l.opacity ?? 1} />
      ))}
      {pattern === 'ruled' && color.margin !== undefined && (
        <line x1={tx + 72 * zoom} x2={tx + 72 * zoom} y1="0" y2="100%" stroke={color.margin} strokeWidth={Math.max(1, 1.4 * zoom)} />
      )}
      {pattern === 'ruled' && color.margin === undefined && (
        <line x1={tx + 72 * zoom} x2={tx + 72 * zoom} y1="0" y2="100%" stroke={color.major} strokeWidth={Math.max(1, 1.4 * zoom)} />
      )}
    </svg>
  );
}
