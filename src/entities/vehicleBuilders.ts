// Spec-driven vehicle builders for the garage expansion (data/vehicleLooks.ts): three parametric builders
// (car body, formula car, motorcycle) turn a few numbers per vehicle into a low-poly model, so 45 vehicles
// share one code path. Geometry is memoised through the vehicleModels kit, so identical parts share buffers.
// The kit is only touched inside the builder functions (vehicleModels imports this file: keep it that way).
import * as THREE from 'three';
import { M } from './assets';
import { PI, clamp } from '../utils/math';
import { parts, type VehicleModel, type F1Wheel } from './vehicleModels';
import { LOOKS, type BikeLook, type CarExtra, type CarLook, type FormulaLook } from '../data/vehicleLooks';

type Builder = (color: number) => VehicleModel;

let glowMat: THREE.MeshStandardMaterial | null = null, canMat: THREE.MeshStandardMaterial | null = null, alloyMat: THREE.MeshStandardMaterial | null = null;
const glow = () => (glowMat ??= M(0x40e0ff, { emissive: 0x20c0ff, emissiveIntensity: 1.2 }));

// ---------------------------------------------------------------- cars
function specCar(id: string, c: CarLook, color: number): VehicleModel {
  const P = parts, mt = P.mat, { box, cyl, tor, cone, prism, sym, numMat } = P;
  const k = P.kit(color), { add, body, beam, tube, con } = k;
  const { L, W, belt, sill, shape } = c;
  const nose = c.nose ?? 0.12, deck = c.deck ?? 0, roof = c.roof ?? 0, open = roof <= 0;
  const [c0, c1] = c.cab;
  const rf = c.wheel, rr = c.rearWheel ?? rf, tf = c.tyre ?? 0.24, tr = c.rearTyre ?? tf;
  const track = c.track ?? W / 2 - 0.06, fz = c.fz ?? L * 0.62, rz = c.rz ?? -L * 0.6;
  const ex = new Set<CarExtra>(c.extras ?? []), has = (e: CarExtra) => ex.has(e);
  const rig = P.rigWith(k, (r, w, s) => P.carWheel(r, w, c.rim, s), rf, rr, tf, tr, track, track, fz, rz);

  // body side profile: bumper face, bonnet (drops by `nose`), cowl, one straight line to the (raised) tail deck
  const hoodY = belt - nose, deckY = belt + deck, mid = sill + (belt - sill) * 0.5;
  const front = Math.max(sill + 0.08, hoodY - Math.min(0.22, (hoodY - sill) * 0.45));
  const up = [[L, front], [L - 0.12, hoodY], [c0, belt], [-L + 0.12, deckY], [-L, deckY - 0.12]];
  const yAt = (z: number) => {
    if (z >= up[0][0]) return up[0][1];
    for (let i = 1; i < up.length; i++) {
      const [z0, y0] = up[i - 1], [z1, y1] = up[i];
      if (z >= z1) return y0 + ((y1 - y0) * (z0 - z)) / Math.max(1e-6, z0 - z1);
    }
    return up[up.length - 1][1];
  };
  const bw = shape === 'buggy' ? W * 0.74 : W;
  add(prism(`x${id}`, [[L - 0.05, sill], ...up, [-L + 0.05, sill]], bw), body, 0, 0, 0);
  const hoodRx = Math.atan2(belt - hoodY, L - 0.12 - c0), deckRx = Math.atan2(deckY - belt, c0 - (-L + 0.12));

  // ---- cabin ----
  const cw = W * (c.cabW ?? 0.84), minRoof = shape === 'proto' || shape === 'wedge' ? 0.4 : 0.55;
  // keep a real roof: shorten the glass rakes proportionally when the cabin is too short for them
  const rake = (c.ws ?? 0.7) + (c.bl ?? 0.6), fit = clamp((c0 - c1 - minRoof) / rake, 0.2, 1);
  const ws = (c.ws ?? 0.7) * fit, bl = (c.bl ?? 0.6) * fit;
  const rF = c0 - ws, rR = c1 + bl, yF = yAt(c0), yR = yAt(c1), roofZ = (rF + rR) / 2, roofL = rF - rR;
  if (!open) {
    add(prism(`g${id}`, [[c0 + 0.02, yF - 0.01], [rF, roof], [rR, roof], [c1 - 0.02, yR - 0.01]], cw), mt.winMat, 0, 0, 0);
    add(box(cw + 0.02, 0.05, roofL), body, 0, roof + 0.02, roofZ);
    sym((s) => {
      beam(0.07, 0.06, body, s * cw / 2, c0, yF, rF, roof);
      beam(shape === 'fastback' || shape === 'proto' ? 0.14 : 0.1, 0.06, body, s * (cw / 2 - 0.02), rR, roof, c1, yR);
      if (shape === 'saloon' || shape === 'wagon' || shape === 'suv' || shape === 'hatch') {
        const zb = roofZ + roofL * 0.12, yb = yAt(zb);
        add(box(0.06, roof - yb, 0.09), body, s * (cw / 2 + 0.005), (roof + yb) / 2, zb);
      }
    });
    P.mirrors(k, body, cw / 2 + 0.1, yF + 0.1, c0 - 0.12);
  } else {
    const cz = (c0 + c1) / 2, cl = c0 - c1;
    add(box(bw * 0.74, 0.03, cl), mt.dark, 0, yAt(cz) + 0.005, cz);
    const small = has('rollbar') || shape === 'buggy';
    add(box(bw * (small ? 0.45 : 0.8), small ? 0.14 : 0.3, 0.02), mt.winMat, small ? W * 0.2 : 0, yAt(c0) + (small ? 0.07 : 0.15), c0, -0.45);
    if (!small) add(box(bw * 0.82, 0.03, 0.04), mt.chrome, 0, yAt(c0) + 0.29, c0 - 0.07, -0.45);
    sym((s) => add(box(0.42, 0.36, 0.12), mt.leather, s * W * 0.2, yAt(c1) + 0.1, c1 + 0.12, -0.2));
  }

  // ---- arches ----
  for (const [z, r] of [[fz, rf], [rz, rr]]) {
    sym((s) => {
      if (c.arches === 'flare') add(box(0.13, 0.14, r * 2.7), body, s * (W / 2 + 0.02), Math.max(sill + 0.12, 2 * r - 0.04), z);
      else if (c.arches === 'box') add(box(0.2, 0.24, r * 3.1), body, s * (W / 2 + 0.05), Math.max(sill + 0.14, 2 * r - 0.06), z);
      else if (c.arches === 'round') P.arch(k, r + 0.07, s * (W / 2 - 0.02), r, z);
    });
  }

  // ---- lights, grille, bumpers ----
  const ly = front - 0.06, lz = L + 0.004;
  const disc = (r: number, x: number, y: number, z: number, m: THREE.Material) => add(cyl(r, r, 0.04, 10), m, x, y, z, PI / 2);
  switch (c.lights) {
    case 'round': sym((s) => { disc(0.1, s * W * 0.32, ly, lz, mt.lampMat); add(tor(0.1, 0.018, 4, 12), mt.chrome, s * W * 0.32, ly, lz + 0.02); }); break;
    case 'quad': sym((s) => { disc(0.07, s * W * 0.24, ly, lz, mt.lampMat); disc(0.07, s * W * 0.38, ly, lz, mt.lampMat); }); break;
    case 'square': sym((s) => add(box(0.32, 0.12, 0.04), mt.lampMat, s * W * 0.3, ly, lz)); break;
    case 'slim': sym((s) => add(box(0.42, 0.05, 0.08), mt.lampMat, s * W * 0.3, (front + hoodY) / 2, L - 0.06, hoodRx, -s * 0.22)); break;
    case 'popup': sym((s) => { add(box(0.36, 0.02, 0.3), mt.dark, s * W * 0.28, yAt(L - 0.4) + 0.012, L - 0.4, hoodRx); add(box(0.24, 0.045, 0.03), mt.lampMat, s * W * 0.32, sill + 0.14, lz); }); break;
    case 'bar': add(box(W * 0.86, 0.035, 0.05), mt.lampMat, 0, (front + hoodY) / 2, L - 0.05, hoodRx); break;
    case 'none': break;
  }
  const grille = shape !== 'proto' && shape !== 'wedge' && shape !== 'buggy' && c.lights !== 'bar' && !has('grille7');
  if (grille) add(box(W * 0.42, Math.min(0.16, front - sill - 0.08), 0.03), mt.dark, 0, ly - 0.02, L + 0.002);
  if (has('grille7')) for (let i = -3; i <= 3; i++) add(box(0.045, Math.min(0.42, front - sill - 0.1), 0.02), mt.dark, i * 0.085, (front + sill) / 2 + 0.04, L + 0.006);
  const bm = c.bumpers === 'chrome' ? mt.chrome : mt.dark;
  if (c.bumpers) for (const z of [L + 0.03, -L - 0.03]) add(box(W + 0.06, 0.1, 0.12), bm, 0, sill + 0.1, z);

  const ty = deckY - 0.2, tz = -L - 0.005;
  switch (c.tail) {
    case 'bar': add(box(W * 0.86, 0.05, 0.04), k.brakeMat, 0, ty, tz); break;
    case 'round': sym((s) => { disc(0.065, s * W * 0.24, ty, tz, k.brakeMat); disc(0.065, s * W * 0.36, ty, tz, k.brakeMat); }); break;
    case 'block': sym((s) => add(box(0.4, 0.13, 0.04), k.brakeMat, s * W * 0.3, ty, tz)); break;
    case 'fins': sym((s) => disc(0.06, s * (W / 2 - 0.06), belt + deck + 0.12, -L - 0.03, k.brakeMat)); break;
  }

  // ---- exhaust + nitro flame ----
  const ey = sill + 0.07, ez = -L - 0.02, x1 = W * 0.3;
  const pipe = (x: number, y: number, r = 0.06) => add(cyl(r, r, 0.22, 8), mt.chrome, x, y, ez, PI / 2);
  let fl: [number, number, number, number] = [x1, ey, ez - 0.43, 0.08], twin: [number, number] | undefined;
  switch (c.exhaust) {
    case 'single': pipe(x1, ey); break;
    case 'twin': sym((s) => pipe(s * x1, ey)); twin = [-2 * x1, 0]; break;
    case 'quad': sym((s) => { pipe(s * W * 0.27, ey, 0.05); pipe(s * W * 0.37, ey, 0.05); }); fl = [W * 0.32, ey, ez - 0.43, 0.09]; twin = [-W * 0.64, 0]; break;
    case 'center': { const y = sill + (deckY - sill) * 0.45; sym((s) => pipe(s * 0.09, y, 0.055)); fl = [0, y, ez - 0.43, 0.09]; break; }
    case 'side': {
      const x = W / 2 + 0.06, z0 = fz - rf - 0.12, z1 = rz + rr + 0.12;
      sym((s) => add(cyl(0.055, 0.055, z0 - z1, 8), mt.chrome, s * x, sill + 0.06, (z0 + z1) / 2, PI / 2));
      fl = [x, sill + 0.06, z1 - 0.43, 0.07]; twin = [-2 * x, 0]; break;
    }
    case 'stack': {
      const zs = open ? -L + 0.55 : c1 - 0.2, y0 = yAt(zs), h = open ? 0.35 : 0.6;
      sym((s) => add(cyl(0.06, 0.07, h, 8), mt.chrome, s * W * 0.28, y0 + h / 2, zs));
      fl = [W * 0.28, y0 + h, zs - 0.45, 0.09]; twin = [-W * 0.56, 0]; break;
    }
    case 'none': fl = [0, sill + 0.12, ez - 0.43, 0.06]; break;
  }

  // ---- wing ----
  if (c.wing) {
    const w = c.wing, span = W * (w.w ?? 0.95), wz = w.z ?? -L + w.c / 2 + 0.06, dy = yAt(wz), wy = dy + w.h + 0.03, m = w.paint ? body : mt.carbon;
    add(box(span, 0.04, w.c), m, 0, wy, wz, 0.1);
    if (w.h > 0.08) sym((s) => add(box(0.04, w.h, Math.min(0.16, w.c)), m, s * span * 0.38, dy + w.h / 2, wz));
    if (w.plates) sym((s) => add(box(0.03, 0.22, w.c + 0.08), m, s * span / 2, wy - 0.05, wz));
  }

  // ---- livery ----
  const doorZ = (c0 + c1) / 2;
  if (c.stripe === 'twin') sym((s) => {
    beam(0.16, 0.012, con, s * 0.17, L - 0.12, hoodY + 0.008, c0, belt + 0.008);
    if (!open) add(box(0.16, 0.012, roofL), con, s * 0.17, roof + 0.05, roofZ);
    beam(0.16, 0.012, con, s * 0.17, open ? c1 : c1 - 0.02, yR + 0.008, -L + 0.12, deckY + 0.008);
  });
  if (c.stripe === 'side' || c.stripe === 'livery') sym((s) => add(box(0.012, 0.07, 2 * L * 0.82), con, s * (W / 2 + 0.006), mid + 0.06, 0));
  if (c.stripe === 'livery') {
    beam(0.32, 0.012, con, 0, L - 0.12, hoodY + 0.008, c0, belt + 0.008);
    if (!open) add(box(0.32, 0.012, roofL), con, 0, roof + 0.05, roofZ);
  }
  if (c.stripe === 'twotone') add(box(W + 0.012, mid - sill, 2 * L - 0.16), con, 0, (mid + sill) / 2, 0);
  if (c.stripe === 'rocker') sym((s) => add(box(0.02, 0.08, 2 * L * 0.6), mt.dark, s * (W / 2 + 0.006), sill + 0.06, 0));
  if (c.number) sym((s) => add(box(0.012, 0.28, 0.28), numMat(c.number!), s * (W / 2 + 0.01), mid + 0.04, doorZ));

  // ---- extras ----
  const hz = (L + c0) / 2;
  if (has('cage')) {
    if (open) ex.add('rollbar');
    else {
      const zc = rR + 0.12;
      sym((s) => tube(0.025, 0.025, mt.white, s * cw * 0.4, zc, yAt(zc) - 0.25, zc, roof - 0.06));
      add(cyl(0.025, 0.025, cw * 0.8), mt.white, 0, roof - 0.06, zc, 0, 0, PI / 2);
      add(cyl(0.02, 0.02, cw * 0.95), mt.white, 0, (roof + yAt(zc)) / 2, zc, 0, 0, -0.9);
    }
  }
  if (ex.has('rollbar')) {
    const zb = c1 + 0.02, yb = yAt(zb), h = 0.5;
    sym((s) => tube(0.035, 0.035, mt.cage, s * W * 0.3, zb, yb - 0.05, zb, yb + h));
    add(cyl(0.035, 0.035, W * 0.6), mt.cage, 0, yb + h, zb, 0, 0, PI / 2);
    tube(0.03, 0.03, mt.cage, 0, zb, yb + h, zb - 0.6, yAt(zb - 0.6));
  }
  if (has('scoop')) { add(box(0.46, 0.11, 0.6), body, 0, yAt(hz) + 0.05, hz, hoodRx); add(box(0.36, 0.06, 0.02), mt.dark, 0, yAt(hz + 0.3) + 0.07, hz + 0.3); }
  if (has('blower')) {
    const y = yAt(hz);
    add(box(0.46, 0.2, 0.46), mt.chrome, 0, y + 0.1, hz);
    add(box(0.5, 0.16, 0.3), mt.dark, 0, y + 0.28, hz + 0.02);
    sym((s) => add(cyl(0.05, 0.05, 0.5, 8), mt.chrome, s * W * 0.42, y - 0.05, hz + 0.25, 0, 0, s * 0.9));
  }
  if (has('roofscoop') && !open) { add(box(0.34, 0.12, 0.42), body, 0, roof + 0.08, rF - 0.28); add(box(0.26, 0.07, 0.02), mt.dark, 0, roof + 0.09, rF - 0.07); }
  if (has('lightpod')) {
    const y = hoodY + 0.12, z = L - 0.12;
    add(box(W * 0.72, 0.16, 0.08), mt.dark, 0, y, z);
    for (const x of [-0.375, -0.125, 0.125, 0.375]) disc(0.1, x * W, y, z + 0.06, mt.lampMat);
  }
  if (has('snorkel')) {
    const x = W / 2 + 0.06;
    tube(0.05, 0.05, mt.dark, x, c0 + 0.2, sill + 0.3, c0 + 0.05, roof - 0.05);
    add(box(0.14, 0.12, 0.2), mt.dark, x, roof - 0.02, c0 + 0.08);
  }
  if (has('spare')) {
    const r = Math.min(rr * 0.92, 0.42), y = Math.max(mid + 0.12, sill + r);
    add(cyl(r, r, 0.24, 14), mt.tyre, 0, y, -L - 0.14, PI / 2);
    add(cyl(r * 0.6, r * 0.6, 0.26, 10), mt.rimDark, 0, y, -L - 0.14, PI / 2);
  }
  if (has('bullbar')) {
    sym((s) => tube(0.04, 0.04, mt.dark, s * W * 0.3, L + 0.16, sill, L + 0.16, front + 0.12));
    for (const y of [sill + 0.12, front + 0.12]) add(cyl(0.04, 0.04, W * 0.75), mt.dark, 0, y, L + 0.16, 0, 0, PI / 2);
  }
  if (has('roofrack') && !open) {
    add(box(cw * 0.95, 0.04, roofL * 0.92), mt.dark, 0, roof + 0.14, roofZ);
    sym((s) => add(box(0.04, 0.12, roofL * 0.92), mt.dark, s * cw * 0.46, roof + 0.1, roofZ));
    for (const z of [roofZ + 0.25, roofZ - 0.25]) add(box(0.4, 0.22, 0.3), (canMat ??= M(0x4f6b3a)), -cw * 0.2, roof + 0.27, z);
  }
  if (has('fin')) {
    const zt = -L + 0.35;
    beam(0.025, open ? 0.3 : 0.24, body, 0, open ? c1 : rR, open ? yAt(c1) + 0.2 : roof - 0.06, zt, yAt(zt) + 0.18);
  }
  if (has('louvres')) {
    const [za, ya, zb, yb] = !open && (shape === 'fastback' || shape === 'wedge') ? [rR, roof, c1, yR] : [c1 - 0.1, yAt(c1 - 0.1), -L + 0.35, yAt(-L + 0.35)];
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      add(box((open ? W : cw) * 0.8, 0.025, 0.1), mt.dark, 0, ya + (yb - ya) * t + 0.03, za + (zb - za) * t, Math.atan2(ya - yb, za - zb));
    }
  }
  if (has('mudflaps')) for (const [z, r] of [[fz, rf], [rz, rr]]) sym((s) => add(box(0.3, 0.3, 0.02), mt.dark, s * track, 0.25, z - r - 0.12));
  if (has('lightbar') && !open) {
    add(box(cw * 0.9, 0.1, 0.1), mt.dark, 0, roof + 0.1, rF);
    for (let i = -2; i <= 2; i++) add(box(0.18, 0.06, 0.03), mt.lampMat, i * cw * 0.17, roof + 0.1, rF + 0.06);
  }
  if (has('straps')) for (const z of [hz + 0.25, hz - 0.25]) add(box(W * 0.9, 0.015, 0.05), mt.leather, 0, yAt(z) + 0.01, z);
  if (has('tailfins')) sym((s) => add(prism(`fin${id}`, [[-L + 1.3, deckY], [-L - 0.02, deckY + 0.3], [-L - 0.02, deckY - 0.02]], 0.07), body, s * (W / 2 - 0.05), 0, 0));
  if (has('splitter')) add(box(W + 0.04, 0.03, 0.3), mt.carbon, 0, sill + 0.02, L - 0.06);
  if (has('diffuser')) {
    add(box(W * 0.85, 0.03, 0.42), mt.carbon, 0, sill + 0.02, -L + 0.14);
    for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) add(box(0.03, 0.18, 0.42), mt.carbon, x * W * 0.6, sill + 0.1, -L + 0.14);
  }
  if (has('sidepods')) sym((s) => add(box(0.03, Math.min(0.26, belt - sill - 0.12), 0.6), mt.dark, s * (W / 2 + 0.005), mid + 0.04, rz + rr + 0.45));
  if (has('fan')) {
    const y = sill + (deckY - sill) * 0.55;
    add(cyl(0.32, 0.32, 0.05, 14), mt.dark, 0, y, -L - 0.02, PI / 2);
    add(tor(0.33, 0.035, 4, 16), mt.carbon, 0, y, -L - 0.03);
    for (let i = 0; i < 3; i++) add(box(0.6, 0.06, 0.02), mt.engineMat, 0, y, -L - 0.05, 0, 0, (i * PI) / 3);
  }
  if (has('bed')) {
    const zb = c1 - 0.04, len = zb - (-L + 0.06), zc = (zb - L + 0.06) / 2, yb = yAt(zc);
    add(box(W - 0.2, 0.02, len), mt.dark, 0, yb + 0.012, zc, deckRx);
    sym((s) => add(box(0.08, 0.14, len), body, s * (W / 2 - 0.04), yb + 0.07, zc, deckRx));
    add(box(W, 0.14, 0.06), body, 0, yAt(-L + 0.1) + 0.07, -L + 0.06);
  }
  if (has('engine')) {
    const ze = -L + 0.6, y = yAt(ze);
    add(box(W * 0.4, 0.24, 0.6), mt.engineMat, 0, y + 0.1, ze);
    for (const x of [-0.12, 0.12]) for (const dz of [-0.15, 0.15]) add(cyl(0.045, 0.06, 0.2, 8), mt.chrome, x * W, y + 0.32, ze + dz);
  }
  if (has('shocks')) for (const [z, r] of [[fz, rf], [rz, rr]]) {
    sym((s) => tube(0.06, 0.06, mt.spring, s * (track - 0.25), z + 0.05, r, z - 0.15, sill + 0.15));
    add(cyl(0.08, 0.08, track * 2 - 0.2, 6), mt.dark, 0, r, z, 0, 0, PI / 2);
  }
  if (has('chrome')) sym((s) => add(box(0.012, 0.03, 2 * L * 0.8), mt.chrome, s * (W / 2 + 0.01), mid + 0.14, 0));
  if (has('nosecone')) add(prism(`nc${id}`, [[L - 0.05, sill], [L - 0.02, front], [L + 0.5, sill + 0.14], [L + 0.52, sill + 0.06]], W * 0.92), body, 0, 0, 0);
  if (has('canards')) sym((s) => add(box(0.24, 0.02, 0.16), mt.carbon, s * (W / 2 - 0.08), sill + 0.18, L - 0.05, 0, 0, s * 0.25));
  if (has('hoodvents')) sym((s) => add(box(0.24, 0.02, 0.32), mt.dark, s * W * 0.18, yAt(hz) + 0.012, hz, hoodRx));
  if (has('whitewall')) for (const w of rig.wheels) sym((s) => {
    const o = new THREE.Mesh(tor(rf * 0.82, 0.045, 4, 16), mt.white);
    o.rotation.y = PI / 2;
    o.position.x = s * (tf / 2 + 0.005);
    w.add(o);
  });
  if (has('roofline') && !open) sym((s) => add(box(0.04, 0.05, roofL * 0.9), mt.dark, s * cw * 0.42, roof + 0.07, roofZ));
  if (shape === 'buggy') {
    add(box(0.7, 0.05, 1.0), mt.dark, 0, sill - 0.02, -0.2); // pan
    add(cone(0.12, 0.25, 6), mt.chrome, 0, 0.42 + sill, L - 0.1, PI / 2);
  }

  // ---- driver ----
  const seat: [number, number, number] = c.seat ?? (open
    ? [W * 0.2, belt - 0.52, (c0 + c1) / 2 - 0.05]
    : [Math.min(W * 0.2, cw * 0.28), roof - 0.93, roofZ - 0.05]);
  return P.carDone(k, rig, fl, [ly, L], seat, twin);
}

