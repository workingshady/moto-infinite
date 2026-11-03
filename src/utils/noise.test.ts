import { describe, expect, it } from 'vitest';
import { Noise } from './noise';

const sample = (n: Noise) => Array.from({ length: 40 }, (_, i) => n.fbm(i * 3.7 - 50, i * -2.3 + 11));

describe('Noise', () => {
  it('same seed gives the same world on every client', () => {
    expect(sample(new Noise(1234))).toEqual(sample(new Noise(1234)));
  });

  it('different seeds give different worlds', () => {
    expect(sample(new Noise(1234))).not.toEqual(sample(new Noise(1235)));
  });

  it('values stay in [0, 1] and vary continuously', () => {
    const n = new Noise(99);
    for (let i = 0; i < 500; i++) {
      const x = ((i * 7.31) % 400) - 200, y = ((i * 3.17) % 300) - 150;
      const v = n.vnoise(x, y), f = n.fbm(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(Math.abs(n.vnoise(x + 0.001, y) - v)).toBeLessThan(0.01);
    }
  });

  it('lattice points hold hashed byte values (k / 255)', () => {
    const n = new Noise(5);
    for (let i = -3; i < 3; i++) {
      const v = n.vnoise(i, 2) * 255;
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
    }
  });
});
