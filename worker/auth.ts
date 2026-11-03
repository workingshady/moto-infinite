// Google sign-in, sessions and the cloud save API (/api/auth/*, /api/me, /api/logout, /api/save, /api/account).
//
//   POST   /api/auth/google {credential}  verify the Google ID token → session cookie (moto_sid, HttpOnly, Path=/api)
//   GET    /api/me                        {user} or {user: null}
//   POST   /api/logout                    ends this session (other devices stay signed in)
//   GET    /api/save                      {rev, updatedAt, save, wids}
//   PUT    /api/save {rev, wid, save}     200 {ok, rev} · 409 conflict (refetch, merge, retry) · 401 signed out
//   DELETE /api/account                   wipes the account's Durable Object (profile, sessions, save)
//   POST   /api/admin/unpin {uid?}        admin only: clear the admin pin of an account key (default: your own)
//   POST   /api/auth/dev {sub, name, admin?}  local test sign-in: only with DEV_AUTH=1 in .dev.vars AND a localhost URL
import { AUTH, parseSessionCookie, sessionCookie, type AuthResponse, type MeResponse, type PublicUser } from '../shared/auth';
import type { SavePut } from '../shared/cloudSave';
import { JwksCache, JwtError, verifyGoogleIdToken } from './googleJwt';
import { sha256Hex } from './Account';
import { adminBootstrap } from './admin';

const jwks = new JwksCache();
/** Per-isolate sign-in attempts by IP (best effort: each Worker isolate counts on its own). */
const authHits = new Map<string, number[]>();

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const isLocalHost = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/** Stable account key from the Google subject id: names the Durable Object and is the verified leaderboard id. */
export async function userKey(sub: string) {
  return (await sha256Hex('moto-user:' + sub)).slice(0, 32);
}

const stubFor = (env: Env, key: string) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName(key));

/** The signed-in account for this request, from the session cookie (never from anything the client claims). */
export async function sessionUser(req: Request, env: Env): Promise<PublicUser | null> {
  const sid = parseSessionCookie(req.headers.get('cookie'));
  if (!sid) return null;
  try {
    return await stubFor(env, sid.key).check(sid.token);
  } catch {
    return null;
  }
}

function rateLimited(ip: string) {
  const now = Date.now(), list = (authHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= AUTH.authPerMin) return true;
  list.push(now);
  authHits.set(ip, list);
  if (authHits.size > 5000) authHits.clear(); // memory guard
  return false;
}

/** Cross-site requests can't change anything: a browser always sends Origin on POST/PUT/DELETE fetches. */
function sameOrigin(req: Request, url: URL) {
  const o = req.headers.get('origin');
  return !o || o === url.origin;
}

async function readJson(req: Request, max: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return { ok: false, res: json({ ok: false, error: 'Too large' }, 413) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: json({ ok: false, error: 'Too large' }, 413) };
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, body: v as Record<string, unknown> };
  } catch {
    /* fall through */
  }
  return { ok: false, res: json({ ok: false, error: 'Bad JSON' }, 400) };
}

