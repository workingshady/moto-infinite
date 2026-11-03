import { describe, expect, it } from 'vitest';
import { LOG_LIMITS, ReportLimiter, reportKey, sanitizeReport, scrub } from './logReport';

describe('scrub', () => {
  it('removes query strings (room codes), origins and e-mails', () => {
    expect(scrub('at x (https://moto.example.dev/assets/index-abc.js:10:5)')).toBe('at x (/assets/index-abc.js:10:5)');
    expect(scrub('failed https://moto.example.dev/?room=ABCDE now')).toBe('failed / now');
    expect(scrub('GET /api/room/ABCDE?x=1')).toBe('GET /api/room/ABCDE');
    expect(scrub('mail me: rider@example.com')).toBe('mail me: <email>');
  });

  it('leaves ordinary messages alone', () => {
    expect(scrub("Cannot read properties of undefined (reading 'x')")).toBe("Cannot read properties of undefined (reading 'x')");
    expect(scrub('what? colour #fff')).toBe('what? colour #fff');
  });
});

describe('sanitizeReport', () => {
  it('rejects things that are not reports', () => {
    for (const bad of [null, 1, 'x', [], {}, { kind: 'nope', msg: 'x' }, { kind: 'error' }, { kind: 'error', msg: 5 }]) expect(sanitizeReport(bad)).toBeNull();
  });

  it('keeps known fields, drops unknown ones and trims long text', () => {
    const r = sanitizeReport({ kind: 'error', msg: 'x'.repeat(5000), stack: 's'.repeat(9000), line: 12, col: 'a', ip: '1.2.3.4', name: 'Alice' });
    expect(r).not.toBeNull();
    expect(r!.msg.length).toBe(LOG_LIMITS.msg);
    expect(r!.stack!.length).toBe(LOG_LIMITS.stack);
    expect(r!.line).toBe(12);
    expect(r).not.toHaveProperty('col');
    expect(r).not.toHaveProperty('ip');
    expect(r).not.toHaveProperty('name');
  });

  it('bug reports may have no message; errors list is capped', () => {
    const r = sanitizeReport({ kind: 'bug', note: 'fell through road', errors: Array.from({ length: 50 }, (_, i) => `e${i}`), device: { ua: 'UA', vw: 800, vh: 600, dpr: 2, touch: true, lang: 'en', gpu: 'GPU', extra: 1 } });
    expect(r!.msg).toBe('');
    expect(r!.errors).toHaveLength(LOG_LIMITS.errors);
    expect(r!.errors!.at(-1)).toBe('e49');
    expect(r!.device).toEqual({ ua: 'UA', vw: 800, vh: 600, dpr: 2, touch: true, lang: 'en', gpu: 'GPU' });
  });
});

describe('reportKey', () => {
  it('same error from the same place = same key', () => {
    const a = { kind: 'error' as const, msg: 'boom', stack: 'Error: boom\n    at f (/assets/a.js:1:2)\n    at g (/assets/a.js:3:4)' };
    expect(reportKey(a)).toBe(reportKey({ ...a }));
    expect(reportKey(a)).not.toBe(reportKey({ ...a, stack: 'Error: boom\n    at h (/assets/b.js:9:9)' }));
    expect(reportKey(a)).not.toBe(reportKey({ ...a, msg: 'other' }));
  });
});

describe('ReportLimiter', () => {
  it('de-duplicates identical reports', () => {
    const l = new ReportLimiter(10, 60_000, 100);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 10)).toBe(false);
    expect(l.allow('b', 20)).toBe(true);
  });

  it('allows a burst per window, then waits for the window to slide', () => {
    const l = new ReportLimiter(3, 1000, 100);
    expect([l.allow('1', 0), l.allow('2', 1), l.allow('3', 2), l.allow('4', 3)]).toEqual([true, true, true, false]);
    expect(l.allow('5', 1001)).toBe(true);
  });

  it('caps the total per page and lets duplicates through again after dedupeMs', () => {
    const l = new ReportLimiter(100, 1000, 2, 5000);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 4000)).toBe(false);
    expect(l.allow('a', 6000)).toBe(true);
    expect(l.allow('b', 7000)).toBe(false); // total cap reached
  });
});
