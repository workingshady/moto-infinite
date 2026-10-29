// Shared geometries and materials, created once and reused by every chunk/entity (cheap draw setup, no per-spawn allocations).
import * as THREE from 'three';
import { PI } from '../utils/math';
import { RAMP } from '../world/Terrain';

export const M = (c: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, ...o });
export const Basic = (c: number, o: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = shadow;
  return o;
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  return new THREE.CanvasTexture(c);
}

const rampShape = new THREE.Shape();
rampShape.moveTo(-RAMP.L, 0);
rampShape.lineTo(RAMP.L, 0);
rampShape.lineTo(0, RAMP.H);
rampShape.lineTo(-RAMP.L, 0);

export const G = {
  trunk: new THREE.CylinderGeometry(0.25, 0.4, 2.2, 6),
  blob: new THREE.IcosahedronGeometry(1.6, 0),
  cone: new THREE.ConeGeometry(1.6, 2.6, 7),
  rock: new THREE.DodecahedronGeometry(1.3, 0),
  cactus: new THREE.CylinderGeometry(0.35, 0.4, 3.2, 7),
  arm: new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  gem: new THREE.OctahedronGeometry(0.7, 0),
  barrel: new THREE.CylinderGeometry(0.6, 0.6, 1.3, 12),
  band: new THREE.CylinderGeometry(0.62, 0.62, 0.12, 12),
  tcone: new THREE.ConeGeometry(0.38, 1, 10),
  sph: new THREE.SphereGeometry(1, 12, 10),
  ramp: new THREE.ExtrudeGeometry(rampShape, { depth: RAMP.W, bevelEnabled: false }).translate(0, 0, -RAMP.W / 2),
  pad: new THREE.PlaneGeometry(4, 6).rotateX(-PI / 2),
  ring: new THREE.RingGeometry(0.85, 1, 40).rotateX(-PI / 2),
  bolt: new THREE.BoxGeometry(0.14, 0.14, 1.4),
  rocket: new THREE.CylinderGeometry(0.14, 0.18, 0.9, 8).rotateX(PI / 2),
  pellet: new THREE.SphereGeometry(0.13, 6, 5),
  mine: new THREE.CylinderGeometry(0.45, 0.55, 0.25, 10),
  beam: new THREE.BoxGeometry(0.12, 0.12, 1).translate(0, 0, 0.5),
  torus: new THREE.TorusGeometry(0.9, 0.08, 6, 24),
  post: new THREE.BoxGeometry(0.6, 6, 0.6),
};

export const MAT = {
  trunk: M(0x7a5232),
  white: M(0xffffff),
  rock: M(0x8a8d91),
  cactus: M(0x4f9a4a),
  gem: M(0x46e3ff, { emissive: 0x1a9fff, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 }),
  crate: new THREE.MeshStandardMaterial({
    map: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#b9853f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#6b4520'; g.lineWidth = 2;
      for (let y = 16; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.lineWidth = 7; g.strokeRect(3, 3, w - 6, h - 6);
      g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, h - 5); g.stroke();
    }),
    roughness: 0.9,
  }),
  barrel: M(0xd8322a, { roughness: 0.5, metalness: 0.3 }),
  band: M(0xf2f2f2),
  cone: M(0xff7a1a),
  coneBase: M(0x222222),
  ramp: new THREE.MeshStandardMaterial({
    map: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#f2a33a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#222';
      for (let i = -64; i < 128; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 10, 0); g.lineTo(i - 54, h); g.lineTo(i - 64, h); g.fill(); }
    }),
    flatShading: true,
  }),
  pad: new THREE.MeshBasicMaterial({
    transparent: true,
    map: canvasTex(64, 96, (g, w, h) => {
      g.fillStyle = 'rgba(20,200,255,.85)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineJoin = 'round';
      for (let y = 18; y < h; y += 28) { g.beginPath(); g.moveTo(12, y + 14); g.lineTo(32, y - 4); g.lineTo(52, y + 14); g.stroke(); }
    }),
  }),
  droneBody: M(0x2b2f38, { metalness: 0.6, roughness: 0.35 }),
  droneGlow: Basic(0xff2a3a),
  orb: Basic(0xff3355, { transparent: true, blending: THREE.AdditiveBlending }),
  terrain: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  gate: M(0x2b2f38, { metalness: 0.4, roughness: 0.4 }),
  checker: new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    map: canvasTex(128, 32, (g, w, h) => {
      for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) { g.fillStyle = (x + y) % 16 ? '#111' : '#fff'; g.fillRect(x, y, 8, 8); }
    }),
  }),
  cpBanner: new THREE.MeshBasicMaterial({ color: 0x3cc8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
};
MAT.ramp.map!.wrapS = MAT.ramp.map!.wrapT = THREE.RepeatWrapping;
