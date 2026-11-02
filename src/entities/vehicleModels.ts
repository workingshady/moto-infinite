// Garage vehicle models: 5 bikes + 10 cars, low-poly and flat-shaded like the rest of the game.
// Convention: forward = +z, ground contact at y = 0, wheels spin about local X.
import * as THREE from 'three';
import { Basic, M, canvasTex, mesh } from './assets';
import { PI, TAU } from '../utils/math';
import type { VehicleKind, VehicleModelId } from '../data/vehicles';

export interface VehicleModel {
  kind: VehicleKind;
  root: THREE.Group;
  wheels: THREE.Group[];
  steer: THREE.Group[];
  rearWheels: THREE.Group[];
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  seat: THREE.Group;
  headlight: THREE.SpotLight;
  brakeMat: THREE.MeshStandardMaterial;
  driver: THREE.Group | null;
  wheelRadius: number;
}

// ---- shared geometry (memoised so several vehicles on screen share buffers) ----
const geos = new Map<string, THREE.BufferGeometry>();
function memo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g;
}
const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const box = (w: number, h: number, d: number) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 8) => memo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r: number, ws = 10, hs = 8) => memo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const tor = (R: number, t: number, rs = 6, ts = 20, arc = TAU) => memo(`t${R},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(R, t, rs, ts, arc));
const cone = (r: number, h: number, seg = 8) => memo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
/** Side profile [z, y][] extruded across the vehicle (x), centred. */
const prism = (key: string, pts: number[][], w: number) =>
  memo(`p${key}`, () =>
    new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => V2(z, y))), { depth: w, bevelEnabled: false })
      .rotateY(-PI / 2)
      .translate(w / 2, 0, 0),
  );
/** Knobby off-road tyre: torus with every other tread segment pushed out. */
const knobTyre = (R: number, t: number) =>
  memo(`n${R},${t}`, () => {
    const g = new THREE.TorusGeometry(R, t, 6, 28), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y);
      if (d > R && Math.round((Math.atan2(y, x) / TAU) * 28) % 2 === 0) p.setXY(i, (x * (d + 0.05)) / d, (y * (d + 0.05)) / d);
    }
    g.computeVertexNormals();
    return g;
  });
/** Single-mesh spoke star lying in the YZ plane (car rims). */
const star = (r: number, n: number) =>
  memo(`st${r},${n}`, () => {
    const ro = r * 0.6, ri = r * 0.17, d = 0.035 / ro, pts: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n, m = a + PI / n;
      pts.push(V2(Math.cos(a - d) * ro, Math.sin(a - d) * ro), V2(Math.cos(a + d) * ro, Math.sin(a + d) * ro), V2(Math.cos(m) * ri, Math.sin(m) * ri));
    }
    return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.03, bevelEnabled: false }).rotateY(PI / 2).translate(-0.015, 0, 0);
  });

// ---- shared materials ----
const tyre = M(0x1a1a1a, { roughness: 0.95 }), chrome = M(0xcfd6de, { roughness: 0.2, metalness: 0.8 });
const carbon = M(0x2a2d33, { roughness: 0.5, metalness: 0.4 }), dark = M(0x18191c), white = M(0xf4f4f4);
const engineMat = M(0x5a5f66, { roughness: 0.4, metalness: 0.6 }), leather = M(0x4a3020, { roughness: 0.8 });
const visor = M(0x10131a, { roughness: 0.1, metalness: 0.9 }), suit = M(0x26282e, { roughness: 0.7 });
const lampMat = M(0xfff6c0, { emissive: 0xfff2a0, emissiveIntensity: 1 });
const winMat = new THREE.MeshStandardMaterial({ color: 0x1c2733, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.6 });
const rimGold = M(0xc9a64b, { roughness: 0.3, metalness: 0.7 }), rimGrey = M(0x9aa0a8, { roughness: 0.3, metalness: 0.7 });
const rimDark = M(0x34373d, { roughness: 0.35, metalness: 0.6 }), redNut = M(0xe0302a, { roughness: 0.4 });
const spring = M(0xf0c020, { roughness: 0.5 }), cage = M(0x3a3d42, { roughness: 0.5, metalness: 0.5 });
const wireMat = new THREE.MeshStandardMaterial({
  roughness: 0.3,
  metalness: 0.7,
  map: canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#e8edf2'; g.lineWidth = 2;
    for (let i = 0; i < 32; i++) {
      const a = (i * TAU) / 32;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); g.lineTo(64 + Math.cos(a + 0.5) * 62, 64 + Math.sin(a + 0.5) * 62); g.stroke();
    }
  }),
});
const nums = new Map<string, THREE.MeshStandardMaterial>();
function numMat(n: string) {
  let m = nums.get(n);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      map: canvasTex(64, 64, (g, w, h) => {
        g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#111'; g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(n, w / 2, h / 2 + 2, w - 6);
      }),
    });
    nums.set(n, m);
  }
  return m;
}
/** White livery on dark paint, dark livery on light paint. */
const contrast = (c: number) => {
  const k = new THREE.Color(c);
  return k.r * 0.3 + k.g * 0.59 + k.b * 0.11 > 0.6 ? dark : white;
};

// ---- builder kit ----
function kit(color: number) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = M(color, { roughness: 0.3, metalness: 0.35 });
  const accent = M(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex(), { roughness: 0.3, metalness: 0.6 });
  const brakeMat = M(0xff2030, { emissive: 0xff1020, emissiveIntensity: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const o = mesh(geo, m, x, y, z);
    o.rotation.set(rx, ry, rz);
    root.add(o);
    return o;
  };
  /** Cylinder from (z1,y1) radius r1 to (z2,y2) radius r2, at lateral x. */
  const tube = (r1: number, r2: number, m: THREE.Material, x: number, z1: number, y1: number, z2: number, y2: number, seg = 6) =>
    add(cyl(r2, r1, Math.hypot(z2 - z1, y2 - y1), seg), m, x, (y1 + y2) / 2, (z1 + z2) / 2, Math.atan2(z2 - z1, y2 - y1));
  /** Box beam (w wide, h thick) from (z1,y1) to (z2,y2), at lateral x. */
  const beam = (w: number, h: number, m: THREE.Material, x: number, z1: number, y1: number, z2: number, y2: number) =>
    add(box(w, h, Math.hypot(z2 - z1, y2 - y1)), m, x, (y1 + y2) / 2, (z1 + z2) / 2, Math.atan2(-(y2 - y1), z2 - z1));
  return { root, body, accent, brakeMat, add, tube, beam, con: contrast(color) };
}
type Kit = ReturnType<typeof kit>;
const sym = (f: (s: number) => void) => {
  f(-1);
  f(1);
};

interface Rig { wheels: THREE.Group[]; steer: THREE.Group[]; rearWheels: THREE.Group[]; wheelRadius: number }

function finish(
  k: Kit, kind: VehicleKind, rig: Rig, fl: [number, number, number, number], light: [number, number],
  seatAt: [number, number, number], driver: THREE.Group | null, twin?: [number, number],
): VehicleModel {
  const flameMat = Basic(0x66ccff, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(cone(fl[3], 1), flameMat);
  flame.rotation.x = -PI / 2;
  flame.position.set(fl[0], fl[1], fl[2]);
  flame.scale.set(1, 0.01, 1);
  if (twin) {
    // second exhaust: child so it follows the game's y-scaling; local z = world up here
    const f2 = new THREE.Mesh(flame.geometry, flameMat);
    f2.position.set(twin[0], 0, twin[1]);
    flame.add(f2);
  }
  k.root.add(flame);
  const headlight = new THREE.SpotLight(0xfff2cc, 0, 55, 0.55, 0.5, 1.2);
  headlight.position.set(0, light[0], light[1]);
  headlight.target.position.set(0, light[0] - 3, light[1] + 13);
  k.root.add(headlight, headlight.target);
  const seat = new THREE.Group();
  seat.position.set(...seatAt);
  if (driver) seat.add(driver);
  k.root.add(seat);
  return { kind, root: k.root, ...rig, flame, flameMat, seat, headlight, brakeMat: k.brakeMat, driver };
}

// ---- bikes ----
type BikeRim = 'cast' | 'wire' | 'knobby';
function bikeWheel(rimMat: THREE.Material, style: BikeRim, tube = 0.15, disc = 0.24) {
  const g = new THREE.Group(), R = 0.62 - tube, rr = R - tube + 0.03;
  const t = mesh(style === 'knobby' ? knobTyre(0.6 - tube, tube) : tor(R, tube, 8, 22), tyre);
  t.rotation.y = PI / 2;
  const rim = mesh(tor(rr, 0.03, 4, 22), style === 'cast' ? rimMat : chrome);
  rim.rotation.y = PI / 2;
  const hub = mesh(cyl(0.09, 0.09, 0.24), chrome);
  hub.rotation.z = PI / 2;
  g.add(t, rim, hub);
  if (disc) {
    const d = mesh(cyl(disc, disc, 0.03, 16), chrome, 0.1, 0, 0);
    d.rotation.z = PI / 2;
    g.add(d);
  }
  const n = style === 'cast' ? 5 : 10;
  for (let i = 0; i < n; i++) {
    const s = mesh(style === 'cast' ? box(0.05, rr, 0.07) : cyl(0.008, 0.008, rr, 3), style === 'cast' ? rimMat : chrome, style === 'cast' ? 0 : i % 2 ? 0.05 : -0.05);
    s.rotation.x = (i * TAU) / n + (style === 'cast' ? 0 : 0.2);
    s.translateY(rr / 2);
    g.add(s);
  }
  return g;
}
function bikeRig(k: Kit, front: THREE.Group, rear: THREE.Group, fz = 1.08, rz = -1.05): Rig {
  front.position.set(0, 0.62, fz);
  rear.position.set(0, 0.62, rz);
  k.root.add(front, rear);
  return { wheels: [front, rear], steer: [], rearWheels: [rear], wheelRadius: 0.62 };
}
const bikeDone = (k: Kit, rig: Rig, fl: [number, number, number, number], light: [number, number], twin?: [number, number]) =>
  finish(k, 'bike', rig, fl, light, [0, 0.3, -0.35], null, twin);
function bars(k: Kit, y: number, z: number, w: number) {
  k.add(cyl(0.03, 0.03, w), chrome, 0, y, z, 0, 0, PI / 2);
  sym((s) => k.add(box(0.14, 0.07, 0.07), dark, s * (w / 2 + 0.02), y, z));
}

/** Naked sportbike: trellis frame, exposed engine, round lamp, short tail, belly exhaust. */
function street(color: number) {
  const k = kit(color), { add, body, accent, tube, beam } = k;
  const rig = bikeRig(k, bikeWheel(accent, 'cast', 0.15, 0.27), bikeWheel(accent, 'cast', 0.18, 0.22));
  sym((s) => {
    beam(0.07, 0.07, accent, s * 0.2, 0.8, 1.35, -0.35, 0.85);
    beam(0.07, 0.07, accent, s * 0.22, 0.75, 1.28, 0.2, 0.55);
    beam(0.06, 0.06, accent, s * 0.21, 0.1, 1.2, -0.3, 0.6);
    beam(0.08, 0.11, carbon, s * 0.22, -0.35, 0.78, -1.05, 0.62);
    tube(0.05, 0.05, chrome, s * 0.18, 1.08, 0.62, 0.8, 1.55);
    add(box(0.05, 0.24, 0.42), body, s * 0.27, 1.18, 0.42, -0.2);
    tube(0.012, 0.012, chrome, s * 0.3, 0.72, 1.62, 0.7, 1.82);
    add(box(0.14, 0.08, 0.03), dark, s * 0.32, 1.84, 0.7);
  });
  add(box(0.46, 0.42, 0.55), engineMat, 0, 0.72, 0.1);
  add(box(0.42, 0.3, 0.3), engineMat, 0, 1.0, 0.3, 0.4);
  for (let i = 0; i < 3; i++) add(box(0.5, 0.03, 0.34), carbon, 0, 0.92 + i * 0.08, 0.3 + i * 0.03, 0.4);
  add(box(0.5, 0.4, 0.06), dark, 0, 0.98, 0.62, -0.2);
  add(box(0.48, 0.3, 0.6), body, 0, 1.3, 0.28, -0.12);
  add(sph(0.3), body, 0, 1.42, 0.3).scale.set(0.85, 0.45, 1.05);
  add(box(0.36, 0.1, 0.6), dark, 0, 1.27, -0.38);
  add(box(0.3, 0.14, 0.45), body, 0, 1.36, -0.85, 0.25);
  add(box(0.18, 0.05, 0.04), k.brakeMat, 0, 1.43, -1.08, 0.25);
  beam(0.04, 0.04, carbon, 0, -0.95, 1.3, -1.25, 1.05);
  add(box(0.24, 0.16, 0.02), white, 0, 1.0, -1.27, 0.3);
  add(cyl(0.17, 0.13, 0.16, 12), dark, 0, 1.42, 1.0, PI / 2);
  add(cyl(0.15, 0.15, 0.02, 12), lampMat, 0, 1.42, 1.09, PI / 2);
  add(box(0.22, 0.04, 0.55), body, 0, 1.3, 1.12, 0.15);
  bars(k, 1.62, 0.72, 0.8);
  tube(0.04, 0.04, chrome, 0, 0.45, 0.7, 0.1, 0.38);
  add(box(0.34, 0.16, 0.5), carbon, 0, 0.36, -0.08);
  add(cyl(0.06, 0.07, 0.3, 8), carbon, 0.24, 0.38, -0.35, PI / 2);
  return bikeDone(k, rig, [0.25, 0.38, -0.95, 0.09], [1.42, 1.12]);
}

/** Full-fairing superbike: diamond nose, twin lamps, high tail, under-tail exhaust, number plates. */
function superbike(color: number) {
  const k = kit(color), { add, body, accent, tube, beam } = k;
  const rig = bikeRig(k, bikeWheel(accent, 'cast', 0.15, 0.27), bikeWheel(accent, 'cast', 0.18, 0.22));
  sym((s) => {
    beam(0.08, 0.11, carbon, s * 0.22, -0.3, 0.8, -1.05, 0.62);
    tube(0.05, 0.05, rimGold, s * 0.18, 1.08, 0.62, 0.82, 1.5);
    add(box(0.12, 0.05, 0.18), lampMat, s * 0.09, 1.47, 1.12, 0, s * 0.45);
    for (let i = 0; i < 3; i++) add(box(0.02, 0.04, 0.32), dark, s * 0.285, 0.9 + i * 0.09, 0.15, -0.35);
    add(box(0.02, 0.2, 0.3), numMat('27'), s * 0.16, 1.52, -0.85, 0.3);
    add(cyl(0.025, 0.025, 0.3), chrome, s * 0.24, 1.55, 0.7, 0, 0, s * (PI / 2 - 0.2));
    add(box(0.14, 0.06, 0.06), dark, s * 0.42, 1.52, 0.7);
    add(box(0.14, 0.06, 0.05), body, s * 0.33, 1.62, 0.8);
  });
  add(box(0.56, 0.62, 0.7), body, 0, 1.0, 0.1, -0.1);
  add(box(0.5, 0.34, 0.5), body, 0, 1.48, 0.75, 0.35);
  add(cone(0.3, 0.5, 4), body, 0, 1.45, 1.1, PI / 2).scale.set(1, 1, 0.6);
  add(box(0.38, 0.02, 0.36), winMat, 0, 1.7, 0.66, 0.6);
  add(box(0.4, 0.2, 0.8), body, 0, 0.55, 0.05, -0.05);
  add(box(0.46, 0.3, 0.5), body, 0, 1.4, 0.2, -0.15);
  add(box(0.32, 0.07, 0.38), dark, 0, 1.3, -0.35);
  add(box(0.3, 0.2, 0.7), body, 0, 1.52, -0.85, 0.3);
  add(cone(0.12, 0.25, 4), body, 0, 1.62, -1.3, -PI / 2);
  add(box(0.2, 0.03, 0.05), k.brakeMat, 0, 1.5, -1.22, 0.3);
  tube(0.04, 0.04, chrome, 0.12, 0.0, 0.55, -0.7, 1.28);
  tube(0.07, 0.08, carbon, 0, -0.7, 1.28, -1.25, 1.36, 10);
  return bikeDone(k, rig, [0, 1.37, -1.75, 0.11], [1.46, 1.3]);
}

/** Motocross: long-travel forks, knobbies, high fender, number boards, upswept pipe. */
function dirt(color: number) {
  const k = kit(color), { add, body, tube, beam } = k, num = numMat('7');
  const rig = bikeRig(k, bikeWheel(chrome, 'knobby', 0.13, 0.2), bikeWheel(chrome, 'knobby', 0.15, 0.18));
  const frame = M(0x8a9099, { roughness: 0.4, metalness: 0.6 });
  sym((s) => {
    tube(0.065, 0.065, rimGold, s * 0.17, 1.08, 0.62, 0.826, 1.12);
    tube(0.045, 0.045, chrome, s * 0.17, 0.826, 1.12, 0.52, 1.72);
    tube(0.03, 0.03, frame, s * 0.12, -0.25, 1.15, -0.95, 1.3);
    beam(0.06, 0.1, frame, s * 0.17, -0.2, 0.75, -1.05, 0.62);
    add(box(0.04, 0.32, 0.45), body, s * 0.22, 1.28, 0.32, -0.25);
    add(box(0.03, 0.26, 0.42), num, s * 0.17, 1.17, -0.6);
  });
  add(box(0.42, 0.06, 0.14), dark, 0, 1.6, 0.6);
  add(box(0.42, 0.06, 0.14), dark, 0, 1.74, 0.54);
  bars(k, 1.84, 0.5, 0.95);
  add(box(0.22, 0.04, 0.85), body, 0, 1.4, 0.95, 0.12);
  add(box(0.38, 0.3, 0.03), num, 0, 1.62, 0.7, -0.35);
  add(box(0.14, 0.07, 0.03), lampMat, 0, 1.47, 0.74, -0.35);
  tube(0.035, 0.035, frame, 0, 0.5, 1.55, -0.25, 1.15);
  tube(0.035, 0.035, frame, 0, 0.5, 1.5, 0.15, 0.45);
  add(box(0.3, 0.36, 0.38), engineMat, 0, 0.72, 0.02);
  add(box(0.28, 0.24, 0.24), engineMat, 0, 0.98, 0.1, 0.2);
  add(box(0.34, 0.04, 0.5), chrome, 0, 0.5, 0.05);
  add(box(0.38, 0.24, 0.42), body, 0, 1.4, 0.2, -0.1);
  add(box(0.3, 0.08, 1.05), dark, 0, 1.36, -0.45, -0.03);
  add(box(0.24, 0.04, 0.7), body, 0, 1.34, -1.2, 0.18);
  add(box(0.1, 0.04, 0.03), k.brakeMat, 0, 1.42, -1.53);
  tube(0.045, 0.045, spring, 0, -0.45, 0.72, -0.15, 1.2);
  tube(0.04, 0.04, chrome, 0.2, 0.3, 0.95, -0.25, 0.92);
  tube(0.075, 0.065, engineMat, 0.21, -0.25, 0.95, -1.0, 1.22, 8);
  return bikeDone(k, rig, [0.21, 1.24, -1.45, 0.08], [1.47, 0.78]);
}

/** 1970s café racer: round tank, humped seat, clip-ons, wire wheels, twin megaphones. */
function cafe(color: number) {
  const k = kit(color), { add, body, tube, beam } = k;
  const rig = bikeRig(k, bikeWheel(chrome, 'wire', 0.13, 0.2), bikeWheel(chrome, 'wire', 0.15, 0));
  sym((s) => {
    tube(0.05, 0.05, chrome, s * 0.17, 1.08, 0.62, 0.84, 1.5);
    tube(0.07, 0.07, dark, s * 0.17, 0.99, 0.95, 0.92, 1.2);
    tube(0.04, 0.04, dark, s * 0.12, 0.82, 1.38, 0.38, 0.48);
    beam(0.06, 0.08, dark, s * 0.2, -0.35, 0.72, -1.05, 0.62);
    tube(0.04, 0.04, chrome, s * 0.21, -1.0, 0.68, -0.72, 1.24);
    tube(0.04, 0.04, chrome, s * 0.24, 0.38, 0.95, -0.05, 0.5);
    tube(0.05, 0.12, chrome, s * 0.3, -0.05, 0.5, -1.0, 0.7, 10);
    add(cyl(0.1, 0.1, 0.36, 8), engineMat, s * 0.11, 0.92, 0.12, 0.15);
    add(box(0.02, 0.08, 0.16), chrome, s * 0.27, 1.36, 0.4);
    add(box(0.02, 0.14, 0.14), numMat('5'), s * 0.172, 1.38, -0.78);
    add(cyl(0.022, 0.022, 0.3), chrome, s * 0.26, 1.5, 0.8, 0, 0, s * (PI / 2 - 0.15));
    add(box(0.12, 0.06, 0.06), dark, s * 0.43, 1.48, 0.8);
    add(cyl(0.06, 0.06, 0.06, 10), dark, s * 0.08, 1.62, 0.86, -0.4);
  });
  tube(0.05, 0.05, dark, 0, 0.82, 1.42, -0.9, 1.2);
  add(box(0.5, 0.3, 0.5), chrome, 0, 0.62, 0.05);
  for (let i = 0; i < 3; i++) add(box(0.46, 0.03, 0.24), engineMat, 0, 0.84 + i * 0.09, 0.12 + i * 0.014, 0.15);
  add(box(0.44, 0.1, 0.26), chrome, 0, 1.13, 0.15, 0.15);
  add(sph(0.36, 12, 8), body, 0, 1.35, 0.36).scale.set(0.78, 0.58, 1.3);
  add(cyl(0.05, 0.05, 0.04, 8), chrome, 0, 1.56, 0.45);
  add(box(0.34, 0.08, 0.55), dark, 0, 1.27, -0.36);
  add(box(0.34, 0.24, 0.28), body, 0, 1.38, -0.76);
  add(sph(0.17, 10, 6), body, 0, 1.38, -0.9).scale.set(1, 0.7, 0.9);
  add(cyl(0.06, 0.06, 0.03, 10), k.brakeMat, 0, 1.36, -1.06, PI / 2);
  add(sph(0.16), chrome, 0, 1.42, 0.98).scale.set(1, 1, 0.8);
  add(cyl(0.14, 0.14, 0.02, 12), lampMat, 0, 1.42, 1.1, PI / 2);
  add(box(0.2, 0.03, 0.6), chrome, 0, 1.28, 1.1, 0.1);
  add(box(0.2, 0.03, 0.4), chrome, 0, 1.3, -1.15, 0.3);
  return bikeDone(k, rig, [0.3, 0.72, -1.45, 0.1], [1.42, 1.12], [-0.6, 0]);
}

/** Long, low V-twin cruiser: raked forks, wide bars, fat rear tyre, saddlebags, twin pipes. */
function cruiser(color: number) {
  const k = kit(color), { add, body, tube, beam } = k;
  const rig = bikeRig(k, bikeWheel(chrome, 'wire', 0.11, 0.26), bikeWheel(chrome, 'cast', 0.21, 0.22), 1.3, -1.05);
  sym((s) => {
    tube(0.055, 0.055, chrome, s * 0.15, 1.3, 0.62, 0.66, 1.8);
    add(sph(0.07, 8, 6), lampMat, s * 0.26, 1.3, 1.05);
    tube(0.025, 0.025, chrome, s * 0.12, 0.66, 1.8, 0.62, 1.92);
    tube(0.025, 0.025, chrome, s * 0.5, 0.62, 1.92, 0.38, 1.88);
    add(box(0.07, 0.07, 0.16), dark, s * 0.5, 1.88, 0.3);
    add(box(0.22, 0.36, 0.6), leather, s * 0.42, 1.0, -0.95);
    add(box(0.24, 0.06, 0.62), body, s * 0.42, 1.2, -0.95);
    add(box(0.02, 0.1, 0.05), chrome, s * 0.535, 1.1, -0.95);
    beam(0.07, 0.09, dark, s * 0.26, -0.3, 0.7, -1.05, 0.62);
    tube(0.04, 0.04, chrome, s * 0.27, -0.95, 0.66, -0.65, 1.18);
    add(box(0.2, 0.04, 0.38), dark, s * 0.36, 0.48, 0.42);
  });
  add(sph(0.19), chrome, 0, 1.48, 0.98).scale.set(1, 1, 0.8);
  add(cyl(0.16, 0.16, 0.02, 12), lampMat, 0, 1.48, 1.12, PI / 2);
  add(cyl(0.02, 0.02, 0.5), chrome, 0, 1.3, 0.98, 0, 0, PI / 2);
  add(cyl(0.025, 0.025, 1.0), chrome, 0, 1.92, 0.62, 0, 0, PI / 2);
  tube(0.05, 0.05, dark, 0, 0.7, 1.6, -0.45, 1.08);
  tube(0.05, 0.05, dark, 0, 0.68, 1.5, 0.42, 0.45);
  add(box(0.34, 0.3, 0.55), chrome, 0, 0.58, 0.05);
  for (const [z, a] of [[0.3, 0.42], [-0.18, -0.42]]) {
    const c = Math.cos(a), sn = Math.sin(a), y = 0.9;
    add(cyl(0.13, 0.13, 0.42, 10), chrome, 0, y, z, a);
    for (const t of [-0.08, 0.06]) add(cyl(0.17, 0.17, 0.03, 10), carbon, 0, y + c * t, z + sn * t, a);
    add(box(0.22, 0.1, 0.24), chrome, 0, y + c * 0.25, z + sn * 0.25, a);
  }
  add(cyl(0.17, 0.17, 0.06, 12), chrome, 0.22, 0.9, 0.06, 0, 0, PI / 2);
  add(sph(0.34, 12, 8), body, 0, 1.36, 0.32).scale.set(0.85, 0.55, 1.35);
  add(box(0.08, 0.02, 0.4), chrome, 0, 1.55, 0.3);
  add(box(0.44, 0.1, 0.55), leather, 0, 1.2, -0.35);
  add(box(0.34, 0.1, 0.35), leather, 0, 1.32, -0.82);
  add(box(0.44, 0.06, 0.75), body, 0, 1.32, -1.1, -0.25);
  add(box(0.16, 0.06, 0.04), k.brakeMat, 0, 1.24, -1.5, -0.25);
  add(box(0.26, 0.05, 0.7), body, 0, 1.29, 1.32, 0.05);
  for (const y of [0.42, 0.56]) add(cyl(0.055, 0.055, 1.6, 8), chrome, 0.3, y, -0.45, PI / 2);
  tube(0.05, 0.05, chrome, 0.24, 0.42, 0.85, 0.3, 0.56);
  tube(0.05, 0.05, chrome, 0.24, -0.25, 0.85, -0.05, 0.44);
  return bikeDone(k, rig, [0.3, 0.42, -1.75, 0.08], [1.48, 1.15], [0, 0.14]);
}

// ---- cars ----
type CarRim = 'dish' | 'spoke' | 'five' | 'lock' | 'bbs' | 'mag' | 'gravel' | 'beadlock' | 'wire';
const RIMS: Record<CarRim, { disc: THREE.Material; spoke?: THREE.Material; n?: number; cap: THREE.Material; lip?: boolean }> = {
  dish: { disc: chrome, cap: dark, lip: true },
  spoke: { disc: rimDark, spoke: rimGrey, n: 10, cap: rimGrey },
  five: { disc: carbon, spoke: rimGrey, n: 5, cap: rimGrey },
  lock: { disc: carbon, spoke: rimDark, n: 6, cap: redNut },
  bbs: { disc: dark, spoke: rimGold, n: 10, cap: rimGold, lip: true },
  mag: { disc: chrome, spoke: dark, n: 5, cap: chrome },
  gravel: { disc: white, cap: dark },
  beadlock: { disc: rimDark, spoke: rimGrey, n: 6, cap: chrome, lip: true },
  wire: { disc: wireMat, cap: chrome, lip: true },
};
function carWheel(r: number, w: number, style: CarRim, side: number) {
  const g = new THREE.Group(), o = RIMS[style], fx = side * (w / 2 + 0.01);
  const t = mesh(cyl(r, r, w, 14), tyre);
  t.rotation.z = PI / 2;
  const d = mesh(cyl(r * 0.66, r * 0.66, w + 0.012, 14), o.disc);
  d.rotation.z = PI / 2;
  const cap = mesh(cyl(r * 0.16, r * 0.16, 0.04, 8), o.cap, fx, 0, 0);
  cap.rotation.z = PI / 2;
  g.add(t, d, cap);
  if (o.lip) {
    const l = mesh(tor(r * 0.63, 0.022, 4, 16), chrome, fx, 0, 0);
    l.rotation.y = PI / 2;
    g.add(l);
  }
  if (o.spoke && o.n) g.add(mesh(star(r, o.n), o.spoke, fx, 0, 0));
  return g;
}
function carRig(k: Kit, r: number, style: CarRim, wf = 0.24, wr = wf, track = 0.78): Rig {
  const wheels: THREE.Group[] = [], steer: THREE.Group[] = [], rearWheels: THREE.Group[] = [];
  sym((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * track, r, 1.35);
    const f = carWheel(r, wf, style, s);
    pivot.add(f);
    const b = carWheel(r, wr, style, s);
    b.position.set(s * track, r, -1.3);
    k.root.add(pivot, b);
    wheels.push(f, b);
    steer.push(pivot);
    rearWheels.push(b);
  });
  return { wheels, steer, rearWheels, wheelRadius: r };
}
/** Seated driver (hips at group origin): suit, helmet in body colour with visor, arms to the wheel. */
function buildDriver(helmet: THREE.Material) {
  const g = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const o = mesh(geo, m, x, y, z);
    o.rotation.x = rx;
    g.add(o);
  };
  put(box(0.42, 0.5, 0.26), suit, 0, 0.3, -0.06, -0.15);
  put(box(0.14, 0.1, 0.14), suit, 0, 0.58, -0.08);
  put(sph(0.16), helmet, 0, 0.72, -0.08);
  put(memo('visor', () => new THREE.SphereGeometry(0.165, 10, 6, PI / 2 - 0.9, 1.8, 1.2, 0.55)), visor, 0, 0.72, -0.08);
  sym((s) => put(box(0.1, 0.1, 0.42), suit, s * 0.17, 0.46, 0.17, 0.2));
  put(box(0.36, 0.14, 0.6), suit, 0, 0.08, 0.32);
  put(tor(0.15, 0.025, 4, 12), dark, 0, 0.44, 0.42, -0.3);
  return g;
}
const carDone = (k: Kit, rig: Rig, fl: [number, number, number, number], light: [number, number], seat: [number, number, number], twin?: [number, number]) =>
  finish(k, 'car', rig, fl, light, seat, buildDriver(k.body), twin);
/** Cabin: glass greenhouse prism + body roof slab. */
function cabin(k: Kit, key: string, pts: number[][], w: number, roofY: number, roofZ: number, roofL: number) {
  k.add(prism(key, pts, w), winMat, 0, 0, 0);
  k.add(box(w + 0.02, 0.05, roofL), k.body, 0, roofY, roofZ);
}
const mirrors = (k: Kit, m: THREE.Material, x: number, y: number, z: number) => sym((s) => k.add(box(0.12, 0.08, 0.14), m, s * x, y, z));

/** 1990s FR drift coupe: long hood, pop-ups, wide flares, duck-tail, dish wheels, cage. */
function driftCoupe(color: number) {
  const k = kit(color), { add, body, beam, tube } = k;
  const rig = carRig(k, 0.33, 'dish', 0.24);
  add(prism('drift', [[2.12, 0.22], [2.18, 0.45], [2.0, 0.62], [0.75, 0.76], [-1.75, 0.8], [-2.1, 0.82], [-2.14, 0.5], [-2.05, 0.22]], 1.66), body, 0, 0, 0);
  cabin(k, 'driftG', [[0.7, 0.75], [-0.2, 1.2], [-0.95, 1.2], [-1.8, 0.81]], 1.36, 1.22, -0.575, 0.78);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.67, 0.7, 0.76, -0.2, 1.2);
    beam(0.1, 0.06, body, s * 0.66, -0.95, 1.2, -1.8, 0.81);
    add(box(0.14, 0.16, 0.9), body, s * 0.86, 0.66, 1.35);
    add(box(0.14, 0.16, 0.95), body, s * 0.87, 0.68, -1.3);
    add(box(0.36, 0.1, 0.24), body, s * 0.55, 0.68, 1.85, -0.2);
    add(box(0.3, 0.07, 0.02), lampMat, s * 0.55, 0.69, 1.975, -0.2);
    add(box(0.48, 0.12, 0.04), k.brakeMat, s * 0.55, 0.7, -2.13);
    tube(0.025, 0.025, white, s * 0.58, -0.85, 0.55, -0.85, 1.15);
  });
  mirrors(k, body, 0.86, 0.9, 0.55);
  add(cyl(0.025, 0.025, 1.16), white, 0, 1.15, -0.85, 0, 0, PI / 2);
  add(cyl(0.02, 0.02, 1.3), white, 0, 0.85, -0.85, 0, 0, -1.09);
  add(box(1.0, 0.12, 0.05), dark, 0, 0.33, 2.16);
  add(box(1.72, 0.04, 0.22), carbon, 0, 0.2, 2.08);
  add(box(1.5, 0.06, 0.28), body, 0, 0.86, -2.02, 0.3);
  add(box(0.58, 0.1, 0.04), dark, 0, 0.7, -2.13);
  add(box(1.4, 0.06, 0.2), carbon, 0, 0.24, -2.04);
  add(cyl(0.065, 0.065, 0.25, 8), chrome, 0.55, 0.3, -2.12, PI / 2);
  return carDone(k, rig, [0.55, 0.3, -2.55, 0.09], [0.62, 2.1], [0.34, 0.3, -0.45]);
}

/** 1980s light hatchback: boxy, panda two-tone, louvred rear glass. */
function hatch(color: number) {
  const k = kit(color), { add, body, beam } = k;
  const rig = carRig(k, 0.32, 'five', 0.22);
  add(box(1.62, 0.34, 3.58), k.con, 0, 0.4, 0.07);
  add(prism('hatchU', [[1.86, 0.56], [1.84, 0.72], [0.9, 0.82], [-1.7, 0.86], [-1.73, 0.56]], 1.63), body, 0, 0, 0);
  cabin(k, 'hatchG', [[0.86, 0.81], [0.2, 1.3], [-1.36, 1.32], [-1.72, 0.86]], 1.42, 1.335, -0.58, 1.56);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.69, 0.86, 0.81, 0.2, 1.3);
    add(box(0.06, 0.48, 0.08), body, s * 0.71, 1.06, -0.4);
    beam(0.12, 0.06, body, s * 0.67, -1.36, 1.32, -1.72, 0.86);
    add(box(0.12, 0.12, 0.8), body, s * 0.84, 0.66, 1.35);
    add(box(0.12, 0.12, 0.8), body, s * 0.84, 0.66, -1.3);
    add(box(0.34, 0.14, 0.04), lampMat, s * 0.55, 0.66, 1.865);
    add(box(0.36, 0.16, 0.04), k.brakeMat, s * 0.6, 0.68, -1.735);
  });
  mirrors(k, dark, 0.8, 0.92, 0.65);
  add(box(0.5, 0.1, 0.04), dark, 0, 0.66, 1.865);
  add(box(1.68, 0.12, 0.14), dark, 0, 0.3, 1.88);
  add(box(1.68, 0.12, 0.14), dark, 0, 0.3, -1.74);
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    add(box(1.3, 0.025, 0.12), dark, 0, 1.32 - 0.46 * t + 0.02, -1.36 - 0.36 * t - 0.025, -0.35);
  }
  add(box(1.3, 0.04, 0.22), body, 0, 1.35, -1.42);
  add(cyl(0.05, 0.05, 0.2, 8), chrome, -0.5, 0.24, -1.8, PI / 2);
  return carDone(k, rig, [-0.5, 0.24, -2.2, 0.07], [0.66, 1.9], [0.34, 0.3, -0.35]);
}

/** Modern GT3 racer: low and wide, swan-neck wing, splitter, diffuser, centre-lock wheels, livery. */
function gt(color: number) {
  const k = kit(color), { add, body, beam, con } = k;
  const rig = carRig(k, 0.36, 'lock', 0.3, 0.32, 0.8);
  add(prism('gt', [[2.2, 0.18], [2.24, 0.38], [1.95, 0.58], [1.0, 0.7], [0.55, 0.73], [-1.5, 0.82], [-2.15, 0.84], [-2.2, 0.56], [-2.1, 0.18]], 1.76), body, 0, 0, 0);
  cabin(k, 'gtG', [[0.6, 0.72], [-0.15, 1.1], [-0.9, 1.1], [-1.6, 0.8]], 1.2, 1.12, -0.525, 0.75);
  sym((s) => {
    beam(0.06, 0.06, body, s * 0.59, 0.6, 0.72, -0.15, 1.1);
    beam(0.14, 0.06, body, s * 0.56, -0.9, 1.1, -1.6, 0.8);
    add(box(0.18, 0.2, 1.0), body, s * 0.9, 0.68, 1.35);
    add(box(0.2, 0.22, 1.05), body, s * 0.92, 0.7, -1.3);
    add(box(0.22, 0.02, 0.14), carbon, s * 0.82, 0.4, 2.12, 0, 0, s * 0.3);
    add(box(0.42, 0.06, 0.22), lampMat, s * 0.6, 0.53, 2.0, 0.3, s * 0.12);
    add(box(0.03, 0.22, 0.5), dark, s * 0.885, 0.5, -0.6);
    add(box(0.08, 0.08, 1.6), carbon, s * 0.86, 0.2, 0);
    add(box(0.03, 0.3, 0.52), body, s * 0.96, 1.25, -1.95);
    beam(0.03, 0.09, carbon, s * 0.35, -1.65, 0.83, -1.9, 1.44);
    add(box(0.03, 0.1, 0.06), carbon, s * 0.35, 1.38, -1.95);
    add(box(0.012, 0.06, 2.6), con, s * 0.885, 0.4, 0.2);
    add(box(0.012, 0.3, 0.3), numMat('33'), s * 0.885, 0.58, 0.05);
    add(cyl(0.06, 0.06, 0.15, 8), engineMat, s * 0.3, 0.42, -2.2, PI / 2);
  });
  mirrors(k, body, 0.75, 0.82, 0.5);
  add(box(1.9, 0.04, 0.38), carbon, 0, 0.15, 2.2);
  add(box(1.1, 0.16, 0.05), dark, 0, 0.3, 2.22);
  add(box(1.9, 0.05, 0.4), carbon, 0, 1.3, -1.95, 0.12);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) add(box(0.03, 0.2, 0.42), carbon, x, 0.26, -2.12);
  add(box(1.6, 0.03, 0.42), carbon, 0, 0.17, -2.12);
  add(box(1.5, 0.05, 0.04), k.brakeMat, 0, 0.74, -2.19);
  add(box(0.36, 0.012, 1.0), con, 0, 0.646, 1.48, 0.126);
  add(box(0.36, 0.012, 0.75), con, 0, 1.15, -0.525);
  add(box(0.36, 0.012, 0.6), con, 0, 0.84, -1.85);
  return carDone(k, rig, [0.3, 0.42, -2.65, 0.08], [0.53, 2.2], [-0.32, 0.2, -0.45], [-0.6, 0]);
}

/** 1970s muscle car: long hood with blower, chrome bumpers, twin stripes, quad lamps, fat rears. */
function muscle(color: number) {
  const k = kit(color), { add, body, beam, con } = k;
  const rig = carRig(k, 0.36, 'mag', 0.24, 0.34);
  add(prism('muscle', [[2.2, 0.28], [2.26, 0.55], [2.22, 0.8], [0.75, 0.83], [-1.6, 0.85], [-2.22, 0.82], [-2.27, 0.5], [-2.17, 0.28]], 1.74), body, 0, 0, 0);
  cabin(k, 'muscleG', [[0.6, 0.82], [-0.15, 1.28], [-1.0, 1.28], [-1.8, 0.85]], 1.4, 1.305, -0.575, 0.85);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.69, 0.6, 0.82, -0.15, 1.28);
    beam(0.14, 0.06, body, s * 0.65, -1.0, 1.28, -1.8, 0.85);
    add(box(0.18, 0.012, 1.4), con, s * 0.36, 0.826, 1.5, 0.02);
    add(box(0.18, 0.012, 0.85), con, s * 0.36, 1.335, -0.575);
    add(box(0.18, 0.012, 0.4), con, s * 0.36, 0.847, -2.0);
    add(box(0.62, 0.12, 0.04), k.brakeMat, s * 0.45, 0.66, -2.26);
    add(box(0.1, 0.12, 0.9), body, s * 0.85, 0.74, 1.35);
    add(box(0.16, 0.22, 1.05), body, s * 0.89, 0.7, -1.3);
    add(box(0.012, 0.03, 3.4), chrome, s * 0.872, 0.55, 0);
    add(cyl(0.065, 0.065, 0.2, 8), chrome, s * 0.6, 0.3, -2.25, PI / 2);
  });
  mirrors(k, chrome, 0.82, 0.92, 0.55);
  add(box(1.5, 0.24, 0.04), dark, 0, 0.64, 2.255);
  for (const x of [-0.62, -0.42, 0.42, 0.62]) add(cyl(0.075, 0.075, 0.04, 10), lampMat, x, 0.66, 2.27, PI / 2);
  add(box(1.84, 0.12, 0.14), chrome, 0, 0.38, 2.28);
  add(box(1.84, 0.12, 0.14), chrome, 0, 0.38, -2.27);
  add(box(0.5, 0.2, 0.5), chrome, 0, 0.93, 1.15);
  add(box(0.56, 0.16, 0.32), dark, 0, 1.1, 1.18);
  add(box(0.44, 0.02, 0.24), chrome, 0, 1.19, 1.18);
  return carDone(k, rig, [0.6, 0.3, -2.7, 0.09], [0.66, 2.3], [-0.35, 0.3, -0.5], [-1.2, 0]);
}

/** 2000s rally car: raised, light pod, roof scoop, mud flaps, big wing, gravel wheels. */
function rally(color: number) {
  const k = kit(color), { add, body, beam, con } = k;
  const rig = carRig(k, 0.36, 'gravel', 0.25);
  add(prism('rally', [[2.0, 0.45], [2.08, 0.7], [1.95, 0.88], [0.85, 0.98], [-1.6, 1.02], [-2.0, 1.0], [-2.05, 0.7], [-1.95, 0.45]], 1.7), body, 0, 0, 0);
  cabin(k, 'rallyG', [[0.82, 0.97], [0.15, 1.34], [-0.95, 1.35], [-1.62, 1.0]], 1.44, 1.37, -0.4, 1.1);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.7, 0.82, 0.97, 0.15, 1.34);
    add(box(0.06, 0.36, 0.08), body, s * 0.72, 1.16, -0.35);
    beam(0.14, 0.06, body, s * 0.68, -0.95, 1.35, -1.62, 1.0);
    add(box(0.13, 0.16, 0.95), body, s * 0.86, 0.78, 1.35);
    add(box(0.13, 0.16, 0.95), body, s * 0.86, 0.78, -1.3);
    add(box(0.3, 0.1, 0.04), lampMat, s * 0.6, 0.8, 2.02);
    add(box(0.3, 0.3, 0.02), dark, s * 0.78, 0.26, 0.88);
    add(box(0.3, 0.3, 0.02), dark, s * 0.78, 0.26, -1.78);
    add(box(0.03, 0.2, 0.42), body, s * 0.8, 1.33, -1.85);
    add(box(0.04, 0.36, 0.1), carbon, s * 0.45, 1.18, -1.82);
    add(box(0.36, 0.14, 0.04), k.brakeMat, s * 0.58, 0.86, -2.04);
    add(box(0.012, 0.1, 3.2), con, s * 0.856, 0.6, 0.05);
    add(box(0.012, 0.3, 0.3), numMat('4'), s * 0.856, 0.84, -0.2);
  });
  mirrors(k, body, 0.85, 1.1, 0.75);
  add(box(0.34, 0.1, 0.38), body, 0, 1.44, 0);
  add(box(0.28, 0.06, 0.02), dark, 0, 1.44, 0.19);
  add(box(0.1, 0.08, 0.06), dark, 0, 0.94, 1.75);
  add(box(1.3, 0.18, 0.1), dark, 0, 1.04, 1.75);
  for (const x of [-0.48, -0.16, 0.16, 0.48]) add(cyl(0.1, 0.1, 0.04, 10), lampMat, x, 1.04, 1.81, PI / 2);
  add(box(0.7, 0.12, 0.04), dark, 0, 0.8, 2.03);
  add(box(1.2, 0.04, 0.55), engineMat, 0, 0.42, 1.9, -0.3);
  add(box(1.6, 0.05, 0.36), body, 0, 1.38, -1.85, 0.08);
  add(box(0.3, 0.012, 1.0), con, 0, 0.942, 1.35, 0.09);
  add(cyl(0.075, 0.075, 0.22, 8), chrome, 0.6, 0.5, -2.03, PI / 2);
  return carDone(k, rig, [0.6, 0.5, -2.5, 0.09], [0.82, 2.1], [-0.35, 0.45, -0.4]);
}

/** Rounded wheel arch (half torus over the wheel) at lateral x, axle height y, axle z. */
const arch = (k: Kit, R: number, x: number, y: number, z: number) => k.add(tor(R, 0.06, 4, 10, PI), k.body, x, y, z, 0, PI / 2);

/** 1990s rotary coupe: smooth curves, closed pop-ups, round tail lamps, arched rear spoiler. */
function rotary(color: number) {
  const k = kit(color), { add, body, beam } = k;
  const rig = carRig(k, 0.33, 'five', 0.25);
  add(prism('rotary', [[2.15, 0.25], [2.2, 0.4], [2.1, 0.52], [1.7, 0.62], [1.0, 0.72], [0.5, 0.76], [-1.4, 0.8], [-1.95, 0.78], [-2.15, 0.7], [-2.18, 0.45], [-2.05, 0.25]], 1.72), body, 0, 0, 0);
  cabin(k, 'rotaryG', [[0.55, 0.75], [0.1, 1.05], [-0.3, 1.17], [-0.85, 1.17], [-1.35, 1.02], [-1.85, 0.79]], 1.34, 1.19, -0.575, 0.55);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.64, 0.55, 0.75, -0.3, 1.17);
    beam(0.12, 0.06, body, s * 0.6, -0.85, 1.17, -1.85, 0.79);
    arch(k, 0.42, s * 0.84, 0.33, 1.35);
    arch(k, 0.42, s * 0.84, 0.33, -1.3);
    add(box(0.36, 0.015, 0.32), dark, s * 0.55, 0.615, 1.75, 0.2);
    add(box(0.34, 0.02, 0.3), body, s * 0.55, 0.625, 1.75, 0.2);
    add(box(0.22, 0.06, 0.03), lampMat, s * 0.55, 0.36, 2.19);
    for (const dx of [0.42, 0.68]) add(cyl(0.07, 0.07, 0.04, 10), k.brakeMat, s * dx, 0.62, -2.17, PI / 2);
    add(box(0.4, 0.04, 0.2), body, s * 0.77, 0.915, -1.95, 0, 0, -s * 0.55);
    add(cyl(0.05, 0.05, 0.22, 8), chrome, s * 0.15, 0.3, -2.12, PI / 2);
  });
  mirrors(k, body, 0.8, 0.86, 0.45);
  add(box(0.9, 0.1, 0.04), dark, 0, 0.3, 2.18);
  add(box(1.2, 0.04, 0.2), body, 0, 1.02, -1.95);
  return carDone(k, rig, [0.15, 0.3, -2.5, 0.07], [0.5, 2.15], [0.33, 0.28, -0.5], [-0.3, 0]);
}

/** 2020s hypercar: ultra low, teardrop canopy, scissor-door seams, glass engine cover, active wing, big diffuser. */
function hyper(color: number) {
  const k = kit(color), { add, body, beam } = k;
  const rig = carRig(k, 0.36, 'spoke', 0.3, 0.34, 0.82);
  add(prism('hyper', [[2.25, 0.16], [2.3, 0.3], [2.0, 0.48], [1.2, 0.6], [0.7, 0.66], [-0.2, 0.78], [-1.5, 0.78], [-2.2, 0.72], [-2.28, 0.5], [-2.2, 0.16]], 1.84), body, 0, 0, 0);
  add(prism('hyperG', [[0.95, 0.64], [0.2, 1.02], [-0.4, 1.06], [-1.15, 0.79]], 1.2), winMat, 0, 0, 0);
  add(box(0.4, 0.04, 0.9), body, 0, 1.05, -0.15, 0.06);
  add(box(0.7, 0.1, 0.65), engineMat, 0, 0.8, -1.6);
  add(box(0.95, 0.08, 0.8), winMat, 0, 0.85, -1.6);
  sym((s) => {
    add(box(0.16, 0.14, 1.0), body, s * 0.92, 0.7, 1.35);
    add(box(0.18, 0.14, 1.05), body, s * 0.93, 0.7, -1.3);
    beam(0.012, 0.015, dark, s * 0.925, 0.75, 0.3, 0.1, 0.68);
    add(box(0.012, 0.4, 0.015), dark, s * 0.925, 0.48, -0.55);
    add(box(0.03, 0.28, 0.6), dark, s * 0.925, 0.5, -0.95);
    add(box(0.5, 0.025, 0.06), lampMat, s * 0.55, 0.42, 2.12, 0, -s * 0.3);
    add(box(0.5, 0.14, 0.04), dark, s * 0.5, 0.25, 2.27);
    add(box(0.03, 0.22, 0.12), carbon, s * 0.45, 0.87, -2.0);
    add(cyl(0.06, 0.06, 0.15, 8), engineMat, s * 0.12, 0.6, -2.25, PI / 2);
  });
  mirrors(k, body, 0.8, 0.78, 0.6);
  add(box(1.9, 0.03, 0.3), carbon, 0, 0.14, 2.22);
  add(box(1.7, 0.03, 0.04), k.brakeMat, 0, 0.66, -2.24);
  add(box(1.7, 0.04, 0.32), carbon, 0, 1.0, -2.0, -0.15);
  for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) add(box(0.03, 0.32, 0.55), carbon, x, 0.3, -2.25);
  add(box(1.8, 0.03, 0.55), carbon, 0, 0.15, -2.25);
  return carDone(k, rig, [0.12, 0.6, -2.7, 0.08], [0.42, 2.25], [-0.3, 0.16, -0.3], [-0.24, 0]);
}

/** 2000s touring-car saloon: 4 doors, wide arches, boot wing, splitter, door roundels, livery. */
function touring(color: number) {
  const k = kit(color), { add, body, beam, con } = k;
  const rig = carRig(k, 0.34, 'bbs', 0.26);
  add(prism('touring', [[2.15, 0.22], [2.2, 0.5], [2.1, 0.68], [0.95, 0.8], [-1.45, 0.82], [-2.1, 0.84], [-2.17, 0.55], [-2.08, 0.22]], 1.72), body, 0, 0, 0);
  cabin(k, 'touringG', [[0.9, 0.79], [0.25, 1.28], [-0.95, 1.28], [-1.5, 0.83]], 1.42, 1.305, -0.35, 1.2);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.69, 0.9, 0.79, 0.25, 1.28);
    add(box(0.06, 0.46, 0.08), body, s * 0.71, 1.05, -0.3);
    beam(0.12, 0.06, body, s * 0.67, -0.95, 1.28, -1.5, 0.83);
    for (const z of [0.85, -0.3, -1.2]) add(box(0.012, 0.42, 0.012), dark, s * 0.865, 0.55, z);
    add(box(0.16, 0.2, 1.0), body, s * 0.9, 0.66, 1.35);
    add(box(0.16, 0.2, 1.0), body, s * 0.9, 0.66, -1.3);
    add(box(0.012, 0.3, 0.3), numMat('12'), s * 0.866, 0.55, 0.3);
    add(box(0.012, 0.06, 3.8), con, s * 0.866, 0.35, 0);
    add(box(0.36, 0.1, 0.04), lampMat, s * 0.55, 0.6, 2.16);
    add(box(0.42, 0.12, 0.04), k.brakeMat, s * 0.55, 0.72, -2.145);
    add(box(0.03, 0.16, 0.18), carbon, s * 0.55, 0.92, -1.9);
  });
  mirrors(k, body, 0.82, 0.92, 0.7);
  add(box(0.6, 0.1, 0.04), dark, 0, 0.58, 2.165);
  add(box(1.85, 0.035, 0.3), carbon, 0, 0.18, 2.16);
  add(box(1.5, 0.04, 0.3), carbon, 0, 1.0, -1.92, 0.08);
  add(box(0.3, 0.012, 1.15), con, 0, 0.746, 1.52, 0.104);
  add(cyl(0.06, 0.06, 0.2, 8), chrome, -0.6, 0.28, -2.12, PI / 2);
  return carDone(k, rig, [-0.6, 0.28, -2.55, 0.08], [0.6, 2.2], [-0.35, 0.28, -0.3]);
}

/** Desert trophy truck: tall long-travel pickup, huge tyres, bed cage, spare, roof light bar. */
function trophy(color: number) {
  const k = kit(color), { add, body, beam, tube } = k;
  const rig = carRig(k, 0.52, 'beadlock', 0.4, 0.4, 0.88);
  add(prism('trophy', [[2.35, 0.85], [2.4, 1.1], [2.2, 1.28], [0.75, 1.36], [-2.3, 1.36], [-2.35, 0.9], [-2.2, 0.8], [2.2, 0.8]], 1.7), body, 0, 0, 0);
  cabin(k, 'trophyG', [[0.75, 1.36], [0.2, 1.85], [-0.65, 1.86], [-0.75, 1.36]], 1.5, 1.89, -0.22, 0.88);
  add(box(1.5, 0.02, 1.5), dark, 0, 1.37, -1.5);
  sym((s) => {
    beam(0.08, 0.07, body, s * 0.73, 0.75, 1.36, 0.2, 1.85);
    add(box(0.08, 0.5, 0.08), body, s * 0.73, 1.61, -0.7);
    add(box(0.3, 0.1, 1.25), body, s * 0.92, 1.1, 1.35);
    add(box(0.3, 0.1, 1.25), body, s * 0.92, 1.1, -1.3);
    add(box(0.6, 0.06, 0.08), dark, s * 0.55, 0.52, 1.35);
    add(cyl(0.06, 0.06, 0.65, 6), chrome, s * 0.6, 0.85, 1.2, 0, 0, s * 0.25);
    add(cyl(0.06, 0.06, 0.6, 6), chrome, s * 0.55, 0.9, -1.15, 0, 0, s * 0.2);
    tube(0.035, 0.035, cage, s * 0.65, -0.75, 1.86, -2.05, 1.62);
    tube(0.035, 0.035, cage, s * 0.65, -2.05, 1.36, -2.05, 1.62);
    add(box(0.3, 0.1, 0.04), lampMat, s * 0.6, 1.12, 2.39);
    add(box(0.12, 0.3, 0.04), k.brakeMat, s * 0.75, 1.15, -2.345);
    add(box(0.012, 0.3, 0.3), numMat('1'), s * 0.856, 1.05, -0.2);
  });
  mirrors(k, dark, 0.86, 1.5, 0.6);
  add(box(1.4, 0.1, 0.1), dark, 0, 1.98, 0.12);
  for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) add(box(0.18, 0.06, 0.03), lampMat, x, 1.98, 0.18);
  add(cyl(0.035, 0.035, 1.3, 6), cage, 0, 1.62, -2.05, 0, 0, PI / 2);
  add(cyl(0.45, 0.45, 0.3, 14), tyre, 0, 1.53, -1.45);
  add(cyl(0.28, 0.28, 0.32, 10), rimDark, 0, 1.53, -1.45);
  add(cyl(0.08, 0.08, 1.6, 6), dark, 0, 0.52, -1.3, 0, 0, PI / 2);
  add(box(1.0, 0.22, 0.04), dark, 0, 1.05, 2.4);
  add(cyl(0.05, 0.05, 1.6, 6), cage, 0, 0.85, 2.42, 0, 0, PI / 2);
  add(box(1.2, 0.04, 0.6), engineMat, 0, 0.75, 1.95, -0.3);
  add(cyl(0.08, 0.08, 0.25, 8), chrome, 0.5, 0.86, -2.3, PI / 2);
  return carDone(k, rig, [0.5, 0.86, -2.75, 0.1], [1.12, 2.4], [-0.38, 0.95, -0.25]);
}

/** 1960s GT roadster: long rounded bonnet with louvres, open cockpit, small screen, wire wheels. */
function roadster(color: number) {
  const k = kit(color), { add, body } = k;
  const rig = carRig(k, 0.34, 'wire', 0.22);
  add(prism('roadster', [[2.15, 0.28], [2.22, 0.42], [2.15, 0.55], [1.9, 0.65], [1.4, 0.72], [0.6, 0.76], [0.2, 0.78], [-1.3, 0.8], [-1.85, 0.76], [-2.12, 0.62], [-2.15, 0.42], [-2.05, 0.28]], 1.62), body, 0, 0, 0);
  add(box(1.2, 0.04, 1.1), dark, 0, 0.785, -0.35);
  add(box(0.5, 0.04, 1.3), body, 0, 0.75, 1.3, 0.07);
  add(box(1.3, 0.32, 0.02), winMat, 0, 0.95, 0.32, -0.5);
  add(box(1.32, 0.03, 0.04), chrome, 0, 1.09, 0.243, -0.5);
  add(cyl(0.25, 0.25, 0.04, 12), dark, 0, 0.38, 2.2, PI / 2).scale.set(1.3, 1, 0.55);
  add(box(0.6, 0.02, 0.03), chrome, 0, 0.38, 2.23);
  sym((s) => {
    add(box(0.45, 0.4, 0.12), leather, s * 0.3, 0.95, -0.75, -0.2);
    arch(k, 0.4, s * 0.82, 0.34, 1.35);
    arch(k, 0.4, s * 0.82, 0.34, -1.3);
    add(cyl(0.1, 0.1, 0.03, 10), lampMat, s * 0.6, 0.57, 2.02, PI / 2);
    add(sph(0.13), winMat, s * 0.6, 0.58, 1.98).scale.set(1, 0.8, 1.4);
    for (let i = 0; i < 4; i++) {
      const z = 1.05 + i * 0.12;
      add(box(0.25, 0.02, 0.05), dark, s * 0.35, 0.73 + (1.4 - z) * 0.05, z);
    }
    add(box(0.45, 0.05, 0.08), chrome, s * 0.45, 0.33, 2.18);
    add(box(0.5, 0.05, 0.08), chrome, s * 0.45, 0.4, -2.14);
    add(cyl(0.05, 0.05, 0.03, 8), k.brakeMat, s * 0.6, 0.55, -2.14, PI / 2);
    add(cyl(0.04, 0.04, 0.25, 8), chrome, s * 0.15, 0.25, -2.1, PI / 2);
  });
  return carDone(k, rig, [0.15, 0.25, -2.45, 0.06], [0.58, 2.15], [0.3, 0.25, -0.45], [-0.3, 0]);
}

const BUILDERS: Record<VehicleModelId, (color: number) => VehicleModel> = {
  street, superbike, dirt, cafe, cruiser,
  drift_coupe: driftCoupe, hatch, gt, muscle, rally,
  rotary, hyper, touring, trophy, roadster,
};

export function buildVehicleModel(id: VehicleModelId, color: number): VehicleModel {
  return (BUILDERS[id] ?? BUILDERS.street)(color);
}
