import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GoogleEndpoints } from './google.js';

/**
 * A local stand-in that imitates the parts of Google's OAuth, Sheets v4 and Drive v3 REST contracts the client
 * uses, following the public documentation. It exists to exercise the real HTTP client (URLs, encoding, bodies,
 * error mapping). It is NOT Google: passing against it proves nothing about Google's actual behaviour.
 */
export class GoogleStub {
  server!: Server;
  base = '';
  revoked = new Set<string>();
  /** Respond with this status to the next matching call, e.g. { match: 'values', status: 429 }. */
  failNext: { match: string; status: number; body?: string }[] = [];
  sheets = new Map<
    string,
    { title: string; tabs: Map<number, { title: string; values: string[][]; frozen: number }> }
  >();
  folders = new Map<string, { name: string; parents: string[] }>();
  files = new Map<string, { name: string; parents: string[]; bytes: number; mime: string }>();
  log: string[] = [];
  private n = 100;

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  get endpoints(): GoogleEndpoints {
    return {
      oauth: `${this.base}/o/oauth2/v2/auth`,
      token: `${this.base}/token`,
      userinfo: `${this.base}/userinfo`,
      sheets: `${this.base}/v4/spreadsheets`,
      drive: `${this.base}/drive/v3/files`,
      upload: `${this.base}/upload/drive/v3/files`,
    };
  }

  private id(p: string) {
    return `${p}${++this.n}`;
  }
  private async body(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.base);
    const raw = await this.body(req);
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const err = (status: number, message: string, reason = 'error') =>
      send(status, { error: { code: status, message, errors: [{ reason }] } });
    const path = decodeURIComponent(url.pathname);
    this.log.push(`${req.method} ${path}`);

    const injected = this.failNext.findIndex((f) => path.includes(f.match));
    if (injected >= 0) {
      const f = this.failNext.splice(injected, 1)[0]!;
      return f.body
        ? (res.writeHead(f.status, { 'Content-Type': 'application/json' }), res.end(f.body))
        : err(f.status, 'injected', f.status === 429 ? 'rateLimitExceeded' : 'backendError');
    }

