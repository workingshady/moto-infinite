import { describe, expect, it } from 'vitest';
import { clamp, damp, escapeHtml, hex, lerp, lerpAngle, mulberry32, PI, smooth, TAU, wrapPi } from './math';

describe('math helpers', () => {
  it('lerp and clamp', () => {
    expect(lerp(2, 10, 0)).toBe(2);
    expect(lerp(2, 10, 1)).toBe(10);
    expect(lerp(2, 10, 0.25)).toBe(4);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it('smooth is a clamped smoothstep', () => {
    expect(smooth(0, 1, -1)).toBe(0);
    expect(smooth(0, 1, 2)).toBe(1);
    expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smooth(0, 10, 2.5)).toBeLessThan(0.25); // eases in
  });

  it('wrapPi keeps angles in [-PI, PI) without changing direction', () => {
    for (const a of [0, 1, -1, PI - 0.01, 3 * PI, -3 * PI, 7.5, -100, 1e4]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThanOrEqual(-PI);
      expect(w).toBeLessThan(PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 6);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 6);
    }
    expect(wrapPi(TAU + 0.5)).toBeCloseTo(0.5);
  });

  it('lerpAngle takes the short way round', () => {
    expect(Math.abs(lerpAngle(PI - 0.1, -PI + 0.1, 0.5))).toBeCloseTo(PI, 6);
    expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0, 6);
  });

  it('damp is frame-rate independent', () => {
    // two half steps reach the same place as one full step
    const once = damp(1 / 30, 8), half = damp(1 / 60, 8);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(once, 10);
    expect(damp(0, 8)).toBe(0);
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const take = (seed: number, n = 50) => { const r = mulberry32(seed); return Array.from({ length: n }, () => r()); };
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
    const many = take(7, 5000);
    for (const v of many) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    const mean = many.reduce((s, v) => s + v, 0) / many.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('escapeHtml and hex', () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
    expect(hex(0xffd23f)).toBe('#ffd23f');
    expect(hex(0x00000f)).toBe('#00000f');
  });
});
