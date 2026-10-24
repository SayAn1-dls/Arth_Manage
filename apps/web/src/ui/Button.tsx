import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

// Primary text is Ink on Ember (7.17:1). White on Ember fails contrast and is never used.
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ember text-ink hover:brightness-95 active:brightness-90 border border-ember',
  secondary: 'bg-white text-ink border border-line-strong hover:bg-blush',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-blush underline-offset-4',
  danger: 'bg-error-fg text-white border border-error-fg hover:brightness-110',
};

export function Button({
  variant = 'primary',
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-5 py-2',
        'font-sans text-base font-bold transition-[filter,background-color] cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
