// POST /api/log: client error and bug reports. Validated, trimmed and written with console.error so
// Workers observability keeps them. Nothing identifying is logged (no IP, no names, no query strings).
import { LOG_LIMITS, ReportLimiter, reportKey, sanitizeReport } from '../shared/logReport';

// Best effort, per isolate: a burst of identical crashes from many players is logged a few times, not thousands.
const limiter = new ReportLimiter(60, 60_000, Infinity, 60_000);

export async function handleLog(request: Request, limit: ReportLimiter = limiter): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > LOG_LIMITS.body) return new Response('Too large', { status: 413 });
  let text: string;
  try {
    text = await request.text();
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  if (text.length > LOG_LIMITS.body) return new Response('Too large', { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const report = sanitizeReport(raw);
  if (!report) return new Response('Bad report', { status: 400 });
  // bug reports are written by people: never de-duplicate them, only rate limit
  const key = report.kind === 'bug' ? `bug|${Date.now()}|${Math.random()}` : reportKey(report);
  if (!limit.allow(key)) return new Response(null, { status: 204 });
  console.error(JSON.stringify({ type: 'client-report', ...report, country: request.cf?.country }));
  return new Response(null, { status: 204 });
}
