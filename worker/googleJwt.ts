// Google ID token (JWT, RS256) verification with WebCrypto: no client secret, no library.
// Google's public signing keys (JWKS) are cached in memory for as long as Google's Cache-Control allows, and also in
// the Cache API so fresh isolates rarely need the network. An unknown `kid` (key rotation) refetches at most once a minute.
import { AUTH, GOOGLE_CLIENT_ID, GOOGLE_ISSUERS, GOOGLE_JWKS_URL } from '../shared/auth';

export interface GoogleClaims {
  sub: string;
  name?: string;
  picture?: string;
  /** Only compared against ADMIN_EMAILS during sign-in (worker/admin.ts), never stored. */
  email?: string;
  email_verified?: boolean;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export type JwksFetcher = () => Promise<{ keys: JsonWebKey[]; maxAge: number }>;
export class JwtError extends Error {}

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const TOKEN_MAX = 4096;

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new JwtError('bad encoding');
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const parsePart = (s: string) => {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new JwtError('bad token');
};

/** Fetches Google's JWKS (Cache API first when available) and reads its max-age. */
export const fetchGoogleJwks: JwksFetcher = async () => {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  let res = cache ? await cache.match(GOOGLE_JWKS_URL).catch(() => undefined) : undefined;
  if (!res) {
    res = await fetch(GOOGLE_JWKS_URL);
    if (!res.ok) throw new JwtError('keys unavailable');
    if (cache) await cache.put(GOOGLE_JWKS_URL, res.clone()).catch(() => undefined);
  }
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
  const age = Number(res.headers.get('age') ?? 0) || 0;
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  return { keys: Array.isArray(body.keys) ? body.keys : [], maxAge: Math.max(60, (m ? Number(m[1]) : 3600) - age) };
};

/** Imported RSA keys by `kid`, refreshed when Google's max-age runs out or an unknown kid shows up. */
export class JwksCache {
  private keys = new Map<string, CryptoKey>();
  private expires = 0;
  private lastFetch = 0;
  private loading: Promise<void> | null = null;

  constructor(private fetcher: JwksFetcher = fetchGoogleJwks, private now: () => number = Date.now) {}

  private async refresh() {
    const { keys, maxAge } = await this.fetcher();
    const next = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      const kid = (jwk as { kid?: unknown }).kid;
      if (typeof kid !== 'string' || jwk.kty !== 'RSA') continue;
      next.set(kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, ALG, false, ['verify']));
    }
    this.keys = next;
    this.lastFetch = this.now();
    this.expires = this.lastFetch + maxAge * 1000;
  }

  async get(kid: string): Promise<CryptoKey | null> {
    const t = this.now();
    const stale = t >= this.expires, unknown = !this.keys.has(kid) && t - this.lastFetch > 60_000;
    if (stale || unknown) {
      this.loading ??= this.refresh().finally(() => (this.loading = null));
      await this.loading;
    }
    return this.keys.get(kid) ?? null;
  }
}

/**
 * Checks a Google ID token: RS256 signature by a current Google key, issuer, audience (our client id), expiry and
 * issue time (with a little clock skew), and a usable `sub`. Throws JwtError with a short reason otherwise.
 */
export async function verifyGoogleIdToken(token: string, jwks: JwksCache, opts: { clientId?: string; now?: number } = {}): Promise<GoogleClaims> {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) throw new JwtError('bad token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('bad token');
  const header = parsePart(parts[0]), claims = parsePart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new JwtError('bad algorithm');
  const key = await jwks.get(header.kid);
  if (!key) throw new JwtError('unknown key');
  const ok = await crypto.subtle.verify(ALG, key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new JwtError('bad signature');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!GOOGLE_ISSUERS.includes(claims.iss as (typeof GOOGLE_ISSUERS)[number])) throw new JwtError('bad issuer');
  if (claims.aud !== (opts.clientId ?? GOOGLE_CLIENT_ID)) throw new JwtError('bad audience');
  if (typeof claims.exp !== 'number' || claims.exp + AUTH.skew < now) throw new JwtError('expired');
  if (typeof claims.iat !== 'number' || claims.iat - AUTH.skew > now) throw new JwtError('issued in the future');
  if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) throw new JwtError('bad subject');
  // email_verified is not required: the account is identified by `sub` and the e-mail is never read or stored.
  return claims as unknown as GoogleClaims;
}
