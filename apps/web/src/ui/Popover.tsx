import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn.js';

/**
 * A disclosure button with a floating panel: closes on Escape (returning focus to the button), on a click
 * outside, and when the panel asks to (`close`). Used for the header's menus; not a modal.
 */
export function Popover({
  label,
  button,
  children,
  align = 'right',
  className,
  panelClassName,
}: {
  /** Accessible name of the button. */
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-pill px-2 text-ink hover:bg-blush"
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          className={cn(
            'absolute top-full z-40 mt-2 w-72 rounded-card border border-line bg-white p-2 text-graphite shadow-card',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
