// Minimal Google Sheets API client — zero external dependencies (node fetch).
// OAuth: installed-app flow with a long-lived refresh token (one-time consent).
// Creds live only in secrets (env): GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN, SHEET_ID.

export interface SheetsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
}

export function loadSheetsConfig(env: NodeJS.ProcessEnv = process.env): SheetsConfig {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = env.SHEET_ID;
  const missing = [
    !clientId && "GOOGLE_OAUTH_CLIENT_ID",
    !clientSecret && "GOOGLE_OAUTH_CLIENT_SECRET",
    !refreshToken && "GOOGLE_REFRESH_TOKEN",
    !spreadsheetId && "SHEET_ID",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Google Sheets config missing: ${missing.join(", ")} (set them in secrets)`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken!, spreadsheetId: spreadsheetId! };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** OAuth access token via refresh token; cached until ~60s before expiry.
 * Google intermittently answers 400 (INVALID_ARGUMENT / JSON payload) on
 * refresh — retry twice before failing. */
export async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * attempt));
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: unknown;
      error_description?: unknown;
    };
    if (res.ok && data.access_token) {
      cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return data.access_token;
    }
    lastErr = JSON.stringify(data).slice(0, 300);
  }
  throw new Error(`Google token refresh failed after 3 attempts: ${lastErr}`);
}

/** GET /v4/spreadsheets/{id}/values/{range} → cell matrix (row-major). Empty range → []. */
export async function sheetsValuesGet(cfg: SheetsConfig, range: string): Promise<string[][]> {
  const token = await getAccessToken(cfg);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Sheets GET ${range} failed (${res.status}): ${data.error?.message ?? "?"}`);
  return data.values ?? [];
}

/** PUT /v4/spreadsheets/{id}/values/{range}?valueInputOption=RAW — replaces the range. */
export async function sheetsValuesPut(cfg: SheetsConfig, range: string, values: string[][]): Promise<void> {
  const token = await getAccessToken(cfg);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, values }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Sheets PUT ${range} failed (${res.status}): ${data.error?.message ?? "?"}`);
  }
}

export function explorerLink(chainId: number, address: string): string {
  const base =
    chainId === 137 ? "https://polygonscan.com/address/" :
    chainId === 8453 ? "https://basescan.org/address/" :
    chainId === 42161 ? "https://arbiscan.io/address/" :
    "https://etherscan.io/address/";
  return base + address;
}
