// Collision math shared by walls/barriers (ChunkManager), the player's swept move and vehicle-vs-vehicle contact.
// Everything here is pure and allocation-free: callers pass reusable output objects.
//
// Ground-plane conventions: heading h points along (sin h, cos h); its right-hand side is (cos h, -sin h);
// increasing h turns the nose toward the right-hand side.

/**
 * A solid thing in the world: a circle (x, z, r) or, with (x2, z2), a capsule = every point within r of the
 * segment (x, z)→(x2, z2). Capsules make barriers continuous: a row of armco is one smooth wall, not a zipper of
 * circles with gaps and dents. `top` is the absolute height of its top (things above it pass over).
 */
export interface Obstacle { x: number; z: number; r: number; top: number; x2?: number; z2?: number }

/** Reusable penetration result: unit push-out normal (from the obstacle toward the probe) and depth (m). */
export interface Push { nx: number; nz: number; depth: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Parameter (0..1) of the point on segment A→B closest to P. */
export function segParam(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
  return l2 < 1e-12 ? 0 : clamp01(((px - ax) * ux + (pz - az) * uz) / l2);
}

/** Squared distance from (px, pz) to the obstacle's core (its centre point or segment). */
export function obsDist2(o: Obstacle, px: number, pz: number) {
  let cx = o.x, cz = o.z;
  if (o.x2 !== undefined && o.z2 !== undefined) {
    const t = segParam(o.x, o.z, o.x2, o.z2, px, pz);
    cx += (o.x2 - o.x) * t;
    cz += (o.z2 - o.z) * t;
  }
  const dx = px - cx, dz = pz - cz;
  return dx * dx + dz * dz;
}

/** Does a circle of radius r at (px, pz) overlap the obstacle (ground plane only)? */
export function obsOverlap(o: Obstacle, px: number, pz: number, r: number) {
  const rr = r + o.r;
  return obsDist2(o, px, pz) < rr * rr;
}

/**
 * Penetration of a circle (px, pz, r) into an obstacle. Writes the push-out normal and depth into `out` and returns
 * true when they overlap. A probe exactly on the core has no defined direction: the normal is (0, 0) then and the
 * caller picks one (usually against its travel direction).
 */
export function obsPush(o: Obstacle, px: number, pz: number, r: number, out: Push) {
  let cx = o.x, cz = o.z;
  if (o.x2 !== undefined && o.z2 !== undefined) {
    const t = segParam(o.x, o.z, o.x2, o.z2, px, pz);
    cx += (o.x2 - o.x) * t;
    cz += (o.z2 - o.z) * t;
  }
  const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz, rr = r + o.r;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2);
  out.depth = rr - d;
  if (d > 1e-6) { out.nx = dx / d; out.nz = dz / d; }
  else { out.nx = 0; out.nz = 0; }
  return true;
}

/**
 * Tunnelling guard: how many sub-steps a move of `len` metres needs so a probe of radius r never skips over a
 * barrier (each sub-step is at most half the probe radius, at least 0.25 m, capped at `max`).
 */
export function sweepSteps(len: number, r: number, max = 24) {
  if (!(len > 0)) return 1;
  return Math.min(max, Math.max(1, Math.ceil(len / Math.max(0.25, r * 0.5))));
}

/**
 * Swept probe from (x0, z0) to (x1, z1): the fraction (0..1] of the move at the first blocked sub-step, or -1 when
 * the whole path is clear. `blocked` is called with sub-step positions; pass a function created once (no closures
 * per call in hot paths).
 */
export function sweep(x0: number, z0: number, x1: number, z1: number, r: number, blocked: (x: number, z: number) => boolean) {
  const dx = x1 - x0, dz = z1 - z0, n = sweepSteps(Math.hypot(dx, dz), r);
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    if (blocked(x0 + dx * f, z0 + dz * f)) return f;
  }
  return -1;
}

// ------------------------------------------------------------------------------------------ vehicle bodies

/**
 * A vehicle for contact: a capsule along its heading (half core length `a`, radius `r` = half width) with mass and a
 * ground-plane velocity. Outputs (dvx/dvz velocity change, px/pz position correction, spin = yaw-rate change, impact)
 * are accumulated by `collidePair` and applied by the owner. `apply` = false: the body takes part in the maths (its
 * mass and velocity count) but is never moved, e.g. an online player whose own client owns its car.
 */
