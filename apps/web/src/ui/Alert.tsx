import type { ReactNode } from 'react';
import { CheckCircle2, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { cn } from './cn.js';

export type AlertTone = 'success' | 'warning' | 'error' | 'info';

const tones: Record<AlertTone, { cls: string; icon: ReactNode }> = {
  success: {
    cls: 'bg-success-bg text-success-fg border-success-fg',
    icon: <CheckCircle2 aria-hidden className="size-5" />,
  },
  warning: {
    cls: 'bg-warning-bg text-warning-fg border-warning-fg',
    icon: <TriangleAlert aria-hidden className="size-5" />,
  },
  error: {
    cls: 'bg-error-bg text-error-fg border-error-fg',
    icon: <OctagonAlert aria-hidden className="size-5" />,
  },
  info: {
    cls: 'bg-info-bg text-info-fg border-graphite',
    icon: <Info aria-hidden className="size-5" />,
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-card border-l-4 p-4', t.cls, className)}
    >
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div>
        {title && <p className="font-bold">{title}</p>}
        {children && <div className="text-sm">{children}</div>}
      </div>
    </div>
  );
}
