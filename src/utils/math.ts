export const PI = Math.PI;
export const TAU = PI * 2;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapPi = (a: number) => {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
};
/** Frame-rate independent smoothing factor. */
export const damp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
export const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
export const lerpAngle = (a: number, b: number, t: number) => a + wrapPi(b - a) * t;

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
