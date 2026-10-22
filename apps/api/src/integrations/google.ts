/**
 * The only place that talks to Google. Everything else depends on this interface, so retry, idempotency and
 * truthfulness are tested with a fake while the real implementation stays a thin REST client.
 */
export type GoogleErrorKind = 'TOKEN_REVOKED' | 'NOT_FOUND' | 'QUOTA' | 'OTHER';

export class GoogleError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Plain-language messages shown to organisers; the technical detail stays under "Details" (PRD FR-177). */
export const FRIENDLY: Record<GoogleErrorKind, string> = {
  TOKEN_REVOKED: 'Google access was removed. Reconnect to resume syncing.',
  NOT_FOUND: "The spreadsheet can't be found. Create a new one or reconnect.",
  QUOTA: 'Google is limiting requests; retrying automatically.',
  OTHER: 'Google could not complete the sync. It will be retried automatically.',
};

export interface TabRef {
  key: string;
  title: string;
  /** Google's numeric tab id, once known. A renamed tab keeps its id, so it is never duplicated. */
  sheetId?: number;
}

export interface GoogleProvider {
  /** True when this server has Google credentials and an encryption key. */
  configured: boolean;
  authUrl(state: string, withDrive: boolean): string;
  exchangeCode(code: string): Promise<{ refreshToken: string; email: string }>;
  /** Creates the spreadsheet with one empty tab per entry; returns Google's ids. */
  createSpreadsheet(
    refreshToken: string,
    title: string,
    tabs: TabRef[],
  ): Promise<{ spreadsheetId: string; url: string; tabIds: Record<string, number> }>;
  /** Clears the tab, then writes every row. Recreates the tab if it was deleted. Returns the tab id. */
  writeTab(
    refreshToken: string,
    spreadsheetId: string,
    tab: TabRef,
    rows: string[][],
    bannerRows: number,
  ): Promise<number>;
  createFolder(refreshToken: string, name: string, parentId?: string): Promise<string>;
  uploadFile(
    refreshToken: string,
    folderId: string,
    name: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<string>;
}

const SCOPES = {
  sheets: 'https://www.googleapis.com/auth/drive.file', // only files this app creates
  email: 'openid email',
};

/** Base URLs, overridable so the real client can be exercised against a local stand-in server in tests. */
export interface GoogleEndpoints {
  oauth: string;
  token: string;
  userinfo: string;
  sheets: string;
  drive: string;
  upload: string;
}
export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  oauth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  sheets: 'https://sheets.googleapis.com/v4/spreadsheets',
  drive: 'https://www.googleapis.com/drive/v3/files',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
};

interface Creds {
  endpoints?: GoogleEndpoints;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  encryptionKeyOk: boolean;
}

