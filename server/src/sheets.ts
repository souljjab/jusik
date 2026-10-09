import { JWT } from "google-auth-library";
import { readFileSync } from "node:fs";
import type { Cell, Table } from "./tables";

export interface SheetsConfig {
  spreadsheetId: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const CHUNK = 5000;

/** 서비스 계정 JSON 파일로 토큰 공급자를 만든다. 스프레드시트를 그 서비스 계정 이메일에 '편집자'로 공유해야 한다. */
export function sheetsConfigFromEnv(env: NodeJS.ProcessEnv): SheetsConfig | null {
  const id = env.GOOGLE_SHEET_ID?.trim();
  const file = env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  if (!id || !file) return null;
  const cred = JSON.parse(readFileSync(file, "utf8")) as { client_email: string; private_key: string };
  const jwt = new JWT({ email: cred.client_email, key: cred.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return {
    spreadsheetId: id,
    getToken: async () => {
      const t = await jwt.getAccessToken();
      if (!t.token) throw new Error("구글 인증 토큰을 받지 못했어요");
      return t.token;
    },
  };
}

/**
 * 표를 구글 스프레드시트의 같은 이름 탭에 통째로 덮어쓴다(없는 탭은 만든다).
 * 값은 RAW로 넣어 '=...' 같은 문자열이 수식으로 실행되지 않게 한다.
 */
export async function syncSheets(tables: Table[], cfg: SheetsConfig): Promise<{ rows: number }> {
  const f = cfg.fetchImpl ?? fetch;
  const token = await cfg.getToken();
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (url: string, init?: RequestInit) => {
    const res = await f(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) } });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`구글 시트 요청 실패(${res.status}): ${body.error?.message ?? res.statusText}`);
    }
    return res.json() as Promise<any>;
  };

  const meta = await call(`${API}/${cfg.spreadsheetId}?fields=sheets.properties.title`);
  const existing = new Set<string>((meta.sheets ?? []).map((s: any) => s.properties.title));
  const missing = tables.filter((t) => !existing.has(t.name));
  if (missing.length)
    await call(`${API}/${cfg.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((t) => ({ addSheet: { properties: { title: t.name } } })) }),
    });

  let total = 0;
  for (const t of tables) {
    const range = encodeURIComponent(`'${t.name}'`);
    await call(`${API}/${cfg.spreadsheetId}/values/${range}:clear`, { method: "POST", body: "{}" });
    const all: Cell[][] = [t.headers, ...t.rows];
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK);
      const start = encodeURIComponent(`'${t.name}'!A${i + 1}`);
      await call(`${API}/${cfg.spreadsheetId}/values/${start}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: slice }) });
    }
    total += all.length;
  }
  return { rows: total };
}