export interface Body {
  x: number; z: number; y: number; h: number;
  vx: number; vz: number;
  m: number; r: number; a: number;
  apply: boolean;
  dvx: number; dvz: number; px: number; pz: number; spin: number;
  /** Strongest closing speed (m/s along the contact normal) this step, its contact point and the other body. */
  impact: number; cx: number; cz: number; other: Body | null;
}

export function newBody(): Body {
  return { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, m: 1000, r: 1, a: 1, apply: true, dvx: 0, dvz: 0, px: 0, pz: 0, spin: 0, impact: 0, cx: 0, cz: 0, other: null };
}

export function resetOutputs(b: Body) {
  b.dvx = b.dvz = b.px = b.pz = b.spin = b.impact = 0;
  b.other = null;
}

export interface ContactParams {
  /** Share of the closing speed bounced back (0 = dead stop, 1 = perfectly elastic). */
  restitution: number;
  /** Coulomb friction between bodywork: tangential impulse ≤ μ · normal impulse. */
  friction: number;
  /** Most position correction per step (m) for ordinary overlaps. */
  maxPush: number;
  /** Most position correction per step (m) when two bodies sit (nearly) on top of each other: they ease apart. */
  slowPush: number;
  /** Yaw kick scale (1 = rigid-body value). */
  spin: number;
  /** Largest yaw-rate change one contact can cause (rad/s). */
  maxSpin: number;
  /** Bodies more than this far apart vertically never touch (jumps, thruster flight). */
  maxDy: number;
}

/** Scratch for segment-segment closest points. */
export interface SegSeg { s: number; t: number; d2: number; c1x: number; c1z: number; c2x: number; c2z: number }

/**
 * Closest points between segments P1→Q1 and P2→Q2 (Ericson, Real-Time Collision Detection 5.1.9), in the plane.
 * Handles degenerate (point) segments and parallel segments.
 */
export function segSeg(p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number, out: SegSeg) {
  const d1x = q1x - p1x, d1z = q1z - p1z, d2x = q2x - p2x, d2z = q2z - p2z, rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  out.s = s; out.t = t;
  out.c1x = p1x + d1x * s; out.c1z = p1z + d1z * s;
  out.c2x = p2x + d2x * t; out.c2z = p2z + d2z * t;
  const dx = out.c1x - out.c2x, dz = out.c1z - out.c2z;
  out.d2 = dx * dx + dz * dz;
  return out;
}

const _ss: SegSeg = { s: 0, t: 0, d2: 0, c1x: 0, c1z: 0, c2x: 0, c2z: 0 };

/**
 * Contact between two vehicle capsules. Separates them along the contact normal (split by inverse mass among the
 * bodies that `apply`), and when they are closing, exchanges a normal impulse j = -(1+e)·vn / (1/mA + 1/mB) plus a
 * friction impulse (≤ μ·j) that drags the faster one's side and spins both about their centres.
 * Returns the closing speed (> 0), 0 for a resting touch, or -1 when apart. Never produces NaN: coincident bodies get
 * a deterministic normal and ease apart at `slowPush` per step.
 */
