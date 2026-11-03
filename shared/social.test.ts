import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bucket, CHAT, QUICK_CHAT, cleanChat } from './social';

describe('cleanChat', () => {
  it('keeps plain text, collapses whitespace and trims', () => {
    expect(cleanChat('  hello   there  ')).toBe('hello there');
  });
  it('removes control characters and angle brackets (no markup can survive)', () => {
    expect(cleanChat('a\u0000b\nc\u007fd')).toBe('a b c d');
    expect(cleanChat('<img src=x onerror=alert(1)>')).not.toMatch(/[<>]/);
  });
  it('caps the length by characters, not UTF-16 units', () => {
    expect([...cleanChat('🏁'.repeat(500))].length).toBe(CHAT.maxLen);
    expect(cleanChat('x'.repeat(1000)).length).toBe(CHAT.maxLen);
  });
  it('masks swearing but keeps the first letter', () => {
    expect(cleanChat('oh shit')).toBe('oh s***');
  });
  it('handles non-strings', () => {
    expect(cleanChat(undefined)).toBe('');
    expect(cleanChat(42)).toBe('42');
  });
});

describe('quick chat', () => {
  it('uses six distinct number keys that do not touch the card picks 1-3', () => {
    const keys = QUICK_CHAT.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['Digit1', 'Digit2', 'Digit3']) expect(keys).not.toContain(k);
  });
});

describe('Bucket', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('allows a burst, then refills over time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const b = new Bucket(1, 3);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    vi.setSystemTime(1000);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});
