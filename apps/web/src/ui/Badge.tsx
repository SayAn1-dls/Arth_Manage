import type { ReactNode } from 'react';
import { CheckCircle2, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { cn } from './cn.js';

export type BadgeTone = 'brand' | 'success' | 'warning' | 'error' | 'info';

const tones: Record<BadgeTone, { cls: string; icon: ReactNode }> = {
  // Brand pill: solid Ember, Ink text, uppercase (never white text on Ember).
  brand: { cls: 'bg-ember text-ink', icon: null },
  success: {
    cls: 'bg-success-bg text-success-fg border border-success-fg/30',
    icon: <CheckCircle2 aria-hidden className="size-3.5" />,
  },
  warning: {
    cls: 'bg-warning-bg text-warning-fg border border-warning-fg/30',
    icon: <TriangleAlert aria-hidden className="size-3.5" />,
  },
  error: {
    cls: 'bg-error-bg text-error-fg border border-error-fg/30',
    icon: <OctagonAlert aria-hidden className="size-3.5" />,
  },
  info: {
    cls: 'bg-info-bg text-info-fg border border-graphite/25',
    icon: <Info aria-hidden className="size-3.5" />,
  },
};

/** Status is always icon + text, never colour alone. */
export function Badge({ tone = 'brand', children }: { tone?: BadgeTone; children: ReactNode }) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-bold uppercase tracking-wider',
        t.cls,
      )}
    >
      {t.icon}
      {children}
    </span>
  );
}
