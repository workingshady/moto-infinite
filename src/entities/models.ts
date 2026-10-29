// Low-poly character, bike and drone models. Colours are per player so riders are easy to tell apart.
import * as THREE from 'three';
import { Basic, G, M, MAT, mesh } from './assets';
import { PI, TAU, hex } from '../utils/math';

export interface RiderModel {
  root: THREE.Group;
  torso: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  helmet: THREE.Group;
  hair: THREE.Mesh;
}

export interface BikeModel {
  root: THREE.Group;
  wheels: THREE.Group[];
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  seat: THREE.Group;
  headlight: THREE.SpotLight;
}

const skin = M(0xf1c27d), dark = M(0x222428), hairM = M(0x3b2416), white = M(0xf4f4f4), glove = M(0x1b1d22, { roughness: 0.6 });
const chrome = M(0xcfd6de, { roughness: 0.2, metalness: 0.8 }), tyre = M(0x1a1a1a, { roughness: 0.95 }), carbon = M(0x2a2d33, { roughness: 0.5, metalness: 0.4 });
const visor = M(0x10131a, { roughness: 0.1, metalness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.2 });
const lampMat = M(0xfff6c0, { emissive: 0xfff2a0, emissiveIntensity: 1 });
const tailMat = M(0xff2030, { emissive: 0xff1020, emissiveIntensity: 0.7 });
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

function limb(w: number, h: number, d: number, m: THREE.Material, end?: { geo: THREE.BufferGeometry; m: THREE.Material; z?: number }) {
  const pivot = new THREE.Group();
  pivot.add(mesh(box(w, h, d), m, 0, -h / 2, 0));
  if (end) pivot.add(mesh(end.geo, end.m, 0, -h - 0.02, end.z ?? 0));
  return pivot;
}

export function buildRider(color: number): RiderModel {
  const suit = M(color, { roughness: 0.55 }), pants = M(new THREE.Color(color).multiplyScalar(0.35).getHex(), { roughness: 0.7 });
  const root = new THREE.Group();
  // jacket with white racing stripes and a back protector
  const torso = new THREE.Group();
  torso.position.set(0, 1.5, 0);
  torso.add(mesh(box(0.8, 0.95, 0.45), suit));
  torso.add(mesh(box(0.14, 0.97, 0.47), white, -0.2, 0, 0), mesh(box(0.14, 0.97, 0.47), white, 0.2, 0, 0));
  torso.add(mesh(box(0.6, 0.35, 0.18), carbon, 0, 0.25, -0.3));
  root.add(torso);
  root.add(mesh(box(0.28, 0.14, 0.28), skin, 0, 2.03, 0));
  root.add(mesh(box(0.55, 0.55, 0.55), skin, 0, 2.27, 0));
  const hair = mesh(box(0.6, 0.18, 0.6), hairM, 0, 2.55, -0.02);
  root.add(hair);
  [-0.13, 0.13].forEach((x) => root.add(mesh(box(0.08, 0.08, 0.02), dark, x, 2.33, 0.28)));
  // helmet in team colour with a dark visor and a white stripe
  const helmet = new THREE.Group();
  helmet.position.set(0, 2.3, 0);
  helmet.add(mesh(new THREE.SphereGeometry(0.43, 12, 10), suit));
  helmet.add(mesh(new THREE.TorusGeometry(0.43, 0.035, 4, 24, Math.PI), white, 0, 0, 0, false).rotateY(Math.PI / 2));
  helmet.add(mesh(new THREE.SphereGeometry(0.44, 12, 6, -0.9, 1.8, 1.15, 0.6), visor, 0, 0, 0, false));
  helmet.visible = false;
  root.add(helmet);
  const boot = { geo: box(0.36, 0.22, 0.55), m: dark, z: 0.09 }, hand = { geo: box(0.22, 0.22, 0.24), m: glove };
  const legL = limb(0.32, 1, 0.34, pants, boot), legR = limb(0.32, 1, 0.34, pants, boot);
  legL.position.set(-0.2, 1.03, 0);
  legR.position.set(0.2, 1.03, 0);
  const armL = limb(0.22, 0.9, 0.22, suit, hand), armR = limb(0.22, 0.9, 0.22, suit);
  armL.position.set(-0.52, 1.92, 0);
  armR.position.set(0.52, 1.92, 0);
  root.add(legL, legR, armL, armR);
  [legL, legR].forEach((l) => l.add(mesh(box(0.34, 0.2, 0.36), carbon, 0, -0.5, 0.02)));
  const gun = new THREE.Group();
  gun.add(mesh(box(0.16, 0.2, 0.7), dark, 0, -0.95, 0.25));
  gun.add(mesh(box(0.1, 0.1, 0.3), M(0x55e8ff, { emissive: 0x22aaff }), 0, -0.92, 0.65));
  gun.add(mesh(box(0.06, 0.14, 0.1), glove, 0, -1.05, 0.05));
  armR.add(gun);
  return { root, torso, legL, legR, armL, armR, helmet, hair };
}

