import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { FEATHER_PATH, FEATHER_VIEWBOX } from './feather.js';

const require = createRequire(import.meta.url);
const FONT_FILES = {
  display:
    '@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf',
  displayBold: '@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf',
  text: '@expo-google-fonts/instrument-sans/400Regular/InstrumentSans_400Regular.ttf',
  italic:
    '@expo-google-fonts/instrument-sans/400Regular_Italic/InstrumentSans_400Regular_Italic.ttf',
  bold: '@expo-google-fonts/instrument-sans/700Bold/InstrumentSans_700Bold.ttf',
} as const;

export type BrandFonts = Record<keyof typeof FONT_FILES, PDFFont>;

const cache = new Map<string, Buffer>();
async function fontBytes(key: keyof typeof FONT_FILES): Promise<Buffer> {
  const path = require.resolve(FONT_FILES[key]);
  let b = cache.get(path);
  if (!b) {
    b = await readFile(path);
    cache.set(path, b);
  }
  return b;
}

/** Brand colours as 0-1 RGB for PDF drawing (print documents sit on White, per the kit). */
const hex = (h: string): RGB =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );
export const PDF_COLORS = {
  ember: hex('#FC6912'),
  paper: hex('#FFF3ED'),
  graphite: hex('#443D39'),
  ink: hex('#000000'),
  quill: hex('#FC6E1A'), // logo artwork only
  blush: hex('#FFE6D8'),
  peach: hex('#FFD4BA'),
  white: hex('#FFFFFF'),
};

export async function createBrandDocument(): Promise<{ doc: PDFDocument; fonts: BrandFonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const entries = await Promise.all(
    (Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[]).map(
      async (k) => [k, await doc.embedFont(await fontBytes(k), { subset: true })] as const,
    ),
  );
  return { doc, fonts: Object.fromEntries(entries) as BrandFonts };
}

/** Draws the feather mark with its top-left at (x, y) scaled to `height` points. Supplied artwork, never distorted. */
export function drawFeather(
  page: PDFPage,
  x: number,
  yTop: number,
  height: number,
  color: RGB = PDF_COLORS.quill,
) {
  const [, , w, h] = FEATHER_VIEWBOX;
  const scale = height / h;
  page.drawSvgPath(FEATHER_PATH, {
    x: x - FEATHER_VIEWBOX[0] * scale,
    y: yTop + FEATHER_VIEWBOX[1] * scale,
    scale,
    color,
  });
  return w * scale;
}

/** Latin-only text is a PRD limit (OQ-16): replace characters the embedded fonts cannot encode instead of failing. */
export function safeText(font: PDFFont, text: string): string {
  const set = font.getCharacterSet();
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    out += ch === '\n' || ch === '\t' || set.includes(cp) ? ch.replace('\t', '    ') : '?';
  }
  return out;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
      } else {
        if (line) lines.push(line);
        // break words that are longer than the line
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth) {
          let n = w.length;
          while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n -= 1;
          lines.push(w.slice(0, n));
          w = w.slice(n);
        }
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}
