// Low-poly character, bike and drone models. Colours are per player so riders are easy to tell apart.
import * as THREE from 'three';
import { Basic, G, M, MAT, mesh } from './assets';
import { PI, TAU, hex } from '../utils/math';

export interface RiderModel {
  root: THREE.Group;
  torso: THREE.Mesh;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  helmet: THREE.Mesh;
  hair: THREE.Mesh;
}

export interface BikeModel {
  root: THREE.Group;
  wheels: THREE.Group[];
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  seat: THREE.Group;
}

const skin = M(0xf1c27d), pants = M(0x2c4a7a), dark = M(0x222428), hairM = M(0x3b2416);
const chrome = M(0xcfd6de, { roughness: 0.2, metalness: 0.8 }), tyre = M(0x1a1a1a);

function limb(w: number, h: number, d: number, m: THREE.Material) {
  const pivot = new THREE.Group();
  pivot.add(mesh(new THREE.BoxGeometry(w, h, d), m, 0, -h / 2, 0));
  return pivot;
}

export function buildRider(color: number): RiderModel {
  const shirt = M(color);
  const root = new THREE.Group();
  const torso = mesh(new THREE.BoxGeometry(0.8, 0.95, 0.45), shirt, 0, 1.5, 0);
  root.add(torso);
  root.add(mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), skin, 0, 2.27, 0));
  const hair = mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), hairM, 0, 2.55, -0.02);
  root.add(hair);
  const helmet = mesh(new THREE.SphereGeometry(0.42, 10, 8, 0, TAU, 0, PI / 2), M(0xffcc33, { roughness: 0.4 }), 0, 2.35, 0);
  helmet.visible = false;
  root.add(helmet);
  [-0.13, 0.13].forEach((x) => root.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), dark, x, 2.33, 0.28)));
  const legL = limb(0.32, 1, 0.34, pants), legR = limb(0.32, 1, 0.34, pants);
  legL.position.set(-0.2, 1.03, 0);
  legR.position.set(0.2, 1.03, 0);
  const armL = limb(0.22, 0.9, 0.22, shirt), armR = limb(0.22, 0.9, 0.22, shirt);
  armL.position.set(-0.52, 1.92, 0);
  armR.position.set(0.52, 1.92, 0);
  root.add(legL, legR, armL, armR);
  armL.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), skin, 0, -0.95, 0));
  const gun = new THREE.Group();
  gun.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.7), dark, 0, -0.95, 0.25));
  gun.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.3), M(0x55e8ff, { emissive: 0x22aaff }), 0, -0.92, 0.65));
  armR.add(gun);
  [legL, legR].forEach((l) => l.add(mesh(new THREE.BoxGeometry(0.34, 0.18, 0.5), dark, 0, -1, 0.08)));
  return { root, torso, legL, legR, armL, armR, helmet, hair };
}

export function buildBike(color: number): BikeModel {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = M(color, { roughness: 0.35, metalness: 0.3 });
  const wheels: THREE.Group[] = [];
  [1.05, -1.05].forEach((z) => {
    const sp = new THREE.Group();
    sp.position.set(0, 0.62, z);
    const t = mesh(new THREE.TorusGeometry(0.5, 0.16, 8, 18), tyre);
    t.rotation.y = PI / 2;
    sp.add(t);
    const hub = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 8), chrome);
    hub.rotation.z = PI / 2;
    sp.add(hub);
    for (let k = 0; k < 3; k++) {
      const s = mesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), chrome);
      s.rotation.x = (k * PI) / 3;
      sp.add(s);
    }
    root.add(sp);
    wheels.push(sp);
  });
  root.add(mesh(new THREE.BoxGeometry(0.28, 0.28, 1.7), dark, 0, 1.0, 0));
  root.add(mesh(new THREE.BoxGeometry(0.55, 0.5, 0.65), chrome, 0, 0.78, 0.05));
  root.add(mesh(new THREE.BoxGeometry(0.58, 0.42, 0.75), body, 0, 1.3, 0.38));
  root.add(mesh(new THREE.BoxGeometry(0.46, 0.18, 0.85), dark, 0, 1.25, -0.42));
  const tail = mesh(new THREE.BoxGeometry(0.4, 0.25, 0.5), body, 0, 1.3, -0.95);
  tail.rotation.x = -0.25;
  root.add(tail);
  const fork = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.05, 6), chrome, 0, 1.12, 0.95);
  fork.rotation.x = -0.25;
  root.add(fork);
  const bar = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), chrome, 0, 1.65, 0.78);
  bar.rotation.z = PI / 2;
  root.add(bar);
  root.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), M(0xfff6c0, { emissive: 0xfff2a0, emissiveIntensity: 1 }), 0, 1.42, 1.18));
  const pipe = mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.1, 8), chrome, 0.33, 0.7, -0.55);
  pipe.rotation.x = PI / 2 + 0.15;
  root.add(pipe);
  root.add(mesh(new THREE.BoxGeometry(0.32, 0.06, 0.7), body, 0, 1.22, 1.1));
  const flameMat = Basic(0x66ccff, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1, 8), flameMat);
  flame.rotation.x = -PI / 2;
  flame.position.set(0.33, 0.62, -1.6);
  flame.scale.set(1, 0.01, 1);
  root.add(flame);
  const seat = new THREE.Group();
  seat.position.set(0, 0.3, -0.35);
  root.add(seat);
  return { root, wheels, flame, flameMat, seat };
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

export function buildDrone() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.75, 10, 8), MAT.droneBody));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.1, 6, 24), MAT.droneGlow);
  ring.rotation.x = PI / 2;
  g.add(ring);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), MAT.droneGlow);
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
