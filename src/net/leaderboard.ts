// Leaderboard API client (/api/lb/*). Every call fails soft: offline or server errors resolve to null, and the
// player's own bests are also kept in localStorage so the menu can show them without a connection.
// Failed submissions are queued and retried the next time a board is fetched.
import { boardIsTime, type LbGhost, type LbSubmit, type LbSubmitResult, type LbTop } from '../../shared/leaderboard';

const TIMEOUT = 7000;

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem('moto:' + k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem('moto:' + k, JSON.stringify(v));
  } catch {
    /* not persisted */
  }
}

/** Random anonymous player id, created once per browser. Never shown to other players. */
export function playerId() {
  let id = read<string>('lbid', '');
  if (!/^[a-z0-9]{16,40}$/.test(id)) {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    id = [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 24).padEnd(16, '0');
    write('lbid', id);
  }
  return id;
}

/** Best result on this device per board (shown offline too). */
export function localBest(board: string): number | null {
  return read<Record<string, number>>('lbbest', {})[board] ?? null;
}
function keepLocalBest(board: string, value: number) {
  const all = read<Record<string, number>>('lbbest', {}), prev = all[board];
  if (prev === undefined || (boardIsTime(board) ? value < prev : value > prev)) {
    all[board] = value;
    write('lbbest', all);
    return true;
  }
  return false;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch('/api/lb/' + path, { ...init, signal: ctl.signal });
    if (!res.headers.get('content-type')?.includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Submit a result. Resolves to the server's answer, or null when offline (then it is queued for later). */
export async function submitScore(board: string, value: number, name: string, vehicle: string, ghost?: number[]): Promise<LbSubmitResult | null> {
  if (!Number.isFinite(value)) return null;
  const localImproved = keepLocalBest(board, value);
  const body: LbSubmit = { board, pid: playerId(), name, value, vehicle, ghost: ghost?.map((v) => Math.round(v * 100) / 100) };
  const res = await call<LbSubmitResult>('submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res && localImproved) queue(body);
  return res;
}

function queue(body: LbSubmit) {
  const q = read<LbSubmit[]>('lbqueue', []).filter((b) => b.board !== body.board);
  q.push(body);
  write('lbqueue', q.slice(-8));
}
let flushing = false;
async function flush() {
  const q = read<LbSubmit[]>('lbqueue', []);
  if (flushing || !q.length) return;
  flushing = true;
  write('lbqueue', []);
  for (const body of q) {
    const res = await call<LbSubmitResult>('submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res) { queue(body); break; } // still offline
  }
  flushing = false;
}

/** Top N of a board plus your own row (even outside the top). */
export async function fetchTop(board: string, n = 10): Promise<LbTop | null> {
  void flush();
  return call<LbTop>(`top?board=${encodeURIComponent(board)}&n=${n}&pid=${playerId()}`);
}

/** Ghost lap of the given rank (1 = fastest), for "race the #1 ghost". */
export async function fetchGhost(board: string, rank = 1): Promise<LbGhost | null> {
  const g = await call<LbGhost & { error?: string }>(`ghost?board=${encodeURIComponent(board)}&rank=${rank}`);
  return g && Array.isArray(g.s) ? g : null;
}
