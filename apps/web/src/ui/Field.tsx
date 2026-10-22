import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from './cn.js';

interface FieldShellProps {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Visible label above the control, hint and error text below, wired for assistive tech. */
export function FieldShell({
  id: idProp,
  label,
  hint,
  error,
  required,
  children,
}: FieldShellProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-sm text-graphite/80">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-semibold text-error-fg">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const control = (invalid: boolean) =>
  cn(
    'min-h-11 w-full rounded-pill border bg-white px-3 py-2 font-sans text-base text-ink',
    'placeholder:text-graphite/60 disabled:bg-blush disabled:text-graphite disabled:opacity-100',
    invalid ? 'border-error-fg border-2' : 'border-line-strong',
  );

type Common = Pick<FieldShellProps, 'label' | 'hint' | 'error'>;

export function Input({
  label,
  hint,
  error,
  className,
  ...rest
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell id={rest.id} label={label} hint={hint} error={error} required={rest.required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control(invalid), className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  ...rest
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell id={rest.id} label={label} hint={hint} error={error} required={rest.required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={4}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control(invalid), 'min-h-24 leading-normal', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell id={rest.id} label={label} hint={hint} error={error} required={rest.required}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control(invalid), className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1 size-5 shrink-0 cursor-pointer accent-ember"
        {...rest}
      />
      <label htmlFor={id} className="cursor-pointer text-base text-ink">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="block text-sm text-graphite/80">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}
