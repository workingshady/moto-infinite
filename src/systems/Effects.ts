// Pooled shockwave rings, flying debris and railgun beams (no objects created during play).
import * as THREE from 'three';
import { G } from '../entities/assets';
import { rnd } from '../utils/math';
import type { Terrain } from '../world/Terrain';

const _UP = new THREE.Vector3(0, 1, 0);

interface Ring { m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; t: number; r: number }
interface Chip { m: THREE.Mesh; vx: number; vy: number; vz: number; ax: number; az: number; life: number }
interface Beam { m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; t: number }

export class Effects {
  private rings: Ring[] = [];
  private chips: Chip[] = [];
  private beams: Beam[] = [];
  private skids: THREE.InstancedMesh;
  private skidI = 0;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3(0.28, 1, 0.9);

  constructor(scene: THREE.Scene, private terrain: Terrain) {
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 1, r: 1 });
    }
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(G.box);
      m.castShadow = true;
      m.visible = false;
      scene.add(m);
      this.chips.push({ m, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, life: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(G.beam, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.beams.push({ m, t: 1 });
    }
    // all tyre marks of all players share one instanced mesh (ring buffer, 1 draw call)
    const skidGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.45, depthWrite: false }), 600);
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < 600; i++) this.skids.setMatrixAt(i, this._m);
    this.skids.frustumCulled = false;
    scene.add(this.skids);
  }

  /** Drop one tyre-mark segment on the ground. */
  skid(x: number, z: number, h: number) {
    const y = this.terrain.groundAt(x, z) + 0.04;
    this._q.setFromAxisAngle(_UP, h);
    this._m.compose(this._p.set(x, y, z), this._q, this._s);
    this.skids.setMatrixAt(this.skidI, this._m);
    this.skidI = (this.skidI + 1) % 600;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  ring(x: number, y: number, z: number, r: number, color: number) {
    const ring = this.rings.find((q) => q.t >= 1) ?? this.rings[0];
    ring.t = 0;
    ring.r = r;
    ring.m.material.color.setHex(color);
    ring.m.position.set(x, y, z);
    ring.m.visible = true;
  }

  debris(x: number, y: number, z: number, mat: THREE.Material, n: number, size: number, power: number) {
    for (let k = 0; k < n; k++) {
      const c = this.chips.find((q) => q.life <= 0);
      if (!c) return;
      c.m.material = mat;
      c.m.position.set(x + rnd(0.5), y + rnd(0.5), z + rnd(0.5));
      c.m.scale.setScalar(size * (0.5 + Math.random() * 0.6));
      Object.assign(c, { vx: rnd(power), vy: power * (0.5 + Math.random()), vz: rnd(power), ax: rnd(8), az: rnd(8), life: 2 + Math.random() });
      c.m.visible = true;
    }
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const b = this.beams.find((q) => q.t >= 1) ?? this.beams[0];
    b.t = 0;
    b.m.material.color.setHex(color);
    b.m.position.copy(from);
    b.m.lookAt(to);
    b.m.scale.set(2.2, 2.2, from.distanceTo(to));
    b.m.visible = true;
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t += dt * 2.4;
      r.m.scale.setScalar(0.2 + r.t * r.r);
      r.m.material.opacity = 1 - r.t;
      if (r.t >= 1) r.m.visible = false;
    }
    for (const d of this.chips) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 22 * dt;
      const p = d.m.position;
      p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
      d.m.rotation.x += d.ax * dt;
      d.m.rotation.z += d.az * dt;
      const g = this.terrain.groundAt(p.x, p.z);
      if (p.y < g + 0.1) { p.y = g + 0.1; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.ax *= 0.5; d.az *= 0.5; }
      if (d.life < 0.4) d.m.scale.multiplyScalar(0.9);
      if (d.life <= 0) d.m.visible = false;
    }
    for (const b of this.beams) {
      if (b.t >= 1) continue;
      b.t += dt * 4;
      b.m.material.opacity = 1 - b.t;
      b.m.scale.x = b.m.scale.y = 2.2 * (1 - b.t) + 0.2;
      if (b.t >= 1) b.m.visible = false;
    }
  }
}