    // OAuth token endpoint: refresh and code exchange
    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(raw.toString());
      if (form.get('grant_type') === 'refresh_token') {
        if (!form.get('client_id') || !form.get('client_secret'))
          return send(401, { error: 'invalid_client' });
        if (this.revoked.has(form.get('refresh_token') ?? ''))
          return send(400, {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          });
        return send(200, {
          access_token: `at-${form.get('refresh_token')}`,
          expires_in: 3599,
          token_type: 'Bearer',
        });
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') === 'bad') return send(400, { error: 'invalid_grant' });
        return send(200, {
          access_token: 'at-first',
          refresh_token: `rt-${form.get('code')}`,
          expires_in: 3599,
          token_type: 'Bearer',
        });
      }
      return send(400, { error: 'unsupported_grant_type' });
    }

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer at-'))
      return err(401, 'Request had invalid authentication credentials.', 'authError');
    if (this.revoked.has(auth.slice('Bearer at-'.length)))
      return err(401, 'Invalid Credentials', 'authError');

    if (path === '/userinfo') return send(200, { email: 'organiser@example.test' });

    // Sheets v4
    if (path === '/v4/spreadsheets' && req.method === 'POST') {
      const b = JSON.parse(raw.toString()) as {
        properties: { title: string };
        sheets?: { properties: { title: string } }[];
      };
      const id = this.id('sheet');
      const tabs = new Map<number, { title: string; values: string[][]; frozen: number }>();
      for (const s of b.sheets ?? [{ properties: { title: 'Sheet1' } }])
        tabs.set(this.n++, { title: s.properties.title, values: [], frozen: 0 });
      this.sheets.set(id, { title: b.properties.title, tabs });
      return send(200, {
        spreadsheetId: id,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        sheets: [...tabs].map(([sheetId, t]) => ({ properties: { sheetId, title: t.title } })),
      });
    }
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(path);
    if (m) {
      const sheet = this.sheets.get(m[1]!);
      if (!sheet) return err(404, 'Requested entity was not found.', 'notFound');
      const rest = m[2]!;
      if (rest === '' && req.method === 'GET')
        return send(200, {
          sheets: [...sheet.tabs].map(([sheetId, t]) => ({
            properties: { sheetId, title: t.title },
          })),
        });
      if (rest === ':batchUpdate') {
        const b = JSON.parse(raw.toString()) as { requests: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
        const replies: unknown[] = [];
        for (const r of b.requests) {
          if (r.addSheet) {
            const title = r.addSheet.properties.title as string;
            if ([...sheet.tabs.values()].some((t) => t.title === title))
              return err(
                400,
                `A sheet with the name "${title}" already exists. Please enter another name.`,
                'badRequest',
              );
            const sheetId = this.n++;
            sheet.tabs.set(sheetId, { title, values: [], frozen: 0 });
            replies.push({ addSheet: { properties: { sheetId, title } } });
          } else if (r.updateSheetProperties) {
            const t = sheet.tabs.get(r.updateSheetProperties.properties.sheetId);
            if (!t) return err(400, 'No sheet with id', 'badRequest');
            t.frozen = r.updateSheetProperties.properties.gridProperties.frozenRowCount;
            replies.push({});
          } else return err(400, 'Unsupported request', 'badRequest');
        }
        return send(200, { spreadsheetId: m[1], replies });
      }
      const range = /^\/values\/(.+?)(:clear)?$/.exec(rest);
      if (range) {
        // A1 notation: 'Tab name'!A1 or 'Tab name' with single quotes doubled inside the name
        const spec = range[1]!;
        const parsed = /^'((?:[^']|'')+)'(?:!([A-Z]+[0-9]*))?$/.exec(spec);
        if (!parsed) return err(400, `Unable to parse range: ${spec}`, 'badRequest');
        const title = parsed[1]!.replace(/''/g, "'");
        const tab = [...sheet.tabs.values()].find((t) => t.title === title);
        if (!tab) return err(400, `Unable to parse range: ${spec}`, 'badRequest');
        if (range[2] === ':clear' && req.method === 'POST') {
          tab.values = [];
          return send(200, { spreadsheetId: m[1], clearedRange: spec });
        }
        if (req.method === 'PUT') {
          if (
            url.searchParams.get('valueInputOption') !== 'RAW' &&
            url.searchParams.get('valueInputOption') !== 'USER_ENTERED'
          )
            return err(400, 'valueInputOption is required', 'badRequest');
          const b = JSON.parse(raw.toString()) as { values: unknown[][] };
          tab.values = b.values.map((row) => row.map(String));
          return send(200, { spreadsheetId: m[1], updatedRows: b.values.length });
        }
      }
    }

    // Drive v3
    if (path === '/drive/v3/files' && req.method === 'POST') {
      const b = JSON.parse(raw.toString()) as {
        name: string;
        mimeType?: string;
        parents?: string[];
      };
      for (const p of b.parents ?? [])
        if (!this.folders.has(p)) return err(404, `File not found: ${p}.`, 'notFound');
      const id = this.id('folder');
      this.folders.set(id, { name: b.name, parents: b.parents ?? [] });
      return send(200, { id });
    }
    if (path === '/upload/drive/v3/files' && req.method === 'POST') {
      const ct = req.headers['content-type'] ?? '';
      const boundary = /boundary=(.+)$/.exec(ct)?.[1];
      if (!ct.startsWith('multipart/related') || !boundary)
        return err(400, 'Bad multipart', 'badRequest');
      const parts = raw
        .toString('latin1')
        .split(`--${boundary}`)
        .filter((p) => p.trim() && p.trim() !== '--');
      const metaPart = parts[0]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, '');
      const meta = JSON.parse(metaPart) as { name: string; parents: string[] };
      for (const p of meta.parents)
        if (!this.folders.has(p)) return err(404, `File not found: ${p}.`, 'notFound');
      const mediaHead = parts[1]!.split('\r\n\r\n');
      const mime = /Content-Type: (.+)/.exec(mediaHead[0]!)?.[1]?.trim() ?? '';
      const id = this.id('file');
      this.files.set(id, {
        name: meta.name,
        parents: meta.parents,
        bytes: Buffer.byteLength(
          mediaHead.slice(1).join('\r\n\r\n').replace(/\r\n$/, ''),
          'latin1',
        ),
        mime,
      });
      return send(200, { id });
    }
    return err(404, `No route ${req.method} ${path}`, 'notFound');
  }
}