const cleanText = (s: unknown, max: number) => [...String(s ?? '')].filter((c) => c >= ' ').join('').trim().slice(0, max);
const cleanPicture = (s: unknown) => {
  const v = String(s ?? '');
  return /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\/[^\s"'<>]{1,400}$/i.test(v) ? v : '';
};

async function startSession(env: Env, url: URL, sub: string, name: string, picture: string, bootstrapAdmin: boolean) {
  const key = await userKey(sub);
  const { token, user } = await stubFor(env, key).signIn(key, { name: cleanText(name, 40) || 'Rider', picture: cleanPicture(picture) }, bootstrapAdmin);
  return json({ ok: true, user } satisfies AuthResponse, 200, { 'set-cookie': sessionCookie(`${key}.${token}`, !isLocalHost(url)) });
}

export async function handleAuth(req: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname, m = req.method;
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const secure = !isLocalHost(url);
  if (m !== 'GET' && !sameOrigin(req, url)) return json({ ok: false, error: 'Forbidden' }, 403);

  if (p === '/api/auth/google' && m === 'POST') {
    if (rateLimited(ip)) return json({ ok: false, error: 'Too many sign-in attempts, wait a minute' }, 429);
    const r = await readJson(req, AUTH.authBodyMax);
    if (!r.ok) return r.res;
    try {
      const c = await verifyGoogleIdToken(String(r.body.credential ?? ''), jwks);
      return await startSession(env, url, c.sub, c.name ?? '', c.picture ?? '', adminBootstrap(c, env.ADMIN_EMAILS));
    } catch (e) {
      return json({ ok: false, error: e instanceof JwtError ? `Sign-in rejected: ${e.message}` : 'Sign-in failed' } satisfies AuthResponse, e instanceof JwtError ? 401 : 503);
    }
  }

  if (p === '/api/auth/dev' && m === 'POST') {
    // Test-only sign-in for automated local runs. Never in production: DEV_AUTH is not in wrangler.jsonc (only in the
    // git-ignored .dev.vars) and the request must also be for localhost, which a deployed Worker never serves.
    if (env.DEV_AUTH !== '1' || !isLocalHost(url)) return json({ error: 'Not found' }, 404);
    const r = await readJson(req, AUTH.authBodyMax);
    if (!r.ok) return r.res;
    const sub = cleanText(r.body.sub, 40);
    if (!/^[a-z0-9_-]{1,40}$/i.test(sub)) return json({ ok: false, error: 'Bad sub' }, 400);
    return startSession(env, url, 'dev-' + sub, cleanText(r.body.name, 40) || 'Dev ' + sub, '', r.body.admin === true);
  }

  const sid = parseSessionCookie(req.headers.get('cookie'));
  const clear = { 'set-cookie': sessionCookie('', secure, 0) };

  if (p === '/api/me' && m === 'GET') {
    const user = sid ? await stubFor(env, sid.key).check(sid.token) : null;
    // sliding cookie: every visit renews the browser's copy too
    return json({ user, ...(user?.admin ? { admin: true } : {}) } satisfies MeResponse, 200, sid ? { 'set-cookie': user ? sessionCookie(`${sid.key}.${sid.token}`, secure) : clear['set-cookie'] } : {});
  }

  if (p === '/api/logout' && m === 'POST') {
    if (sid) await stubFor(env, sid.key).logout(sid.token);
    return json({ ok: true }, 200, clear);
  }

  if (p === '/api/save') {
    if (!sid) return json({ ok: false, error: 'Signed out' }, 401);
    const stub = stubFor(env, sid.key);
    if (m === 'GET') {
      const env2 = await stub.getSave(sid.token);
      return env2 ? json(env2) : json({ ok: false, error: 'Signed out' }, 401, clear);
    }
    if (m === 'PUT') {
      const r = await readJson(req, AUTH.saveBodyMax);
      if (!r.ok) return r.res;
      const b = r.body as Partial<SavePut>;
      const rev = Number(b.rev);
      if (!Number.isInteger(rev) || rev < 0) return json({ ok: false, error: 'Bad revision' }, 400);
      const res = await stub.putSave(sid.token, rev, String(b.wid ?? ''), b.save);
      return json(res.body, res.status, res.status === 401 ? clear : {});
    }
  }

  if (p === '/api/admin/unpin' && m === 'POST') {
    const me = sid ? await stubFor(env, sid.key).check(sid.token) : null; // re-checked on every admin action
    if (!me?.admin) return json({ ok: false, error: 'Admins only' }, 403);
    const r = await readJson(req, AUTH.authBodyMax);
    if (!r.ok) return r.res;
    const target = r.body.uid === undefined ? me.uid : String(r.body.uid);
    if (!/^[0-9a-f]{32}$/.test(target)) return json({ ok: false, error: 'Bad account key' }, 400);
    return json({ ok: await stubFor(env, target).unpinAdmin() });
  }

  if (p === '/api/account' && m === 'DELETE') {
    if (!sid) return json({ ok: false, error: 'Signed out' }, 401);
    const ok = await stubFor(env, sid.key).deleteAccount(sid.token);
    return json({ ok }, ok ? 200 : 401, clear);
  }

  if (p === '/api/me' || p === '/api/logout' || p === '/api/save' || p === '/api/account' || p.startsWith('/api/auth/') || p.startsWith('/api/admin/')) return json({ error: 'Method not allowed' }, 405);
  return null;
}