function wheel(rimMat: THREE.Material, front: boolean) {
  const sp = new THREE.Group();
  const t = mesh(new THREE.TorusGeometry(0.5, 0.17, 8, 22), tyre);
  t.rotation.y = PI / 2;
  const rim = mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 22), rimMat);
  rim.rotation.y = PI / 2;
  const hub = mesh(cyl(0.11, 0.11, 0.24), chrome);
  hub.rotation.z = PI / 2;
  const r = front ? 0.27 : 0.22, disc = mesh(cyl(r, r, 0.03, 16), chrome, 0.1, 0, 0);
  disc.rotation.z = PI / 2;
  sp.add(t, rim, hub, disc);
  for (let k = 0; k < 5; k++) {
    const s = mesh(box(0.05, 0.34, 0.07), rimMat);
    s.rotation.x = (k * TAU) / 5;
    s.translateY(0.18);
    sp.add(s);
  }
  return sp;
}

export function buildBike(color: number): BikeModel {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = M(color, { roughness: 0.3, metalness: 0.35 });
  const rimMat = M(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex(), { roughness: 0.3, metalness: 0.6 });
  const wheels = [wheel(rimMat, true), wheel(rimMat, false)];
  wheels[0].position.set(0, 0.62, 1.08);
  wheels[1].position.set(0, 0.62, -1.05);
  root.add(...wheels);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const o = mesh(geo, m, x, y, z);
    o.rotation.set(rx, 0, rz);
    root.add(o);
    return o;
  };
  // frame, swingarm, engine with cooling fins
  for (const sx of [-1, 1]) {
    add(box(0.12, 0.12, 1.5), carbon, sx * 0.16, 1.02, 0.1, -0.12);
    add(box(0.1, 0.1, 1.15), carbon, sx * 0.2, 0.68, -0.52, 0.1);
  }
  add(box(0.5, 0.48, 0.62), chrome, 0, 0.8, 0.05);
  for (let i = 0; i < 3; i++) add(box(0.58, 0.04, 0.6), carbon, 0, 0.66 + i * 0.12, 0.05);
  // fuel tank, seat, tail with rear light and number plate
  add(new THREE.SphereGeometry(0.36, 12, 8), body, 0, 1.33, 0.32).scale.set(0.85, 0.62, 1.25);
  add(box(0.42, 0.13, 0.85), dark, 0, 1.27, -0.42);
  add(box(0.38, 0.22, 0.55), body, 0, 1.33, -0.92, -0.22);
  add(box(0.26, 0.08, 0.05), tailMat, 0, 1.36, -1.2, -0.22);
  add(box(0.3, 0.2, 0.02), white, 0, 1.08, -1.22, 0.35);
  add(box(0.5, 0.06, 0.8), body, 0, 0.98, -1.12, 0.25);
  // front: fork, fender, fairing, windscreen, headlight, bars, grips and mirrors
  for (const sx of [-1, 1]) add(cyl(0.055, 0.055, 1.1, 6), chrome, sx * 0.13, 1.08, 0.98, -0.3);
  add(box(0.24, 0.05, 0.6), body, 0, 1.2, 1.08, 0.35);
  add(box(0.6, 0.5, 0.22), body, 0, 1.38, 0.88, -0.45);
  add(box(0.48, 0.3, 0.03), glass, 0, 1.72, 0.84, -0.6);
  add(new THREE.SphereGeometry(0.16, 10, 8), lampMat, 0, 1.42, 1.02);
  add(cyl(0.035, 0.035, 0.95, 6), chrome, 0, 1.62, 0.7, 0, PI / 2);
  for (const sx of [-1, 1]) {
    add(box(0.12, 0.08, 0.03), dark, sx * 0.42, 1.82, 0.72);
    add(cyl(0.015, 0.015, 0.2, 4), chrome, sx * 0.38, 1.72, 0.72, 0, sx * 0.4);
    add(box(0.12, 0.08, 0.12), glove, sx * 0.48, 1.62, 0.7);
  }
  // exhaust with muffler
  add(cyl(0.07, 0.08, 0.9), chrome, 0.3, 0.62, -0.25, PI / 2 + 0.1);
  add(cyl(0.12, 0.1, 0.55, 10), carbon, 0.32, 0.72, -0.85, PI / 2 + 0.15);
  const flameMat = Basic(0x66ccff, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1, 8), flameMat);
  flame.rotation.x = -PI / 2;
  flame.position.set(0.32, 0.76, -1.6);
  flame.scale.set(1, 0.01, 1);
  root.add(flame);
  // real headlight: lights the road at night (intensity driven by Environment.night)
  const headlight = new THREE.SpotLight(0xfff2cc, 0, 55, 0.55, 0.5, 1.2);
  headlight.position.set(0, 1.45, 1.1);
  headlight.target.position.set(0, -1.5, 14);
  root.add(headlight, headlight.target);
  const seat = new THREE.Group();
  seat.position.set(0, 0.3, -0.35);
  root.add(seat);
  return { root, wheels, flame, flameMat, seat, headlight };
}