// ---------------------------------------------------------------- formula cars
function specFormula(id: string, f: FormulaLook, color: number): VehicleModel {
  const P = parts, mt = P.mat, { box, cyl, sph, tor, prism, sym } = P;
  const k = P.kit(color), { add, body, tube, beam, con } = k, band = P.bandMat(), num = P.numMat(f.number);
  const wo: F1Wheel = { band, disc: f.wire ? mt.wireMat : mt.rimGrey, spoke: mt.rimDark, n: f.spokes, rimFrac: f.rimFrac, grooved: f.grooved };
  const rig = P.rigWith(k, (r, w, s) => P.f1Wheel(r, w, s, wo), f.rf, f.rr, f.wf, f.wr, f.track[0], f.track[1], f.fz, f.rz);
  // wishbones from the hubs to the tub
  sym((s) => {
    for (const [z, x, r] of [[f.fz, f.track[0], f.rf], [f.rz, f.track[1], f.rr]]) {
      add(box(x - 0.25, 0.025, 0.05), mt.carbon, s * (x + 0.25) / 2, r + 0.04, z);
      add(box(x - 0.25, 0.025, 0.05), mt.carbon, s * (x + 0.25) / 2, r - 0.08, z);
    }
  });
  let seat: [number, number, number], fl: [number, number, number, number], twin: [number, number] | undefined;
  const flaps: { rearFlap?: THREE.Object3D; frontFlap?: THREE.Object3D } = {};
  switch (f.era) {
    case 'front': { // 1950s: long bonnet with the engine ahead of the driver, oval grille, side exhaust, no wings
      add(prism(`fx${id}`, [[2.1, 0.22], [2.18, 0.42], [2.0, 0.62], [0.9, 0.72], [0.2, 0.76], [-0.5, 0.74], [-1.4, 0.62], [-2.05, 0.46], [-2.15, 0.3], [-1.6, 0.2], [1.8, 0.2]], 0.8), body, 0, 0, 0);
      add(cyl(0.2, 0.2, 0.03, 12), mt.dark, 0, 0.42, 2.17, PI / 2).scale.set(1.25, 1, 0.8);
      add(box(0.52, 0.02, 0.62), mt.dark, 0, 0.765, -0.35);
      add(box(0.4, 0.14, 0.02), mt.winMat, 0, 0.84, 0.02, -0.4);
      add(box(0.2, 0.16, 0.6), body, 0, 0.8, -0.95, -0.1);
      sym((s) => {
        for (let i = 0; i < 5; i++) add(box(0.012, 0.03, 0.2), mt.dark, s * 0.405, 0.58, 1.3 - i * 0.12);
        add(box(0.012, 0.28, 0.28), num, s * 0.405, 0.48, -0.9);
      });
      add(box(0.24, 0.012, 0.24), num, 0, 0.73, 1.2, 0.08);
      tube(0.035, 0.045, mt.chrome, 0.43, 1.1, 0.42, -0.4, 0.34);
      tube(0.045, 0.06, mt.chrome, 0.43, -0.4, 0.34, -1.8, 0.32, 8);
      add(box(0.1, 0.05, 0.03), k.brakeMat, 0, 0.42, -2.15);
      seat = [0, 0.98, -0.5];
      fl = [0.43, 0.32, -2.25, 0.07];
      break;
    }
    case 'cigar': { // 1960s: slim tube, rear V8 as a stressed member, high exhausts, roll hoop, no wings
      tube(0.1, 0.27, body, 0, 2.05, 0.36, 0.3, 0.48, 10);
      tube(0.27, 0.22, body, 0, 0.3, 0.48, -0.85, 0.46, 10);
      add(cyl(0.08, 0.08, 0.03, 10), mt.dark, 0, 0.36, 2.06, PI / 2);
      add(box(0.34, 0.02, 0.5), mt.dark, 0, 0.735, -0.15);
      add(box(0.42, 0.12, 0.02), mt.winMat, 0, 0.78, 0.15, -0.5);
      add(tor(0.16, 0.025, 4, 10, PI), mt.chrome, 0, 0.74, -0.5);
      add(box(0.46, 0.3, 0.8), mt.engineMat, 0, 0.48, -1.25);
      add(box(0.36, 0.22, 0.42), mt.carbon, 0, 0.36, -1.82);
      sym((s) => {
        for (const dz of [-0.95, -1.15, -1.35, -1.55]) tube(0.022, 0.03, mt.chrome, s * 0.12, dz, 0.64, dz - 0.25, 0.86, 6);
        add(box(0.012, 0.22, 0.22), num, s * 0.25, 0.5, 0.6);
      });
      beam(0.06, 0.012, con, 0, 2.0, 0.42, 0.35, 0.74);
      add(box(0.1, 0.05, 0.03), k.brakeMat, 0, 0.36, -2.04);
      seat = [0, 0.86, -0.25];
      fl = [0.12, 0.86, -1.95, 0.05];
      twin = [-0.24, 0];
      break;
    }
    case 'turbo': // 1980s: flat-bottom, long sidepods, low cover, huge rear wing
    case 'active': { // 1990s: higher nose, airbox, narrower sidepods
      const t = f.era === 'turbo';
      tube(0.06, 0.18, body, 0, 2.35, t ? 0.3 : 0.38, 1.0, t ? 0.45 : 0.55);
      beam(0.05, 0.012, con, 0, 2.3, t ? 0.36 : 0.44, 1.05, t ? 0.6 : 0.7);
      add(box(0.52, 0.44, 1.2), body, 0, 0.5, 0.4);
      add(box(0.36, 0.02, 0.7), mt.dark, 0, 0.725, 0.2);
      add(box(0.13, 0.012, 0.13), num, 0, t ? 0.52 : 0.6, 1.5, 0.15);
      sym((s) => {
        add(box(t ? 0.46 : 0.34, 0.3, t ? 1.7 : 1.15), body, s * (t ? 0.5 : 0.44), 0.36, t ? -0.5 : -0.2);
        add(box(t ? 0.36 : 0.26, 0.2, 0.02), mt.dark, s * (t ? 0.5 : 0.44), 0.4, t ? 0.36 : 0.38);
        add(box(0.012, 0.16, 0.16), num, s * (t ? 0.73 : 0.61), 0.38, t ? -0.6 : -0.3);
        add(box(0.02, 0.18, 0.42), body, s * 0.8, 0.18, 2.25);
        add(box(0.02, t ? 0.6 : 0.5, 0.7), body, s * 0.5, t ? 0.72 : 0.7, -1.95);
      });
      if (t) tube(0.2, 0.1, body, 0, -0.3, 0.66, -1.65, 0.5);
      else {
        add(box(0.28, 0.36, 0.42), body, 0, 0.98, -0.22);
        add(box(0.2, 0.14, 0.02), mt.dark, 0, 1.06, 0.0);
        tube(0.2, 0.08, body, 0, -0.42, 0.85, -1.6, 0.48);
      }
      add(box(1.4, 0.03, 2.6), mt.carbon, 0, 0.07, 0);
      add(box(1.6, 0.02, 0.36), mt.carbon, 0, 0.1, 2.25, -0.04);
      add(box(t ? 1.0 : 0.9, 0.03, 0.4), mt.carbon, 0, t ? 0.68 : 0.62, -1.98, 0.12);
      add(box(0.1, 0.05, 0.03), k.brakeMat, 0, 0.42, -2.12);
      add(cyl(0.05, 0.05, 0.2, 8), mt.engineMat, 0, 0.5, -2.0, PI / 2);
      flaps.rearFlap = flap(k, body, t ? 1.0 : 0.92, -1.75, t ? [[1.0, 0.32, 0.45, 0, 0], [1.0, 0.16, 0.8, 0.06, -0.3]] : [[0.9, 0.24, 0.5, 0, 0], [0.9, 0.14, 0.75, 0.05, -0.22]]);
      seat = [0, t ? 0.82 : 0.86, 0.15];
      fl = [0, 0.5, -2.45, 0.07];
      break;
    }
    case 'concept': { // 2030s: canopy, wheel arches, ground-effect pods, light bar, active wings
      tube(0.07, 0.2, body, 0, 2.6, 0.3, 1.0, 0.5);
      add(box(0.58, 0.42, 1.4), body, 0, 0.5, 0.45);
      add(sph(0.5, 12, 8), mt.winMat, 0, 0.74, 0.15).scale.set(0.5, 0.4, 1.25);
      add(box(0.5, 0.025, 0.03), mt.lampMat, 0, 0.4, 2.5);
      add(box(0.12, 0.012, 0.12), P.numMat(f.number), 0, 0.5, 1.6, 0.2);
      tube(0.24, 0.08, body, 0, -0.25, 0.7, -1.65, 0.45);
      add(box(0.02, 0.28, 1.1), body, 0, 0.92, -0.85, -0.12);
      add(box(1.5, 0.03, 2.6), mt.carbon, 0, 0.07, 0.05);
      sym((s) => {
        add(prism(`cp${id}`, [[0.6, 0.18], [0.45, 0.5], [-0.4, 0.55], [-1.2, 0.35], [-1.3, 0.18]], 0.4), body, s * 0.5, 0, 0);
        add(box(0.3, 0.2, 0.02), glow(), s * 0.5, 0.36, 0.56);
        for (const [z, r, x] of [[f.fz, f.rf, f.track[0]], [f.rz, f.rr, f.track[1]]]) P.arch(k, r + 0.06, s * x, r, z);
        add(box(0.02, 0.4, 0.6), body, s * 0.52, 0.8, -2.2);
        add(box(0.02, 0.18, 0.5), body, s * 0.88, 0.17, 2.45);
      });
      add(box(1.0, 0.025, 0.3), mt.carbon, 0, 0.84, -2.25, 0.15);
      add(box(1.8, 0.02, 0.34), mt.carbon, 0, 0.11, 2.45);
      add(box(0.9, 0.03, 0.04), k.brakeMat, 0, 0.6, -2.35);
      flaps.rearFlap = flap(k, body, 0.92, -2.12, [[1.0, 0.24, 0.45, 0, 0]]);
      flaps.frontFlap = flap(k, body, 0.14, 2.38, [[1.7, 0.14, 0.3, 0, 0], [1.6, 0.12, 0.5, 0.05, -0.12]]);
      seat = [0, 0.74, 0.2];
      fl = [0, 0.5, -2.7, 0.08];
      break;
    }
  }
  return P.f1Done(k, rig, band, fl, seat, flaps, twin);
}
const flap = (...a: Parameters<typeof parts.flap>) => parts.flap(...a);

