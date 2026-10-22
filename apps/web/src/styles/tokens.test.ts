// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m?.[1]) throw new Error(`token --${name} not found as a hex value`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('brand tokens match the kit', () => {
  it.each([
    ['ak-ember', '#fc6912'],
    ['ak-paper', '#fff3ed'],
    ['ak-graphite', '#443d39'],
    ['ak-ink', '#000000'],
    ['ak-quill', '#fc6e1a'],
    ['ak-sunrise', '#ff9557'],
    ['ak-blush', '#ffe6d8'],
    ['ak-peach', '#ffd4ba'],
  ])('%s is %s', (name, hex) => {
    expect(token(name).toLowerCase()).toBe(hex);
  });

  it('defines the approved top-to-bottom gradient', () => {
    expect(css).toContain('linear-gradient(180deg, #fc6f1c, #ff9557)');
  });

  it('keeps Quill Orange out of everything but the token definition', () => {
    expect(css.match(/--ak-quill/g)).toHaveLength(1);
  });
});

describe('text pairings meet WCAG contrast (kit contrast table)', () => {
  const t = (n: string) => token(n);
  it.each([
    ['ink on paper', 'ak-ink', 'ak-paper', 4.5],
    ['graphite on paper', 'ak-graphite', 'ak-paper', 4.5],
    ['graphite on white', 'ak-graphite', 'ak-white', 4.5],
    ['graphite on blush', 'ak-graphite', 'ak-blush', 4.5],
    ['ink on ember (buttons, badges)', 'ak-ink', 'ak-ember', 4.5],
    ['ink on peach', 'ak-ink', 'ak-peach', 4.5],
    ['paper on graphite', 'ak-paper', 'ak-graphite', 4.5],
    ['ember on ink (dark panels)', 'ak-ember', 'ak-ink', 4.5],
    ['status success', 'status-success-fg', 'status-success-bg', 4.5],
    ['status warning', 'status-warning-fg', 'status-warning-bg', 4.5],
    ['status error', 'status-error-fg', 'status-error-bg', 4.5],
  ])('%s ≥ %f', (_label, fg, bg, min) => {
    expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(min);
  });

  it('documents that the forbidden pairings really fail', () => {
    expect(contrast(t('ak-ember'), t('ak-paper'))).toBeLessThan(3);
    expect(contrast(t('ak-white'), t('ak-ember'))).toBeLessThan(3);
  });
});
