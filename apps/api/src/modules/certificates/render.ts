import QRCode from 'qrcode';
import { DEFAULT_PLACEMENTS, type CertField } from '@arthakram/shared';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Storage } from './types.js';
import {
  createBrandDocument,
  drawFeather,
  PDF_COLORS,
  safeText,
  wrapText,
} from '../../pdf/brand.js';
import { degrees, rgb } from 'pdf-lib';

export interface Placement {
  field: CertField;
  x: number;
  y: number;
  font: 'display' | 'sans' | 'sansBold';
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  maxWidth: number;
}

export interface CertificateData {
  type: 'PARTICIPATION' | 'WINNER';
  recipientName: string;
  eventName: string;
  teamName: string | null;
  awardText: string | null;
  date: Date;
  timeZone: string;
  code: string;
  placements?: Placement[];
  backgroundKey?: string | null;
  watermark?: string;
  verificationUrl?: string;
}

const PAGE: [number, number] = [841.89, 595.28]; // A4 landscape

const hex = (h: string) =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );

/**
 * Draws text that always fits its box: it shrinks down to 60% of the set size, then wraps to at most two lines
 * (PRD FR-230). Characters the font cannot encode become '?', so a name never breaks generation (Latin only, OQ-16).
 */
export function drawFitted(
  page: PDFPage,
  text: string,
  font: PDFFont,
  p: Placement,
  pageW: number,
  pageH: number,
) {
  const clean = safeText(font, text);
  const maxW = p.maxWidth * pageW;
  let size = p.size;
  let lines = [clean];
  if (font.widthOfTextAtSize(clean, size) > maxW) {
    const min = size * 0.6;
    while (size > min && font.widthOfTextAtSize(clean, size) > maxW) size -= 0.5;
    if (font.widthOfTextAtSize(clean, size) > maxW) {
      lines = wrapText(clean, font, size, maxW).slice(0, 2);
      // A very long unbroken string is clipped by wrapText's word breaking; keep the two lines inside the box.
    }
  }
  const x0 = p.x * pageW;
  const top = pageH - p.y * pageH;
  lines.forEach((line, i) => {
    const w = font.widthOfTextAtSize(line, size);
    const x = p.align === 'left' ? x0 : p.align === 'right' ? x0 - w : x0 - w / 2;
    page.drawText(line, {
      x,
      y: top - size * 0.8 - i * size * 1.15,
      size,
      font,
      color: hex(p.color),
    });
  });
  return { size, lines: lines.length };
}

/** The certificate PDF. With a background image only the fields are drawn; otherwise a plain branded design is used. */
export async function renderCertificate(
  data: CertificateData,
  storage: Storage,
): Promise<Uint8Array> {
  const { doc, fonts } = await createBrandDocument();
  doc.setTitle(`${data.eventName} certificate`);
  doc.setAuthor('Arthakram');
  const page = doc.addPage(PAGE);
  const [w, h] = PAGE;

  if (data.backgroundKey) {
    const bytes = await storage.get(data.backgroundKey);
    const img = bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // cover the page without distortion
    const scale = Math.max(w / img.width, h / img.height);
    page.drawImage(img, {
      x: (w - img.width * scale) / 2,
      y: (h - img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
  } else {
    page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: PDF_COLORS.white });
    page.drawRectangle({ x: 0, y: h - 14, width: w, height: 14, color: PDF_COLORS.ember });
    page.drawRectangle({
      x: 40,
      y: 40,
      width: w - 80,
      height: h - 94,
      borderColor: PDF_COLORS.peach,
      borderWidth: 1.5,
    });
    drawFeather(page, 64, h - 66, 54);
    const title =
      data.type === 'WINNER' ? 'Certificate of achievement' : 'Certificate of participation';
    page.drawText(title, {
      x: w - 64 - fonts.display.widthOfTextAtSize(title, 26),
      y: h - 100,
      size: 26,
      font: fonts.display,
      color: PDF_COLORS.ink,
    });
    page.drawText('This certifies that', {
      x: w / 2 - fonts.text.widthOfTextAtSize('This certifies that', 13) / 2,
      y: h * 0.62,
      size: 13,
      font: fonts.text,
      color: PDF_COLORS.graphite,
    });
    page.drawRectangle({
      x: w / 2 - 40,
      y: h * 0.18,
      width: 80,
      height: 3,
      color: PDF_COLORS.ember,
    });
  }

  const placements = data.placements?.length ? data.placements : DEFAULT_PLACEMENTS;
  const value: Record<CertField, string | null> = {
    NAME: data.recipientName,
    EVENT: data.eventName,
    TEAM: data.teamName ? `Team ${data.teamName}` : null,
    AWARD: data.awardText ?? (data.type === 'PARTICIPATION' ? 'for taking part' : null),
    DATE: new Intl.DateTimeFormat('en-IN', {
      timeZone: data.timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(data.date),
    CODE: `ID ${data.code}`,
  };
  const fontOf = { display: fonts.display, sans: fonts.text, sansBold: fonts.bold } as const;
  for (const p of placements) {
    const text = value[p.field];
    if (text) drawFitted(page, text, fontOf[p.font], p, w, h);
  }
  if (data.verificationUrl) {
    const png = await QRCode.toBuffer(data.verificationUrl, { type: 'png', width: 200, margin: 2 });
    const qr = await doc.embedPng(png);
    page.drawImage(qr, { x: w - 125, y: 48, width: 72, height: 72 });
    page.drawText('Verify certificate', {
      x: w - 125,
      y: 38,
      size: 8,
      font: fonts.text,
      color: PDF_COLORS.ink,
    });
  }
  if (data.watermark) {
    page.drawText(data.watermark, {
      x: 190,
      y: 190,
      size: 110,
      font: fonts.display,
      color: PDF_COLORS.peach,
      opacity: 0.4,
      rotate: degrees(25),
    });
  }
  return doc.save();
}