// ---------------------------------------------------------------- motorcycles
function specBike(b: BikeLook, color: number): VehicleModel {
  const P = parts, mt = P.mat, { box, cyl, sph, tor, cone, sym, numMat } = P;
  const k = P.kit(color), { add, body, accent, tube, beam } = k;
  const fz = b.fz ?? 1.08, rz = b.rz ?? -1.05;
  const rig = P.bikeRig(k, P.bikeWheel(accent, b.rim[0], b.tube[0], b.disc[0]), P.bikeWheel(accent, b.rim[1], b.tube[1], b.disc[1]), fz, rz);
  const num = b.number ? numMat(b.number) : null;
  const swingarm = (m: THREE.Material, w = 0.08, h = 0.1) => sym((s) => beam(w, h, m, s * 0.2, -0.3, 0.78, rz, 0.62));
  const forks = (m: THREE.Material, topZ: number, topY: number, r = 0.05) => sym((s) => tube(r, r, m, s * 0.17, fz, 0.62, topZ, topY));
  switch (b.style) {
    case 'board': { // 1910s board-track racer: long low loop frame, hung tank, V-twin, springer fork, dropped bars, pedals
      const frame = mt.dark;
      tube(0.035, 0.035, frame, 0, 0.85, 1.25, -0.55, 1.1);
      tube(0.035, 0.035, frame, 0, 0.85, 1.2, 0.3, 0.42);
      tube(0.035, 0.035, frame, 0, -0.4, 1.1, -0.1, 0.42);
      tube(0.03, 0.03, frame, 0, 0.3, 0.42, -0.1, 0.42);
      sym((s) => {
        tube(0.025, 0.025, frame, s * 0.12, -0.1, 0.42, rz, 0.62);
        tube(0.025, 0.025, frame, s * 0.12, -0.45, 1.1, rz, 0.62);
        tube(0.025, 0.025, mt.chrome, s * 0.14, fz, 0.62, 0.86, 1.3);
        tube(0.02, 0.02, mt.chrome, s * 0.1, fz + 0.06, 0.7, 0.92, 1.25);
        add(box(0.03, 0.06, 0.14), mt.dark, s * 0.16, 0.42, 0.15 + s * 0.12);
        if (num) add(box(0.012, 0.18, 0.2), num, s * 0.14, 1.06, 0.35);
      });
      add(box(0.22, 0.24, 0.85), body, 0, 1.08, 0.28);
      for (const [z, a] of [[0.12, 0.42], [-0.12, -0.42]]) {
        add(cyl(0.08, 0.09, 0.4, 8), mt.engineMat, 0, 0.78, z, a);
        for (let i = 0; i < 3; i++) add(cyl(0.12, 0.12, 0.02, 8), mt.engineMat, 0, 0.72 + i * 0.08, z + Math.sin(a) * (i * 0.08 - 0.06), a);
      }
      add(cyl(0.18, 0.18, 0.22, 10), mt.chrome, 0, 0.55, 0, 0, 0, PI / 2);
      add(sph(0.14, 8, 6), mt.leather, 0, 1.2, -0.48).scale.set(1, 0.4, 1.5);
      add(box(0.07, 0.07, 0.24), mt.lampMat, 0, 1.2, 0.95);
      P.bars(k, 1.32, 0.82, 0.62);
      add(tor(0.66, 0.04, 4, 12, PI * 0.55), body, 0, 0.62, rz, 0, PI / 2, 0.3);
      tube(0.04, 0.05, mt.chrome, 0.16, 0.0, 0.62, -1.15, 0.5);
      return P.bikeDone(k, rig, [0.16, 0.5, -1.55, 0.07], [1.2, 1.0]);
    }
    case 'gp': { // 1990s 250 two-stroke GP: twin-spar frame, tiny full fairing, expansion chambers, clip-ons
      sym((s) => {
        beam(0.06, 0.2, mt.rimGrey, s * 0.2, 0.78, 1.3, -0.3, 0.88);
        add(box(0.12, 0.05, 0.16), mt.lampMat, s * 0.08, 1.3, 1.02, 0, s * 0.4);
        add(box(0.02, 0.22, 0.3), num ?? body, s * 0.255, 1.0, 0.15, -0.2);
        tube(0.05, 0.11, mt.engineMat, s * 0.12, 0.42, 0.62, 0.05, 0.3, 8);
        tube(0.11, 0.05, mt.engineMat, s * 0.12, 0.05, 0.3, -0.55, 0.6, 8);
        tube(0.03, 0.03, mt.carbon, s * 0.12, -0.55, 0.6, -1.0, 1.12);
        add(cyl(0.022, 0.022, 0.26), mt.chrome, s * 0.22, 1.42, 0.62, 0, 0, s * (PI / 2 - 0.25));
      });
      forks(mt.rimGold, 0.78, 1.42, 0.045);
      swingarm(mt.rimGrey, 0.07, 0.12);
      add(box(0.5, 0.56, 0.72), body, 0, 0.98, 0.25, -0.12);
      add(cone(0.26, 0.45, 4), body, 0, 1.26, 0.85, PI / 2).scale.set(1, 1, 0.6);
      add(box(0.34, 0.02, 0.3), mt.winMat, 0, 1.48, 0.72, 0.65);
      add(box(0.3, 0.24, 0.02), num ?? mt.white, 0, 1.16, 1.06, -0.3);
      add(box(0.36, 0.2, 0.7), body, 0, 0.55, 0.15);
      add(box(0.32, 0.36, 0.38), mt.engineMat, 0, 0.72, -0.05);
      add(box(0.4, 0.24, 0.5), body, 0, 1.36, 0.05, -0.1);
      add(box(0.26, 0.06, 0.3), mt.dark, 0, 1.33, -0.38);
      add(box(0.28, 0.22, 0.6), body, 0, 1.44, -0.78, 0.22);
      add(box(0.16, 0.03, 0.04), k.brakeMat, 0, 1.43, -1.08, 0.22);
      return P.bikeDone(k, rig, [0.12, 1.12, -1.45, 0.06], [1.3, 1.1], [-0.24, 0]);
    }
    case 'motard': { // supermoto: tall MX chassis on road wheels, flat seat, plates, low front fender, upswept pipe
      const frame = (alloyMat ??= M(0x9aa2ad, { roughness: 0.4, metalness: 0.6 }));
      sym((s) => {
        tube(0.06, 0.06, mt.rimGold, s * 0.17, fz, 0.62, 0.84, 1.2);
        tube(0.045, 0.045, mt.chrome, s * 0.17, 0.84, 1.2, 0.56, 1.72);
        tube(0.03, 0.03, frame, s * 0.12, -0.25, 1.15, -0.95, 1.3);
        add(box(0.04, 0.3, 0.45), body, s * 0.22, 1.28, 0.32, -0.25);
        if (num) add(box(0.03, 0.24, 0.4), num, s * 0.17, 1.17, -0.6);
        add(box(0.04, 0.08, 0.16), mt.dark, s * 0.5, 1.82, 0.56, 0, 0, s * 0.3);
      });
      swingarm(frame, 0.06, 0.1);
      P.bars(k, 1.82, 0.52, 0.9);
      add(box(0.24, 0.04, 0.6), body, 0, 1.36, 1.08, 0.5);
      add(box(0.36, 0.28, 0.03), num ?? mt.white, 0, 1.6, 0.72, -0.35);
      add(box(0.18, 0.04, 0.03), mt.lampMat, 0, 1.5, 0.76, -0.35);
      tube(0.035, 0.035, frame, 0, 0.5, 1.55, -0.25, 1.15);
      tube(0.035, 0.035, frame, 0, 0.5, 1.5, 0.15, 0.45);
      add(box(0.3, 0.38, 0.4), mt.engineMat, 0, 0.72, 0.02);
      add(box(0.26, 0.24, 0.24), mt.engineMat, 0, 0.98, 0.1, 0.2);
      add(box(0.36, 0.22, 0.42), body, 0, 1.4, 0.2, -0.1);
      add(box(0.3, 0.08, 1.05), mt.dark, 0, 1.36, -0.45, -0.03);
      add(box(0.24, 0.04, 0.7), body, 0, 1.34, -1.2, 0.18);
      add(box(0.1, 0.04, 0.03), k.brakeMat, 0, 1.42, -1.53);
      tube(0.045, 0.045, mt.spring, 0, -0.45, 0.72, -0.15, 1.2);
      tube(0.04, 0.04, mt.chrome, 0.2, 0.3, 0.95, -0.25, 0.92);
      tube(0.075, 0.065, mt.carbon, 0.21, -0.25, 0.95, -0.9, 1.25, 8);
      return P.bikeDone(k, rig, [0.21, 1.27, -1.35, 0.08], [1.5, 0.78]);
    }
    case 'adv': { // adventure tourer: beak, twin lamps, tall screen, boxer cylinders, crash bars, panniers, top box
      forks(mt.rimGold, 0.8, 1.55, 0.055);
      swingarm(mt.dark, 0.09, 0.12);
      const alu = mt.rimGrey;
      sym((s) => {
        add(cyl(0.1, 0.12, 0.42, 8), mt.engineMat, s * 0.32, 0.72, 0.28, 0, 0, PI / 2);
        add(box(0.12, 0.18, 0.22), mt.engineMat, s * 0.55, 0.72, 0.28);
        tube(0.025, 0.025, mt.dark, s * 0.45, 0.55, 1.15, 0.5, 0.5);
        tube(0.025, 0.025, mt.dark, s * 0.45, 0.55, 1.15, -0.05, 1.05);
        add(box(0.24, 0.42, 0.58), alu, s * 0.44, 1.0, -0.88);
        add(box(0.25, 0.04, 0.6), mt.dark, s * 0.44, 1.22, -0.88);
        add(box(0.1, 0.06, 0.12), mt.lampMat, s * 0.08, 1.48, 1.02);
        add(box(0.06, 0.08, 0.16), mt.dark, s * 0.46, 1.68, 0.58, 0, 0, s * 0.3);
        beam(0.05, 0.05, mt.dark, s * 0.18, 0.75, 1.5, -0.3, 0.9);
      });
      add(box(0.44, 0.34, 0.5), mt.engineMat, 0, 0.75, 0.15);
      add(box(0.5, 0.3, 0.6), body, 0, 1.38, 0.3, -0.12);
      add(box(0.42, 0.3, 0.3), body, 0, 1.45, 0.82, -0.3);
      add(box(0.3, 0.04, 0.55), body, 0, 1.04, 1.08, 0.55);
      add(box(0.4, 0.5, 0.02), mt.winMat, 0, 1.8, 0.86, -0.35);
      add(box(0.4, 0.1, 0.6), mt.dark, 0, 1.36, -0.32);
      add(box(0.36, 0.1, 0.4), mt.dark, 0, 1.42, -0.72);
      add(box(0.3, 0.06, 0.55), body, 0, 1.36, -1.05, 0.1);
      add(box(0.42, 0.3, 0.38), alu, 0, 1.6, -1.12);
      add(box(0.2, 0.04, 0.03), k.brakeMat, 0, 1.33, -1.33);
      add(box(0.36, 0.04, 0.5), alu, 0, 0.42, 0.2, 0.1);
      P.bars(k, 1.68, 0.62, 0.86);
      tube(0.04, 0.04, mt.chrome, 0.25, 0.4, 0.55, -0.4, 0.68);
      add(cyl(0.08, 0.07, 0.45, 8), mt.carbon, 0.27, 0.88, -0.7, -1.1);
      return P.bikeDone(k, rig, [0.27, 0.98, -1.3, 0.08], [1.48, 1.05]);
    }
    case 'electric': { // electric superbike: battery case, motor at the pivot, single-sided arm, LED slit, glow strips
      const g = glow();
      beam(0.1, 0.12, mt.carbon, 0.2, -0.3, 0.78, rz, 0.62);
      forks(mt.rimGold, 0.82, 1.5, 0.05);
      add(box(0.46, 0.5, 0.95), mt.carbon, 0, 0.82, 0.05, -0.08);
      add(cyl(0.2, 0.2, 0.36, 12), mt.engineMat, 0, 0.7, -0.38, 0, 0, PI / 2);
      sym((s) => {
        add(box(0.03, 0.42, 0.85), body, s * 0.245, 0.9, 0.1, -0.12);
        add(box(0.012, 0.03, 0.8), g, s * 0.262, 0.78, 0.1, -0.12);
        add(cyl(0.025, 0.025, 0.3), mt.chrome, s * 0.24, 1.5, 0.66, 0, 0, s * (PI / 2 - 0.2));
      });
      add(box(0.42, 0.28, 0.55), body, 0, 1.32, 0.3, -0.15);
      add(box(0.46, 0.3, 0.42), body, 0, 1.36, 0.78, 0.35);
      add(cone(0.28, 0.5, 4), body, 0, 1.33, 1.08, PI / 2).scale.set(1, 1, 0.5);
      add(box(0.36, 0.025, 0.04), mt.lampMat, 0, 1.36, 1.3);
      add(box(0.34, 0.02, 0.34), mt.winMat, 0, 1.6, 0.68, 0.6);
      add(box(0.3, 0.07, 0.38), mt.dark, 0, 1.3, -0.35);
      add(box(0.26, 0.18, 0.6), body, 0, 1.45, -0.82, 0.3);
      add(box(0.2, 0.025, 0.04), k.brakeMat, 0, 1.43, -1.14, 0.3);
      add(box(0.012, 0.025, 0.5), g, 0, 1.55, -0.8, 0.3);
      return P.bikeDone(k, rig, [0, 0.95, -1.5, 0.08], [1.36, 1.32]);
    }
  }
}

// ---------------------------------------------------------------- registry
export const SPEC_BUILDERS: Partial<Record<string, Builder>> = Object.fromEntries(
  Object.entries(LOOKS).map(([id, look]): [string, Builder] => [
    id,
    look.kind === 'car' ? (c) => specCar(id, look, c) : look.kind === 'formula' ? (c) => specFormula(id, look, c) : (c) => specBike(look, c),
  ]),
);
