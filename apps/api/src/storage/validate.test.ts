import { describe, expect, it } from 'vitest';
import { checkUpload, safeFilename } from './validate.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
const pptx = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....ppt/slides/slide1.xml....'),
]);
const docx = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....word/document.xml....'),
]);
const html = Buffer.from('<html><script>alert(1)</script></html>');

const rules = (filename: string, bytes: Buffer, allowed = ['pdf', 'ppt', 'pptx'], maxMb = 25) =>
  checkUpload({ filename, bytes, allowedExtensions: allowed, maxMb });

describe('upload validation by signature', () => {
  it('accepts real PDF and PPTX files', () => {
    expect(rules('deck.pdf', pdf).ok).toBe(true);
    expect(rules('deck.pptx', pptx).ok).toBe(true);
  });
  it('rejects a PPTX renamed to .pdf (AT-05N1) and an HTML file renamed to .pdf', () => {
    const res = rules('deck.pdf', pptx);
    expect(res.ok).toBe(false);
    expect(rules('deck.pdf', html).ok).toBe(false);
  });
  it('rejects a DOCX renamed to .pptx and disallowed extensions', () => {
    expect(rules('x.pptx', docx).ok).toBe(false);
    expect(rules('x.exe', pdf).ok).toBe(false);
    expect(rules('x', pdf).ok).toBe(false);
  });
  it('enforces the size limit with a readable message and rejects empty files', () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2 * 1024 * 1024)]);
    const res = rules('deck.pdf', big, ['pdf'], 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/limit is 1 MB/);
    expect(rules('deck.pdf', Buffer.alloc(0)).ok).toBe(false);
  });
  it('sanitises stored file names', () => {
    expect(safeFilename('../../etc/pass"wd.pdf')).toBe('pass_wd.pdf');
  });
});
