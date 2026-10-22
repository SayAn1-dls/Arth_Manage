import defaultLogo from '../assets/logo/arthakram-logo-default.svg';
import whiteLogo from '../assets/logo/arthakram-logo-white.svg';
import onInkLogo from '../assets/logo/arthakram-logo-onink.svg';
import feather from '../assets/logo/arthakram-feather.svg';
import featherWhite from '../assets/logo/arthakram-feather-white.svg';
import { cn } from './cn.js';

/** Approved backgrounds only: Paper (default), White, Ember, Ink. */
export type LogoSurface = 'paper' | 'white' | 'ember' | 'ink';

const lockups: Record<LogoSurface, string> = {
  paper: defaultLogo,
  white: defaultLogo,
  ember: whiteLogo, // wordmark and quill go white on Ember so the quill does not vanish
  ink: onInkLogo, // quill keeps its orange, wordmark white
};

/** Below 120px the kit requires the feather mark; the component enforces this. */
export const MIN_LOCKUP_WIDTH = 120;

interface LogoProps {
  surface?: LogoSurface;
  /** Rendered width in px of the full lockup. Values below 120 switch to the feather mark. */
  width?: number;
  /** Force the feather mark (avatars, compact navigation). */
  mark?: boolean;
  className?: string;
}

/**
 * Renders supplied artwork only: never re-typed, recoloured, stretched or given effects.
 * Height is derived from the intrinsic aspect ratio so the artwork cannot be distorted.
 * Clear space (the feather-head height) is applied as padding by the caller via `className`.
 */
export function Logo({ surface = 'paper', width = 160, mark = false, className }: LogoProps) {
  const useMark = mark || width < MIN_LOCKUP_WIDTH;
  const src = useMark ? (surface === 'ember' ? featherWhite : feather) : lockups[surface];
  return (
    <img
      src={src}
      alt="Arthakram"
      width={useMark ? undefined : width}
      height={useMark ? undefined : undefined}
      style={useMark ? { height: width } : { height: 'auto' }}
      className={cn('block select-none', className)}
      draggable={false}
    />
  );
}
