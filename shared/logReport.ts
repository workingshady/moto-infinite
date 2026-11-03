// Client error / bug reports sent to POST /api/log (src/core/errorReport.ts -> worker/log.ts).
// Shared so both sides agree on the shape and the limits. No personal data: no names, room codes,
// query strings or IPs are ever part of a report.

export type LogKind = 'error' | 'rejection' | 'webgl' | 'bug';
export const LOG_KINDS: readonly LogKind[] = ['error', 'rejection', 'webgl', 'bug'];

export interface DeviceInfo {
  ua: string;
  /** CSS px viewport and device pixel ratio. */
  vw: number; vh: number; dpr: number;
  touch: boolean;
  lang: string;
  /** WebGL renderer string, when the browser exposes it. */
  gpu?: string;
  mem?: number;
  cores?: number;
  standalone?: boolean;
}

export interface LogReport {
  kind: LogKind;
  msg: string;
  stack?: string;
  /** Script path (no origin/query) and position for window.onerror. */
  src?: string;
  line?: number;
  col?: number;
  /** Bug report: what the player wrote, plus the last console errors. */
  note?: string;
  errors?: string[];
  device?: DeviceInfo;
  /** Build id (hashed entry file name) and screen/mode the player was on. */
  build?: string;
  where?: string;
}

export const LOG_LIMITS = { body: 16_000, msg: 300, stack: 2_000, note: 1_000, errors: 10, errorLen: 300, field: 200 } as const;

const str = (v: unknown, max: number) => (typeof v === 'string' && v ? scrub(v).slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);

/** Removes things that can identify a player: query strings / hashes (room codes), e-mail addresses, origins. */
export function scrub(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(https?:\/\/[^\s/?#)]+)?(\/[^\s?#)]*)[?#][^\s)]*/g, (_m, _origin, path: string) => path)
    .replace(/https?:\/\/[^\s/)]+/g, '');
}

/** Validates and trims an untrusted report. Returns null when it isn't a report at all. */
export function sanitizeReport(raw: unknown): LogReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!LOG_KINDS.includes(r.kind as LogKind)) return null;
  const msg = str(r.msg, LOG_LIMITS.msg);
  if (!msg && r.kind !== 'bug') return null;
  const out: LogReport = { kind: r.kind as LogKind, msg: msg ?? '' };
  const stack = str(r.stack, LOG_LIMITS.stack), src = str(r.src, LOG_LIMITS.field), note = str(r.note, LOG_LIMITS.note);
  const build = str(r.build, 40), where = str(r.where, 40), line = num(r.line), col = num(r.col);
  if (stack) out.stack = stack;
  if (src) out.src = src;
  if (line !== undefined) out.line = line;
  if (col !== undefined) out.col = col;
  if (note) out.note = note;
  if (build) out.build = build;
  if (where) out.where = where;
  if (Array.isArray(r.errors)) {
    const errs = r.errors.slice(-LOG_LIMITS.errors).map((e) => str(e, LOG_LIMITS.errorLen)).filter((e): e is string => !!e);
    if (errs.length) out.errors = errs;
  }
  if (r.device && typeof r.device === 'object') {
    const d = r.device as Record<string, unknown>;
    const dev: DeviceInfo = { ua: str(d.ua, LOG_LIMITS.field) ?? '', vw: num(d.vw) ?? 0, vh: num(d.vh) ?? 0, dpr: num(d.dpr) ?? 1, touch: d.touch === true, lang: str(d.lang, 20) ?? '' };
    const gpu = str(d.gpu, LOG_LIMITS.field), mem = num(d.mem), cores = num(d.cores);
    if (gpu) dev.gpu = gpu;
    if (mem !== undefined) dev.mem = mem;
    if (cores !== undefined) dev.cores = cores;
    if (typeof d.standalone === 'boolean') dev.standalone = d.standalone;
    out.device = dev;
  }
  return out;
}

/** Same error twice = same key (message + first stack frame), used to de-duplicate on both sides. */
export function reportKey(r: Pick<LogReport, 'kind' | 'msg' | 'stack' | 'src' | 'line'>): string {
  const frame = (r.stack ?? '').split('\n').find((l) => /:\d+/.test(l))?.trim() ?? `${r.src ?? ''}:${r.line ?? ''}`;
  return `${r.kind}|${r.msg.slice(0, 120)}|${frame.slice(0, 160)}`;
}

/**
 * Sliding-window rate limit + de-duplication. `allow` says whether a report with this key may be sent now.
 * Used per page in the client and per Worker isolate on the server.
 */
export class ReportLimiter {
  private times: number[] = [];
  private seen = new Map<string, number>();
  private total = 0;

  constructor(private perWindow = 5, private windowMs = 60_000, private maxTotal = 30, private dedupeMs = Infinity, private maxKeys = 500) {}

  allow(key: string, now = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.dedupeMs) return false;
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.perWindow || this.total >= this.maxTotal) return false;
    this.times.push(now);
    this.total++;
    if (this.seen.size >= this.maxKeys) this.seen.delete(this.seen.keys().next().value as string);
    this.seen.set(key, now);
    return true;
  }
}
