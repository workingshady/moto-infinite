import { describe, expect, it } from 'vitest';
import { parseSessionCookie, readCookie, sessionCookie } from './auth';

const KEY = '0123456789abcdef0123456789abcdef';
const TOKEN = 'A'.repeat(42) + 'b';

describe('session cookie', () => {
  it('reads one cookie among others', () => {
    expect(readCookie('a=1; moto_sid=x; b=2', 'moto_sid')).toBe('x');
    expect(readCookie('a=1;b=2', 'moto_sid')).toBeNull();
    expect(readCookie(null, 'moto_sid')).toBeNull();
    expect(readCookie('xmoto_sid=1; moto_sid="q"', 'moto_sid')).toBe('q');
  });

  it('parses a well-formed session value and rejects anything else', () => {
    expect(parseSessionCookie(`moto_sid=${KEY}.${TOKEN}`)).toEqual({ key: KEY, token: TOKEN });
    expect(parseSessionCookie(`moto_sid=${KEY}.short`)).toBeNull();
    expect(parseSessionCookie(`moto_sid=${KEY.toUpperCase()}.${TOKEN}`)).toBeNull();
    expect(parseSessionCookie(`moto_sid=../${KEY}.${TOKEN}`)).toBeNull();
    expect(parseSessionCookie('')).toBeNull();
  });

  it('builds HttpOnly, SameSite=Lax, Path=/api cookies; Secure except on localhost', () => {
    const c = sessionCookie(`${KEY}.${TOKEN}`, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/api');
    expect(c).toContain('Secure');
    expect(c).toContain(`Max-Age=${60 * 86400}`);
    expect(sessionCookie('', false, 0)).not.toContain('Secure');
    expect(sessionCookie('', false, 0)).toContain('Max-Age=0');
  });
});