/** REST client for Google OAuth, Sheets v4 and Drive v3. Not exercised without real credentials. */
export function createGoogleProvider(c: Creds): GoogleProvider {
  const ep = c.endpoints ?? GOOGLE_ENDPOINTS;
  const configured = Boolean(c.clientId && c.clientSecret && c.encryptionKeyOk);

  async function call(url: string, init: RequestInit & { token?: string }): Promise<Response> {
    const { token, ...rest } = init;
    const res = await fetch(url, {
      ...rest,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...rest.headers },
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    if (res.status === 401 || (res.status === 403 && /invalid_grant|revoked|unauthor/i.test(text)))
      throw new GoogleError('TOKEN_REVOKED', `${res.status} ${text.slice(0, 300)}`);
    if (res.status === 404)
      throw new GoogleError('NOT_FOUND', `${res.status} ${text.slice(0, 300)}`);
    if (res.status === 429 || (res.status === 403 && /quota|rate/i.test(text)))
      throw new GoogleError('QUOTA', `${res.status} ${text.slice(0, 300)}`);
    throw new GoogleError('OTHER', `${res.status} ${text.slice(0, 300)}`);
  }

  async function accessToken(refreshToken: string): Promise<string> {
    const res = await fetch(ep.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId ?? '',
        client_secret: c.clientSecret ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (res.ok && body.access_token) return body.access_token;
    if (body.error === 'invalid_grant')
      throw new GoogleError('TOKEN_REVOKED', 'Refresh token rejected (invalid_grant)');
    throw new GoogleError('OTHER', `Token refresh failed: ${res.status} ${body.error ?? ''}`);
  }

  const quote = (t: string) => `'${t.replace(/'/g, "''")}'`;

  return {
    configured,
    authUrl(state) {
      return `${ep.oauth}?${new URLSearchParams({
        client_id: c.clientId ?? '',
        redirect_uri: c.redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: `${SCOPES.email} ${SCOPES.sheets}`,
        state,
      })}`;
    },
    async exchangeCode(code) {
      const res = await fetch(ep.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: c.clientId ?? '',
          client_secret: c.clientSecret ?? '',
          redirect_uri: c.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        refresh_token?: string;
        access_token?: string;
        error?: string;
      };
      if (!res.ok || !body.refresh_token || !body.access_token)
        throw new GoogleError('OTHER', `Code exchange failed: ${res.status} ${body.error ?? ''}`);
      const info = (await (await call(ep.userinfo, { token: body.access_token })).json()) as {
        email?: string;
      };
      return { refreshToken: body.refresh_token, email: info.email ?? 'unknown' };
    },
    async createSpreadsheet(refreshToken, title, tabs) {
      const token = await accessToken(refreshToken);
      const res = await call(ep.sheets, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title },
          sheets: tabs.map((t) => ({ properties: { title: t.title } })),
        }),
      });
      const body = (await res.json()) as {
        spreadsheetId: string;
        spreadsheetUrl: string;
        sheets: { properties: { sheetId: number; title: string } }[];
      };
      return {
        spreadsheetId: body.spreadsheetId,
        url: body.spreadsheetUrl,
        tabIds: Object.fromEntries(
          tabs.map((t) => [
            t.key,
            body.sheets.find((s) => s.properties.title === t.title)!.properties.sheetId,
          ]),
        ),
      };
    },
    async writeTab(refreshToken, spreadsheetId, tab, rows, bannerRows) {
      const token = await accessToken(refreshToken);
      const base = `${ep.sheets}/${spreadsheetId}`;
      const meta = (await (await call(`${base}?fields=sheets.properties`, { token })).json()) as {
        sheets: { properties: { sheetId: number; title: string } }[];
      };
      // Tabs are matched by Google's id, so a renamed tab is reused rather than duplicated (FR-174).
      let found = meta.sheets.find((s) => s.properties.sheetId === tab.sheetId)?.properties;
      if (!found) {
        const added = (await (
          await call(`${base}:batchUpdate`, {
            method: 'POST',
            token,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: `${tab.title}` } } }],
            }),
          })
        ).json()) as {
          replies: { addSheet: { properties: { sheetId: number; title: string } } }[];
        };
        found = added.replies[0]!.addSheet.properties;
      }
      const range = quote(found.title);
      await call(`${base}/values/${encodeURIComponent(range)}:clear`, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      await call(`${base}/values/${encodeURIComponent(`${range}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      });
      await call(`${base}:batchUpdate`, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: found.sheetId,
                  gridProperties: { frozenRowCount: bannerRows + 1 },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        }),
      });
      return found.sheetId;
    },
    async createFolder(refreshToken, name, parentId) {
      const token = await accessToken(refreshToken);
      const res = await call(`${ep.drive}?fields=id`, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    async uploadFile(refreshToken, folderId, name, bytes, contentType) {
      const token = await accessToken(refreshToken);
      const boundary = `ak${Date.now()}`;
      const meta = JSON.stringify({ name, parents: [folderId] });
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await call(`${ep.upload}?uploadType=multipart&fields=id`, {
        method: 'POST',
        token,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return ((await res.json()) as { id: string }).id;
    },
  };
}
