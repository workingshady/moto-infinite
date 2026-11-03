// Online leaderboards: one SQLite-backed Durable Object per board id (daily/weekly challenge, track + class, drift venue).
// Each player keeps only their best row; the top few also keep a ghost lap. Everything a client sends is checked
// against shared/leaderboard.ts rules (plausible lap time from track length and a max speed, drift points per second).
// Signed-in players (session cookie, worker/auth.ts) post under their account key and their rows are marked verified ✓;
// anonymous rows keep working but can never take over a verified row.
import { DurableObject } from 'cloudflare:workers';
import { sessionUser } from './auth';
import { BOARD_RE, LB, NAME_RE, PID_RE, boardRule, type BoardRule, type LbGhost, type LbRow, type LbSubmit, type LbSubmitResult, type LbTop } from '../shared/leaderboard';

const MAX_BODY = 320 * 1024;
const VEHICLE_RE = /^[a-z0-9_]{1,24}$/;
/** Per IP and board: at most this many submissions per window. */
const RATE = { submits: 8, window: 60_000, minGap: 2_000 };

const json = (body: unknown, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { 'cache-control': cache } });
const cleanName = (s: unknown) => {
  const n = [...String(s ?? '')].filter((c) => c >= ' ').join('').replace(/\s+/g, ' ').trim().slice(0, LB.nameMax);
  return NAME_RE.test(n) ? n : '';
};

/** Ghost sanity: sample count fits the lap time, every value finite, no teleports, path long enough, average speed possible. */
function ghostOk(s: number[], time: number, rule: BoardRule) {
  const S = LB.ghostStride, n = s.length / S;
  if (!Number.isInteger(n) || n < 10 || s.length > LB.ghostMax) return false;
  if (Math.abs(n - time * LB.ghostHz) > time * LB.ghostHz * 0.2 + 5) return false;
  let path = 0, jumps = 0;
  const step = (rule.maxSpeed * 1.4) / LB.ghostHz;
  for (let i = 0; i < s.length; i++) if (!Number.isFinite(s[i]) || Math.abs(s[i]) > 1e5) return false;
  for (let i = S; i < s.length; i += S) {
    const d = Math.hypot(s[i] - s[i - S], s[i + 2] - s[i + 2 - S]);
    if (d > step) jumps++;
    else path += d;
  }
  return jumps <= 3 && path >= rule.minLen * 0.6 && path / time <= rule.maxSpeed;
}

