// One SQLite-backed Durable Object per signed-in player (named by the account key, see worker/auth.ts userKey).
// Holds the Google profile (name + picture, never the e-mail), the admin pin (worker/admin.ts), the player's sessions
// (only SHA-256 hashes of the tokens) and the cloud save with a revision number. "Delete my cloud data" wipes it all.
import { DurableObject } from 'cloudflare:workers';
import { AUTH, type PublicUser } from '../shared/auth';
import { nextAdminPin } from './admin';
import { SAVE_LIMITS, WID_RE, sanitizeSave, type SaveEnvelope, type SavePutResult } from '../shared/cloudSave';

const DAY = 864e5;
const SLIDE_EVERY = DAY; // extend a session's expiry at most once a day (fewer writes)

export async function sha256Hex(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken() {
  const b = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface GoogleProfile { name: string; picture: string }

export class Account extends DurableObject<Env> {
  private sql: SqlStorage;
  private writes: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /** Tables are created on the first sign-in only: a random cookie must not leave an empty object behind. */
  private ready() {
    return this.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").one().c > 0;
  }

  private init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), uid TEXT NOT NULL, name TEXT NOT NULL, picture TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, admin INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, extended INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS save (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL, wids TEXT NOT NULL)`);
  }

  private user(): PublicUser | null {
    const p = this.sql.exec<{ uid: string; name: string; picture: string; admin: number }>('SELECT uid, name, picture, admin FROM profile WHERE id = 1').toArray()[0];
    return p ? { uid: p.uid, name: p.name, picture: p.picture, ...(p.admin ? { admin: true } : {}) } : null;
  }

  /** New session after a verified Google sign-in. Returns the raw token (only its hash is kept).
   *  `bootstrapAdmin`: this sign-in qualifies to pin the account as admin (decided by the Worker from the token). */
  async signIn(uid: string, g: GoogleProfile, bootstrapAdmin = false): Promise<{ token: string; user: PublicUser }> {
    const now = Date.now(), token = randomToken();
    this.init();
    const pinned = !!this.sql.exec<{ admin: number }>('SELECT admin FROM profile WHERE id = 1').toArray()[0]?.admin;
    const admin = nextAdminPin(pinned, bootstrapAdmin);
    this.sql.exec(
      `INSERT INTO profile (id, uid, name, picture, created, seen, admin) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture, seen = excluded.seen, admin = excluded.admin`,
      uid, g.name, g.picture, now, now, admin ? 1 : 0,
    );
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
    this.sql.exec('INSERT INTO sessions (hash, created, expires, extended) VALUES (?, ?, ?, ?)', await sha256Hex(token), now, now + AUTH.sessionDays * DAY, now);
    this.sql.exec(`DELETE FROM sessions WHERE hash NOT IN (SELECT hash FROM sessions ORDER BY created DESC LIMIT ${AUTH.sessionsMax})`);
    return { token, user: this.user()! };
  }

  /** The account behind a session token, sliding its expiry; null when unknown or expired. */
  async check(token: string): Promise<PublicUser | null> {
    if (!this.ready()) return null;
    const hash = await sha256Hex(token), now = Date.now();
    const s = this.sql.exec<{ expires: number; extended: number }>('SELECT expires, extended FROM sessions WHERE hash = ?', hash).toArray()[0];
    if (!s) return null;
    if (s.expires < now) {
      this.sql.exec('DELETE FROM sessions WHERE hash = ?', hash);
      return null;
    }
    if (now - s.extended > SLIDE_EVERY) {
      this.sql.exec('UPDATE sessions SET expires = ?, extended = ? WHERE hash = ?', now + AUTH.sessionDays * DAY, now, hash);
      this.sql.exec('UPDATE profile SET seen = ? WHERE id = 1', now);
    }
    return this.user();
  }

  /** Clears the admin pin (an admin asked for it; the Worker checked their session). */
  async unpinAdmin(): Promise<boolean> {
    if (!this.ready()) return false;
    this.sql.exec('UPDATE profile SET admin = 0 WHERE id = 1');
    return true;
  }

  async logout(token: string) {
    if (!this.ready()) return;
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(token));
  }

  async getSave(token: string): Promise<SaveEnvelope | null> {
    if (!(await this.check(token))) return null;
    const r = this.sql.exec<{ rev: number; updated: number; data: string; wids: string }>('SELECT rev, updated, data, wids FROM save WHERE id = 1').toArray()[0];
    if (!r) return { rev: 0, updatedAt: 0, save: null, wids: [] };
    return { rev: r.rev, updatedAt: r.updated, save: sanitizeSave(JSON.parse(r.data)), wids: JSON.parse(r.wids) as string[] };
  }

  /** Stores a save if `rev` matches the current revision (else 409 conflict: the client refetches and merges). */
  async putSave(token: string, rev: number, wid: string, raw: unknown): Promise<{ status: number; body: SavePutResult }> {
    if (!(await this.check(token))) return { status: 401, body: { ok: false, error: 'Signed out' } };
    const now = Date.now();
    this.writes = this.writes.filter((t) => now - t < 60_000);
    if (this.writes.length >= AUTH.savesPerMin) return { status: 429, body: { ok: false, error: 'Too many saves, slow down' } };
    this.writes.push(now);
    if (!WID_RE.test(wid)) return { status: 400, body: { ok: false, error: 'Bad write id' } };
    const save = sanitizeSave(raw, now);
    if (!save) return { status: 422, body: { ok: false, error: 'Not a save' } };
    const cur = this.sql.exec<{ rev: number; wids: string }>('SELECT rev, wids FROM save WHERE id = 1').toArray()[0];
    const curRev = cur?.rev ?? 0;
    if (rev !== curRev) return { status: 409, body: { ok: false, error: 'Conflict', rev: curRev } };
    const data = JSON.stringify(save);
    if (data.length > SAVE_LIMITS.bytes) return { status: 413, body: { ok: false, error: 'Too large' } };
    const wids = [...(cur ? (JSON.parse(cur.wids) as string[]) : []), wid].slice(-SAVE_LIMITS.wids);
    this.sql.exec(
      `INSERT INTO save (id, rev, updated, data, wids) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, updated = excluded.updated, data = excluded.data, wids = excluded.wids`,
      curRev + 1, now, data, JSON.stringify(wids),
    );
    return { status: 200, body: { ok: true, rev: curRev + 1, updatedAt: now } };
  }

  /** "Delete my cloud data": profile, sessions and save all go. */
  async deleteAccount(token: string): Promise<boolean> {
    if (!(await this.check(token))) return false;
    await this.ctx.storage.deleteAll();
    return true;
  }
}