/** Rider seated on the bike (static pose). */
export function seatRider(r: RiderModel, b: BikeModel) {
  b.seat.add(r.root);
  r.root.position.set(0, 0, 0);
  r.root.rotation.set(0, 0, 0);
  r.helmet.visible = true;
  r.hair.visible = false;
  r.legL.rotation.set(-1.35, 0, 0.12);
  r.legR.rotation.set(-1.35, 0, -0.12);
  r.armL.rotation.set(-1.15, 0, -0.15);
  r.armR.rotation.set(-1.15, 0, 0.15);
  r.torso.rotation.x = 0.25;
  r.torso.position.z = 0.12;
}

/** Translucent copy of a bike+rider for the best-lap ghost. */
export function buildGhost(): THREE.Group {
  const b = buildBike(0xffffff), r = buildRider(0xffffff);
  seatRider(r, b);
  const mat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.32, depthWrite: false });
  b.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = mat;
      o.castShadow = o.receiveShadow = false;
    }
  });
  return b.root;
}

const droneGlows = new Map<number, THREE.MeshBasicMaterial>();
export function buildDrone(color = 0xff2a3a, scale = 1, bomber = false) {
  const g = new THREE.Group();
  let glowMat = droneGlows.get(color);
  if (!glowMat) droneGlows.set(color, (glowMat = Basic(color)));
  g.add(mesh(new THREE.SphereGeometry(0.75, 10, 8), MAT.droneBody));
  if (bomber) {
    g.add(mesh(box(1.1, 0.4, 1.6), MAT.droneBody, 0, -0.55, 0));
    for (const x of [-0.35, 0.35]) {
      const b = mesh(cyl(0.18, 0.18, 0.5, 8), glowMat, x, -0.85, 0);
      b.rotation.x = PI / 2;
      g.add(b);
    }
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.1, 6, 24), glowMat);
  ring.rotation.x = PI / 2;
  g.add(ring);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), glowMat);
  eye.position.set(0, 0, 0.68);
  g.add(eye);
  const rotors: THREE.Mesh[] = [];
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => {
    const arm = mesh(G.box, MAT.droneBody, a * 0.7, 0.15, b * 0.7);
    arm.scale.set(0.15, 0.12, 0.15);
    g.add(arm);
    const r = mesh(G.box, MAT.droneBody, a * 1.1, 0.32, b * 1.1);
    r.scale.set(1.1, 0.04, 0.16);
    g.add(r);
    rotors.push(r);
  });
  g.scale.setScalar(scale);
  return { root: g, eye, rotors };
}

/** Floating name label for remote players. */
export function nameTag(text: string, color: number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(12,16,28,.72)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 8, w, 46, 14);
  g.fill();
  g.fillStyle = hex(color);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 32, 230);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
  s.scale.set(4, 1, 1);
  return s;
}
