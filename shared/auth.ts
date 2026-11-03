// Google sign-in + cloud save: constants and API shapes shared by the game client (src/net/auth.ts, cloudSave.ts)
// and the Worker (worker/auth.ts, worker/Account.ts). No secret is involved anywhere: the browser gets a Google ID
// token (a signed JWT) from Google Identity Services and the Worker checks its signature against Google's public keys.

/** Public OAuth Web client id. The Worker accepts only ID tokens issued for it (`aud`). */
export const GOOGLE_CLIENT_ID = '922300216404-mpcmv3l63dgks0k3j9a86sipboi6u84o.apps.googleusercontent.com';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'] as const;
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export const SESSION_COOKIE = 'moto_sid';
export const AUTH = {
  /** Sliding session lifetime: every use pushes the expiry out again. */
  sessionDays: 60,
  /** Sessions kept per account (oldest dropped first). */
  sessionsMax: 20,
  /** Allowed clock difference when checking a token's exp / iat, seconds. */
  skew: 120,
  /** Request body caps. */
  authBodyMax: 8 * 1024,
  saveBodyMax: 256 * 1024,
  /** Per IP: sign-in attempts per minute. Per account: save writes per minute. */
  authPerMin: 12,
  savesPerMin: 20,
} as const;

/** Cookie value: `<user key (32 hex)>.<session token (43 base64url)>`. The user key names the account's Durable Object. */
export const SID_RE = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

/** Reads one cookie from a Cookie header (tolerates spaces, quotes and repeated names: the first wins). */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    let v = part.slice(i + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return null;
}

/** Parses the session cookie into the account key and the raw token; null when missing or malformed. */
export function parseSessionCookie(header: string | null | undefined): { key: string; token: string } | null {
  const v = readCookie(header, SESSION_COOKIE);
  const m = v ? SID_RE.exec(v) : null;
  return m ? { key: m[1], token: m[2] } : null;
}

/** Set-Cookie value for the session (empty value + Max-Age=0 clears it). `secure` is off only for http://localhost. */
export function sessionCookie(value: string, secure: boolean, maxAge = AUTH.sessionDays * 86400) {
  return `${SESSION_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// ---------------------------------------------------------------- API shapes
/** What the client may know about the signed-in account (no e-mail: it is never stored). */
export interface PublicUser {
  /** Account key (hex): stable per Google account, not the Google id itself. */
  uid: string;
  name: string;
  picture: string;
  /** Pinned admin account (worker/admin.ts). Decided by the server on every request, never by the client. */
  admin?: boolean;
}
/** `admin: true` only for admins. */
export interface MeResponse { user: PublicUser | null; admin?: boolean }
export interface AuthResponse { ok: boolean; user?: PublicUser; error?: string }
