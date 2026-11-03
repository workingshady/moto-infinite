import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleLog } from './log';
import { LOG_LIMITS, ReportLimiter } from '../shared/logReport';

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://moto.test/api/log', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/log', () => {
  it('logs a valid report as one JSON line and answers 204', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handleLog(post(JSON.stringify({ kind: 'error', msg: 'boom at https://x.dev/?room=ABCDE', name: 'Alice' })), new ReportLimiter());
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ type: 'client-report', kind: 'error', msg: 'boom at /' });
    expect(logged).not.toHaveProperty('name');
  });

  it('rejects other methods, bad JSON, non-reports and oversized bodies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handleLog(new Request('https://moto.test/api/log'))).status).toBe(405);
    expect((await handleLog(post('{nope'))).status).toBe(400);
    expect((await handleLog(post(JSON.stringify({ kind: 'hack', msg: 'x' })))).status).toBe(400);
    expect((await handleLog(post('x'.repeat(LOG_LIMITS.body + 1)))).status).toBe(413);
    expect((await handleLog(post('{}', { 'Content-Length': String(LOG_LIMITS.body * 10) }))).status).toBe(413);
  });

  it('de-duplicates repeated crashes but always logs bug reports', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const limiter = new ReportLimiter(100, 60_000, Infinity, 60_000);
    const crash = JSON.stringify({ kind: 'error', msg: 'same', stack: 'at f (/a.js:1:1)' });
    for (let i = 0; i < 5; i++) expect((await handleLog(post(crash), limiter)).status).toBe(204);
    expect(spy).toHaveBeenCalledTimes(1);
    const bug = JSON.stringify({ kind: 'bug', note: 'stuck in a wall' });
    await handleLog(post(bug), limiter);
    await handleLog(post(bug), limiter);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
