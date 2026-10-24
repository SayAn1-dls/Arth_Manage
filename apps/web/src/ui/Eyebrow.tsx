import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

/**
 * Short, uppercase, wide-tracked label. Ember is allowed here only on Paper/Blush/Ink
 * (the kit's one sanctioned Ember-as-text case); use tone="ink" on Ember or when contrast is critical.
 */
export function Eyebrow({
  tone = 'ink',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'ink' | 'graphite' }) {
  return (
    <span
      className={cn(
        'text-xs font-bold uppercase tracking-eyebrow',
        tone === 'ink' ? 'text-ink' : 'text-graphite',
        className,
      )}
      {...rest}
    />
  );
}