export class Leaderboard extends DurableObject<Env> {
  private sql: SqlStorage;
  private hits = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      pid TEXT PRIMARY KEY, name TEXT NOT NULL, value REAL NOT NULL, vehicle TEXT NOT NULL, at INTEGER NOT NULL, ghost TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS scores_value ON scores (value, at)');
    const cols = this.sql.exec<{ name: string }>('PRAGMA table_info(scores)').toArray();
    if (!cols.some((c) => c.name === 'verified')) this.sql.exec('ALTER TABLE scores ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  }

  private limited(ip: string) {
    const now = Date.now(), list = (this.hits.get(ip) ?? []).filter((t) => now - t < RATE.window);
    if (list.length >= RATE.submits || (list.length && now - list[list.length - 1] < RATE.minGap)) return true;
    list.push(now);
    this.hits.set(ip, list);
    if (this.hits.size > 5000) this.hits.clear(); // memory guard
    return false;
  }

  private order(rule: BoardRule) {
    return rule.order === 'asc' ? 'value ASC, at ASC' : 'value DESC, at ASC';
  }

  private rankOf(rule: BoardRule, value: number, at: number) {
    const better = rule.order === 'asc' ? '<' : '>';
    const row = this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM scores WHERE value ${better} ? OR (value = ? AND at < ?)`, value, value, at).one();
    return row.c + 1;
  }

  /** `verified`: the signed-in account's key, read by the Worker from the session cookie (it replaces sub.pid). */
  async submit(board: string, ip: string, sub: LbSubmit, verified: string | null = null): Promise<LbSubmitResult> {
    const rule = boardRule(board);
    if (!rule) return { ok: false, error: 'This board is closed' };
    if (this.limited(ip)) return { ok: false, error: 'Too many submissions, slow down' };
    const name = cleanName(sub.name), vehicle = String(sub.vehicle ?? '');
    const value = rule.order === 'asc' ? Math.round(Number(sub.value) * 1000) / 1000 : Math.round(Number(sub.value));
    const pid = verified ?? String(sub.pid ?? '');
    if (!PID_RE.test(pid)) return { ok: false, error: 'Bad player id' };
    if (!name) return { ok: false, error: 'Bad name' };
    if (!VEHICLE_RE.test(vehicle)) return { ok: false, error: 'Bad vehicle' };
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) return { ok: false, error: 'Result not plausible' };
    let ghost: string | null = null;
    if (Array.isArray(sub.ghost) && rule.order === 'asc') {
      const s = sub.ghost.map(Number);
      if (!ghostOk(s, value, rule)) return { ok: false, error: 'Lap not accepted' };
      ghost = JSON.stringify(s.map((v) => Math.round(v * 100) / 100));
    }
    const prev = this.sql.exec<{ value: number; at: number; verified: number }>('SELECT value, at, verified FROM scores WHERE pid = ?', pid).toArray()[0];
    if (prev?.verified && !verified) return { ok: false, error: 'Bad player id' }; // a verified row only takes signed-in posts
    const better = !prev || (rule.order === 'asc' ? value < prev.value : value > prev.value);
    const now = Date.now();
    if (better) {
      this.sql.exec(
        `INSERT INTO scores (pid, name, value, vehicle, at, ghost, verified) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pid) DO UPDATE SET name = excluded.name, value = excluded.value, vehicle = excluded.vehicle, at = excluded.at, ghost = excluded.ghost, verified = excluded.verified`,
        pid, name, value, vehicle, now, ghost, verified ? 1 : 0,
      );
      const ord = this.order(rule);
      // keep ghosts for the top few only, and cap the board size
      this.sql.exec(`UPDATE scores SET ghost = NULL WHERE ghost IS NOT NULL AND pid NOT IN (SELECT pid FROM scores ORDER BY ${ord} LIMIT ${LB.ghostsKept})`);
      this.sql.exec(`DELETE FROM scores WHERE pid NOT IN (SELECT pid FROM scores ORDER BY ${ord} LIMIT ${LB.rowsMax})`);
    } else if (prev) this.sql.exec('UPDATE scores SET name = ? WHERE pid = ?', name, pid);
    const best = better ? value : prev!.value, at = better ? now : prev!.at;
    const total = this.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM scores').one().c;
    return { ok: true, improved: better, best, rank: this.rankOf(rule, best, at), total };
  }

  async top(board: string, n: number, pid: string): Promise<LbTop | null> {
    const rule = boardRule(board);
    if (!rule) return null;
    const rows = this.sql.exec<{ pid: string; name: string; value: number; vehicle: string; g: number; verified: number }>(
      `SELECT pid, name, value, vehicle, ghost IS NOT NULL AS g, verified FROM scores ORDER BY ${this.order(rule)} LIMIT ?`, Math.max(1, Math.min(LB.topMax, n)),
    ).toArray();
    const list: LbRow[] = rows.map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, vehicle: r.vehicle, me: r.pid === pid || undefined, ghost: !!r.g || undefined, verified: !!r.verified || undefined }));
    let you = list.find((r) => r.me) ?? null;
    if (!you && PID_RE.test(pid)) {
      const mine = this.sql.exec<{ name: string; value: number; vehicle: string; at: number; verified: number }>('SELECT name, value, vehicle, at, verified FROM scores WHERE pid = ?', pid).toArray()[0];
      if (mine) you = { rank: this.rankOf(rule, mine.value, mine.at), name: mine.name, value: mine.value, vehicle: mine.vehicle, me: true, verified: !!mine.verified || undefined };
    }
    const total = this.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM scores').one().c;
    return { board, rows: list, you, total };
  }

  async ghost(board: string, rank: number): Promise<LbGhost | null> {
    const rule = boardRule(board);
    if (!rule || rule.order !== 'asc') return null;
    const r = this.sql.exec<{ name: string; value: number; vehicle: string; ghost: string | null }>(
      `SELECT name, value, vehicle, ghost FROM scores WHERE ghost IS NOT NULL ORDER BY ${this.order(rule)} LIMIT 1 OFFSET ?`, Math.max(0, Math.min(LB.ghostsKept - 1, rank - 1)),
    ).toArray()[0];
    if (!r?.ghost) return null;
    return { name: r.name, value: r.value, vehicle: r.vehicle, s: JSON.parse(r.ghost) as number[] };
  }
}

/**
 * /api/lb/top?board=…&n=10&pid=…   top N + your rank
 * /api/lb/ghost?board=…&rank=1      the best ghost lap stored (rank = among rows with a ghost)
 * POST /api/lb/submit {board, pid, name, value, vehicle, ghost?}
 */
export async function handleLeaderboard(req: Request, env: Env, url: URL): Promise<Response> {
  const route = url.pathname.slice('/api/lb/'.length);
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const stubFor = (board: string) => env.LEADERBOARDS.get(env.LEADERBOARDS.idFromName(board));
  if (req.method === 'GET' && (route === 'top' || route === 'ghost')) {
    const board = (url.searchParams.get('board') ?? '').toLowerCase();
    if (!BOARD_RE.test(board) || !boardRule(board)) return json({ error: 'Unknown board' }, 404);
    const stub = stubFor(board);
    if (route === 'top') {
      const n = Math.floor(Number(url.searchParams.get('n') ?? 10)) || 10;
      const pid = (await sessionUser(req, env))?.uid ?? String(url.searchParams.get('pid') ?? '').slice(0, 40);
      return json(await stub.top(board, n, pid));
    }
    const g = await stub.ghost(board, Math.floor(Number(url.searchParams.get('rank') ?? 1)) || 1);
    return g ? json(g, 200, 'public, max-age=30') : json({ error: 'No ghost' }, 404);
  }
  if (req.method === 'POST' && route === 'submit') {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) return json({ ok: false, error: 'Too large' }, 413);
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'Too large' }, 413);
    let body: LbSubmit;
    try {
      body = JSON.parse(text) as LbSubmit;
    } catch {
      return json({ ok: false, error: 'Bad JSON' }, 400);
    }
    const board = String(body?.board ?? '').toLowerCase();
    if (!BOARD_RE.test(board) || !boardRule(board)) return json({ ok: false, error: 'Unknown board' }, 404);
    const user = await sessionUser(req, env);
    if (body.fp === true) return json({ ok: false, error: 'Full Power runs are not ranked' }, 422); // admin play mode: never ranked
    const res = await stubFor(board).submit(board, ip, {
      board, pid: String(body.pid ?? ''), name: String(body.name ?? ''), value: Number(body.value), vehicle: String(body.vehicle ?? ''),
      ghost: Array.isArray(body.ghost) ? body.ghost.slice(0, LB.ghostMax + 1).map(Number) : undefined,
    }, user?.uid ?? null);
    return json(res, res.ok ? 200 : res.error?.startsWith('Too many') ? 429 : 422);
  }
  return json({ error: 'Not found' }, 404);
}
