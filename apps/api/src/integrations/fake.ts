import { GoogleError, type GoogleProvider, type TabRef } from './google.js';

/** In-memory Google used only by automated tests of queueing, retry, idempotency and truthful status. */
export class FakeGoogle implements GoogleProvider {
  configured = true;
  spreadsheets = new Map<
    string,
    { title: string; tabs: Map<number, { title: string; rows: string[][] }> }
  >();
  folders = new Map<string, { name: string; parent?: string }>();
  files = new Map<string, { folder: string; name: string; size: number }>();
  calls: string[] = [];
  /** Fail the next calls whose name matches; `times` counts down. */
  failures: { on: string; error: GoogleError; times: number; after?: number }[] = [];
  private n = 0;

  private id(p: string) {
    this.n += 1;
    return `${p}${this.n}`;
  }
  private maybeFail(op: string) {
    this.calls.push(op);
    for (const f of this.failures) {
      if (f.on !== op || f.times <= 0) continue;
      if (f.after && f.after > 0) {
        f.after -= 1;
        continue;
      }
      f.times -= 1;
      throw f.error;
    }
  }

  authUrl(state: string) {
    return `https://accounts.example.test/auth?state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string) {
    this.maybeFail('exchangeCode');
    if (code === 'denied') throw new GoogleError('OTHER', 'exchange denied');
    return { refreshToken: `refresh-${code}`, email: 'organiser@example.test' };
  }
  async createSpreadsheet(_t: string, title: string, tabs: TabRef[]) {
    this.maybeFail('createSpreadsheet');
    const spreadsheetId = this.id('sheet');
    const map = new Map<number, { title: string; rows: string[][] }>();
    const tabIds: Record<string, number> = {};
    for (const t of tabs) {
      const sid = ++this.n;
      map.set(sid, { title: t.title, rows: [] });
      tabIds[t.key] = sid;
    }
    this.spreadsheets.set(spreadsheetId, { title, tabs: map });
    return { spreadsheetId, url: `https://sheets.example.test/${spreadsheetId}`, tabIds };
  }
  async writeTab(_t: string, spreadsheetId: string, tab: TabRef, rows: string[][]) {
    this.maybeFail(`writeTab:${tab.key}`);
    const sheet = this.spreadsheets.get(spreadsheetId);
    if (!sheet) throw new GoogleError('NOT_FOUND', 'spreadsheet missing');
    let sid = tab.sheetId;
    if (sid === undefined || !sheet.tabs.has(sid)) {
      sid = ++this.n; // recreated after the organiser deleted it
      sheet.tabs.set(sid, { title: tab.title, rows: [] });
    }
    sheet.tabs.get(sid)!.rows = rows.map((r) => [...r]); // clear, then write: no duplicates possible
    return sid;
  }
  async createFolder(_t: string, name: string, parentId?: string) {
    this.maybeFail('createFolder');
    const id = this.id('folder');
    this.folders.set(id, { name, parent: parentId });
    return id;
  }
  async uploadFile(_t: string, folderId: string, name: string, bytes: Buffer) {
    this.maybeFail('uploadFile');
    const id = this.id('file');
    this.files.set(id, { folder: folderId, name, size: bytes.length });
    return id;
  }
}
