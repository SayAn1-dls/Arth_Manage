import { useEffect, useId, useRef, useState } from 'react';

export interface ChartPoint {
  /** Short x-axis label, e.g. "12 Feb". */
  label: string;
  value: number;
}

/** Round an axis maximum up to a tidy number (1, 2, 2.5 or 5 × 10ⁿ) so tick labels read cleanly. */
function niceMax(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const nice = Math.max(1, step);
  return { top: Math.ceil(max / nice) * nice, step: nice };
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(Math.round(n));

/** Smooth path through points (Catmull–Rom converted to cubic Béziers, clamped so it never overshoots 0). */
function smoothPath(pts: [number, number][], floor: number) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) * t);
    const c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) * t);
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${c1y} ${p2[0] - (p3[0] - p1[0]) * t},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * A single-series area chart drawn in SVG at the container's real width (no stretched text). Hover or focus
 * and use the arrow keys to read exact values; a visually hidden table carries the same data for screen
 * readers. `unit` names the value in the tooltip ("registrations").
 */
export function AreaChart({
  points,
  unit,
  height = 240,
  label,
}: {
  points: ChartPoint[];
  unit: string;
  height?: number;
  /** Accessible description of the chart. */
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 16, right: 16, bottom: 30, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const { top, step } = niceMax(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => pad.left + (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.top + h - (v / top) * h;
  const coords = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const line = smoothPath(coords, pad.top + h);
  const area = coords.length
    ? `${line} L${coords.at(-1)![0]},${pad.top + h} L${coords[0]![0]},${pad.top + h} Z`
    : '';
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // At most ~7 x labels, always including the last day.
  const every = Math.max(1, Math.ceil(points.length / (width < 480 ? 4 : 7)));
  const showLabel = (i: number) => i === points.length - 1 || i % every === 0;
  // Dots only when there is room to tell them apart.
  const dots = points.length <= 31;
  const a = active !== null ? points[active] : null;

  return (
    <div ref={wrap} className="relative w-full">
      <svg
        role="img"
        aria-label={label}
        tabIndex={0}
        width={width}
        height={height}
        className="block overflow-visible outline-offset-4"
        onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          const i = Math.round(((px - pad.left) / w) * (points.length - 1));
          setActive(Math.min(Math.max(i, 0), points.length - 1));
        }}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? points.length) - 1, 0));
          if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? -1) + 1, points.length - 1));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ak-ember)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--ak-sunrise)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={pad.left + w}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--ak-line)"
              strokeDasharray={t === 0 ? undefined : '3 5'}
            />
            <text
              x={pad.left - 10}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-graphite text-xs"
            >
              {compact(t)}
            </text>
          </g>
        ))}
        {points.map(
          (p, i) =>
            showLabel(i) && (
              <text
                key={`x-${i}`}
                x={x(i)}
                y={height - 8}
                textAnchor={
                  i === 0 && points.length > 1
                    ? 'start'
                    : i === points.length - 1 && points.length > 1
                      ? 'end'
                      : 'middle'
                }
                className="fill-graphite text-xs"
              >
                {p.label}
              </text>
            ),
        )}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--ak-ember)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {dots &&
          coords.map(([cx, cy], i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={active === i ? 5.5 : 3.5}
              fill="var(--ak-ember)"
              stroke="var(--ak-white)"
              strokeWidth={active === i ? 2 : 1}
            />
          ))}
        {a && active !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={pad.top}
            y2={pad.top + h}
            stroke="var(--ak-line-strong)"
            strokeDasharray="2 4"
          />
        )}
      </svg>
      {a && active !== null && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-card bg-white px-3 py-1.5 text-sm whitespace-nowrap text-ink shadow-card"
          style={{
            left: Math.min(Math.max(x(active), 80), width - 80),
            top: y(a.value) - 10,
          }}
        >
          <strong>{a.value.toLocaleString()}</strong> {unit}
          <span className="block text-xs text-graphite">{a.label}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>{unit}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A tiny line of recent daily values for metric cards. Decorative: the card states the figure in text. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const W = 88;
  const H = 32;
  const pts = values.map(
    (v, i) =>
      [(i / (values.length - 1)) * W, H - 3 - ((v - min) / (max - min || 1)) * (H - 6)] as [
        number,
        number,
      ],
  );
  return (
    <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className}>
      <path
        d={smoothPath(pts, H)}
        fill="none"
        stroke="var(--ak-sunrise)"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  );
}