export function collidePair(A: Body, B: Body, P: ContactParams) {
  if (Math.abs(A.y - B.y) > P.maxDy) return -1;
  const reach = A.a + A.r + B.a + B.r, ddx = A.x - B.x, ddz = A.z - B.z;
  if (ddx * ddx + ddz * ddz > reach * reach) return -1; // broad phase
  const fax = Math.sin(A.h) * A.a, faz = Math.cos(A.h) * A.a, fbx = Math.sin(B.h) * B.a, fbz = Math.cos(B.h) * B.a;
  const ss = segSeg(A.x - fax, A.z - faz, A.x + fax, A.z + faz, B.x - fbx, B.z - fbz, B.x + fbx, B.z + fbz, _ss);
  const rr = A.r + B.r;
  if (ss.d2 >= rr * rr) return -1;
  const d = Math.sqrt(ss.d2);
  let nx: number, nz: number;
  if (d > 1e-4) { nx = (ss.c1x - ss.c2x) / d; nz = (ss.c1z - ss.c2z) / d; }
  else {
    // cores cross or coincide: push apart along the line between centres, else to A's right-hand side
    const cd = Math.hypot(ddx, ddz);
    if (cd > 1e-4) { nx = ddx / cd; nz = ddz / cd; }
    else { nx = Math.cos(A.h); nz = -Math.sin(A.h); }
  }
  const depth = rr - d;
  // contact point: midway between the two surfaces
  const cx = (ss.c1x + ss.c2x) * 0.5, cz = (ss.c1z + ss.c2z) * 0.5;

  // --- separation (position only, no velocity): heavier bodies move less; non-applying bodies don't move
  const iA = 1 / Math.max(1, A.m), iB = 1 / Math.max(1, B.m);
  const wA = A.apply ? iA : 0, wB = B.apply ? iB : 0, wS = wA + wB;
  if (wS > 0) {
    const corr = Math.min(depth, d < rr * 0.35 ? P.slowPush : P.maxPush);
    A.px += nx * corr * (wA / wS); A.pz += nz * corr * (wA / wS);
    B.px -= nx * corr * (wB / wS); B.pz -= nz * corr * (wB / wS);
  }

  // --- impulse
  const rvx = A.vx - B.vx, rvz = A.vz - B.vz, vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0; // separating or resting
  const j = (-(1 + P.restitution) * vn) / (iA + iB);
  let tx = rvx - vn * nx, tz = rvz - vn * nz;
  const vt = Math.hypot(tx, tz);
  let jt = 0;
  if (vt > 1e-4) { tx /= vt; tz /= vt; jt = Math.min(P.friction * j, vt / (iA + iB)); }
  else tx = tz = 0;
  // impulse on A: J = j·n - jt·t (B gets -J)
  const Jx = j * nx - jt * tx, Jz = j * nz - jt * tz;
  const imp = -vn;
  if (A.apply) {
    A.dvx += Jx * iA; A.dvz += Jz * iA;
    A.spin += yawKick(A, cx, cz, Jx, Jz, P);
  }
  if (B.apply) {
    B.dvx -= Jx * iB; B.dvz -= Jz * iB;
    B.spin += yawKick(B, cx, cz, -Jx, -Jz, P);
  }
  if (imp > A.impact) { A.impact = imp; A.cx = cx; A.cz = cz; A.other = B; }
  if (imp > B.impact) { B.impact = imp; B.cx = cx; B.cz = cz; B.other = A; }
  return imp;
}

/** Yaw-rate change from impulse (Jx, Jz) at (cx, cz): Δω = J · (r.z, -r.x) / I, I = m·(L² + W²)/12 of the body's box. */
function yawKick(b: Body, cx: number, cz: number, Jx: number, Jz: number, P: ContactParams) {
  const rx = cx - b.x, rz = cz - b.z, L = 2 * (b.a + b.r), W = 2 * b.r, I = (b.m * (L * L + W * W)) / 12;
  const w = ((Jx * rz - Jz * rx) / Math.max(1, I)) * P.spin;
  return w > P.maxSpin ? P.maxSpin : w < -P.maxSpin ? -P.maxSpin : w;
}

/**
 * Signed speed + travel direction after a velocity change, keeping the travel direction on the heading's side
 * (a hit from behind never flips the car to "reversing at speed"). Writes into out.v / out.moveH; NaN-safe.
 */
export function toSpeedHeading(vx: number, vz: number, h: number, moveH: number, out: { v: number; moveH: number }) {
  const sp = Math.hypot(vx, vz);
  if (!Number.isFinite(sp) || sp < 0.05) { out.v = 0; out.moveH = Number.isFinite(moveH) ? moveH : h; return out; }
  const d = Math.atan2(vx, vz);
  if (Math.cos(d - h) >= 0) { out.v = sp; out.moveH = d; }
  else { out.v = -sp; out.moveH = d + Math.PI; }
  return out;
}

/** Vehicle mass in kg (incl. rider/driver) from its garage spec ("1,240 kg"); F1 cars use their physics mass. */
export function massFromSpec(kind: 'bike' | 'car', weight: string | undefined, f1Mass?: number) {
  if (f1Mass && f1Mass > 0) return f1Mass;
  const kg = parseFloat((weight ?? '').replace(/[^0-9.]/g, ''));
  const base = Number.isFinite(kg) && kg > 30 ? kg : kind === 'bike' ? 200 : 1300;
  return base + (kind === 'bike' ? 80 : 75);
}
