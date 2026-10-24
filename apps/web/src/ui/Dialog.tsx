import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button.js';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons, right-aligned. State the consequence of irreversible actions in the body (PRD §11.6). */
  actions?: ReactNode;
}

/** Built on the native <dialog>: modal focus trapping, Escape to close, and inert background for free. */
export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card bg-white p-0 text-graphite shadow-card backdrop:bg-graphite/50"
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-2">
        <h2 id={titleId} className="text-xl">
          {title}
        </h2>
        <Button
          variant="ghost"
          aria-label="Close dialog"
          onClick={onClose}
          className="-mr-2 px-2"
          icon={<X aria-hidden className="size-5" />}
        />
      </div>
      <div className="px-5 pb-5">{children}</div>
      {actions && (
        <div className="flex flex-wrap justify-end gap-3 border-t border-line bg-blush p-4">
          {actions}
        </div>
      )}
    </dialog>
  );
}
