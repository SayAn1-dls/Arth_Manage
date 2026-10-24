import { inlineToText, parseMarkdown, type Block, type GuidebookSection } from '@arthakram/shared';
import { degrees, type PDFPage } from 'pdf-lib';
import {
  createBrandDocument,
  drawFeather,
  PDF_COLORS,
  safeText,
  wrapText,
  type BrandFonts,
} from '../../pdf/brand.js';

const PAGE = { w: 595.28, h: 841.89, margin: 56 };
const BODY = 10.5;
const LEADING = 1.55;

interface GuidebookPdfInput {
  eventName: string;
  timeZone: string;
  versionLabel: string;
  date: Date;
  sections: GuidebookSection[];
  watermark?: string;
}

/**
 * Guidebook PDF (PRD FR-022): event name, version, publish date, page numbers and every visible section in
 * order. Set in the brand fonts on White; the draft preview carries a diagonal DRAFT watermark.
 */
export async function renderGuidebookPdf(input: GuidebookPdfInput): Promise<Uint8Array> {
  const { doc, fonts } = await createBrandDocument();
  doc.setTitle(`${input.eventName} guidebook`);
  doc.setAuthor('Arthakram');

  const dateText = new Intl.DateTimeFormat('en-IN', {
    timeZone: input.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(input.date);
  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE.w, PAGE.h]);
  pages.push(page);
  let y = PAGE.h - PAGE.margin;

  // Cover header
  drawFeather(page, PAGE.margin, y, 44);
  y -= 76;
  for (const line of wrapText(
    safeText(fonts.display, input.eventName),
    fonts.display,
    28,
    PAGE.w - PAGE.margin * 2,
  )) {
    page.drawText(line, {
      x: PAGE.margin,
      y,
      size: 28,
      font: fonts.display,
      color: PDF_COLORS.ink,
    });
    y -= 32;
  }
  page.drawText(safeText(fonts.bold, 'GUIDEBOOK'), {
    x: PAGE.margin,
    y: y - 4,
    size: 9,
    font: fonts.bold,
    color: PDF_COLORS.ink,
  });
  page.drawText(
    safeText(fonts.text, `${input.versionLabel}  ·  ${input.date ? `Updated ${dateText}` : ''}`),
    {
      x: PAGE.margin,
      y: y - 22,
      size: 9.5,
      font: fonts.text,
      color: PDF_COLORS.graphite,
    },
  );
  y -= 34;
  page.drawRectangle({ x: PAGE.margin, y: y, width: 64, height: 3, color: PDF_COLORS.ember });
  y -= 30;

  const ensure = (needed: number) => {
    if (y - needed < PAGE.margin + 20) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      pages.push(page);
      y = PAGE.h - PAGE.margin;
    }
  };

  const drawLines = (
    lines: string[],
    font: BrandFonts['text'],
    size: number,
    x: number,
    color = PDF_COLORS.graphite,
  ) => {
    for (const line of lines) {
      ensure(size * LEADING);
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size * LEADING;
    }
  };

  const textWidth = PAGE.w - PAGE.margin * 2;
  const drawBlock = (b: Block) => {
    if (b.type === 'heading') {
      const size = b.level === 1 ? 16 : b.level === 2 ? 14 : 12;
      y -= 6;
      ensure(size * 2);
      drawLines(
        wrapText(
          safeText(fonts.displayBold, inlineToText(b.children)),
          fonts.displayBold,
          size,
          textWidth,
        ),
        fonts.displayBold,
        size,
        PAGE.margin,
        PDF_COLORS.ink,
      );
      y -= 3;
    } else if (b.type === 'paragraph') {
      drawLines(
        wrapText(safeText(fonts.text, inlineToText(b.children)), fonts.text, BODY, textWidth),
        fonts.text,
        BODY,
        PAGE.margin,
      );
      y -= 6;
    } else if (b.type === 'list') {
      b.items.forEach((item, i) => {
        const marker = b.ordered ? `${i + 1}.` : '•';
        const lines = wrapText(
          safeText(fonts.text, inlineToText(item)),
          fonts.text,
          BODY,
          textWidth - 18,
        );
        ensure(BODY * LEADING);
        page.drawText(safeText(fonts.text, marker), {
          x: PAGE.margin,
          y: y - BODY,
          size: BODY,
          font: fonts.text,
          color: PDF_COLORS.graphite,
        });
        drawLines(lines, fonts.text, BODY, PAGE.margin + 18);
      });
      y -= 6;
    } else {
      const cols = Math.max(b.header.length, 1);
      const colW = textWidth / cols;
      const row = (cells: string[], font: BrandFonts['text'], bg: boolean) => {
        const wrapped = cells.map((c) => wrapText(safeText(font, c), font, 9.5, colW - 10));
        const rows = Math.max(...wrapped.map((w) => w.length));
        const h = rows * 9.5 * LEADING + 8;
        ensure(h);
        if (bg)
          page.drawRectangle({
            x: PAGE.margin,
            y: y - h,
            width: textWidth,
            height: h,
            color: PDF_COLORS.blush,
          });
        wrapped.forEach((lines, ci) =>
          lines.forEach((ln, li) =>
            page.drawText(ln, {
              x: PAGE.margin + ci * colW + 5,
              y: y - 13 - li * 9.5 * LEADING,
              size: 9.5,
              font,
              color: PDF_COLORS.ink,
            }),
          ),
        );
        y -= h;
        page.drawLine({
          start: { x: PAGE.margin, y },
          end: { x: PAGE.margin + textWidth, y },
          thickness: 0.5,
          color: PDF_COLORS.graphite,
          opacity: 0.4,
        });
      };
      row(b.header.map(inlineToText), fonts.bold, true);
      for (const r of b.rows) row(r.map(inlineToText), fonts.text, false);
      y -= 8;
    }
  };

  for (const section of input.sections) {
    ensure(70);
    // Section title with an Ember rule, like the kit's section bars
    page.drawRectangle({
      x: PAGE.margin,
      y: y - 22,
      width: 4,
      height: 20,
      color: PDF_COLORS.ember,
    });
    drawLines(
      wrapText(safeText(fonts.display, section.title), fonts.display, 18, textWidth - 14),
      fonts.display,
      18,
      PAGE.margin + 12,
      PDF_COLORS.ink,
    );
    y -= 8;
    const blocks = parseMarkdown(section.body);
    if (blocks.length === 0)
      drawLines(
        [safeText(fonts.italic, 'This section has no content yet.')],
        fonts.italic,
        BODY,
        PAGE.margin,
      );
    blocks.forEach(drawBlock);
    y -= 14;
  }

  // Footer and optional watermark on every page
  pages.forEach((p, i) => {
    p.drawText(safeText(fonts.text, `${input.eventName}  ·  ${input.versionLabel}`), {
      x: PAGE.margin,
      y: 28,
      size: 8,
      font: fonts.text,
      color: PDF_COLORS.graphite,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: PAGE.w - PAGE.margin - fonts.text.widthOfTextAtSize(label, 8),
      y: 28,
      size: 8,
      font: fonts.text,
      color: PDF_COLORS.graphite,
    });
    if (input.watermark) {
      p.drawText(input.watermark, {
        x: 130,
        y: 300,
        size: 120,
        font: fonts.display,
        color: PDF_COLORS.peach,
        opacity: 0.45,
        rotate: degrees(40),
      });
    }
  });

  return doc.save();
}
