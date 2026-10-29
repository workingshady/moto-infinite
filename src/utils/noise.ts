import { mulberry32 } from './math';

/** Seeded value noise + fractal brownian motion. Same seed = same world on every client. */
export class Noise {
  private perm = new Uint8Array(512);

  constructor(readonly seed: number) {
    const r = mulberry32(seed);
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private hash(i: number, j: number) {
    return this.perm[this.perm[i & 255] + (j & 255)] / 255;
  }

  vnoise(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi), b = this.hash(xi + 1, yi), c = this.hash(xi, yi + 1), d = this.hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x: number, y: number, octaves = 5) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.vnoise(x * f, y * f);
      n += a;
      f *= 2;
      a *= 0.5;
    }
    return s / n;
  }
}
