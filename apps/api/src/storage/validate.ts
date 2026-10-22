/**
 * Upload validation by file signature, not by the name or Content-Type the client sent (PRD NFR-S7, FR-066):
 * a PPTX renamed to .pdf, or an HTML file renamed to anything, is rejected.
 */
export type DetectedType = 'pdf' | 'ppt' | 'pptx' | 'png' | 'jpg' | 'zip';

const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

export function sniffFileType(bytes: Buffer, extension: string): DetectedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ppt'; // OLE2 container
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A ZIP container. PPTX is a ZIP holding ppt/ parts (names are stored uncompressed in the headers).
    if (bytes.includes('ppt/')) return 'pptx';
    return extension === 'pptx' ? null : 'zip';
  }
  return null;
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : '';
}

const EQUIVALENT: Record<string, string[]> = { jpg: ['jpg', 'jpeg'], jpeg: ['jpg', 'jpeg'] };

export interface UploadRules {
  filename: string;
  bytes: Buffer;
  allowedExtensions: string[];
  maxMb: number;
}

export type UploadCheck =
  { ok: true; extension: string; detected: DetectedType } | { ok: false; message: string };

export function checkUpload({
  filename,
  bytes,
  allowedExtensions,
  maxMb,
}: UploadRules): UploadCheck {
  if (bytes.length === 0) return { ok: false, message: 'The file is empty' };
  const mb = bytes.length / (1024 * 1024);
  if (mb > maxMb) {
    return { ok: false, message: `File is ${mb.toFixed(1)} MB; the limit is ${maxMb} MB` };
  }
  const ext = extensionOf(filename);
  if (!allowedExtensions.includes(ext)) {
    return {
      ok: false,
      message: `This field accepts ${allowedExtensions.map((e) => e.toUpperCase()).join(', ')} files`,
    };
  }
  const detected = sniffFileType(bytes, ext);
  const expected = EQUIVALENT[ext] ?? [ext];
  if (!detected || !expected.includes(detected)) {
    return {
      ok: false,
      message: `The file does not look like a real ${ext.toUpperCase()} file. Check the file and try again`,
    };
  }
  return { ok: true, extension: ext, detected };
}

/** Strip path parts and control characters so the stored original name is safe to show and to put in headers. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
  return base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '_').slice(0, 120) || 'file';
}
