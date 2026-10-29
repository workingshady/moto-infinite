// GPU point particles in a ring buffer. Spawning writes into typed arrays (no allocations), and
// the update loop is skipped entirely when nothing is alive.
import * as THREE from 'three';

class Pool {
  private i = 0;
  private live = 0;
  private dirty = false;
  readonly pos: Float32Array; readonly col: Float32Array; readonly size: Float32Array;
  private vel: Float32Array; private life: Float32Array; private ml: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private a0: Float32Array; private g: Float32Array; private drag: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, private max: number, additive: boolean) {
    const F = (n: number) => new Float32Array(n);
    this.pos = F(max * 3); this.col = F(max * 4); this.size = F(max); this.vel = F(max * 3);
    this.life = F(max); this.ml = F(max); this.s0 = F(max); this.s1 = F(max); this.a0 = F(max); this.g = F(max); this.drag = F(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcol', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `uniform float uScale;attribute float size;attribute vec4 pcol;varying vec4 vC;
        void main(){vC=pcol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(.1,-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec4 vC;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vC.rgb,vC.a*smoothstep(.5,.08,d));}`,
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c: THREE.Color, a: number, g: number, drag: number) {
    const i = this.i;
    this.i = (i + 1) % this.max;
    if (this.life[i] <= 0) this.live++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = c.r; this.col[i4 + 1] = c.g; this.col[i4 + 2] = c.b; this.col[i4 + 3] = a;
    this.life[i] = this.ml[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a; this.g[i] = g; this.drag[i] = drag;
  }

  update(dt: number) {
    if (this.live === 0) {
      if (this.dirty) this.upload();
      this.dirty = false;
      return;
    }
    const { pos, vel, life, ml, size, col } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; this.live--; continue; }
      const t = 1 - life[i] / ml[i], dr = 1 - this.drag[i] * dt, i3 = i * 3;
      vel[i3] *= dr;
      vel[i3 + 1] = vel[i3 + 1] * dr - this.g[i] * dt;
      vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      col[i * 4 + 3] = this.a0[i] * (1 - t * t);
    }
    this.upload();
    this.dirty = true;
  }

  private upload() {
    const a = this.geo.attributes;
    a.position.needsUpdate = a.pcol.needsUpdate = a.size.needsUpdate = true;
  }
}

export interface BurstOpts {
  n: number;
  speed: number;
  life: number;
  size: [number, number];
  colors: number[];
  gravity?: number;
  drag?: number;
  smoke?: boolean;
  alpha?: number;
}

const _c = new THREE.Color();

export class Particles {
  readonly glow: Pool;
  readonly smoke: Pool;
  amount = 1; // quality multiplier for burst counts

  constructor(scene: THREE.Scene) {
    this.glow = new Pool(scene, 5000, true);
    this.smoke = new Pool(scene, 2500, false);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number, alpha = 1, gravity = 0, drag = 0, smoke = false) {
    (smoke ? this.smoke : this.glow).spawn(x, y, z, vx, vy, vz, life, s0, s1, _c.setHex(color), alpha, gravity, drag);
  }

  burst(x: number, y: number, z: number, o: BurstOpts) {
    const pool = o.smoke ? this.smoke : this.glow, n = Math.max(1, Math.round(o.n * this.amount));
    for (let i = 0; i < n; i++) {
      // random direction on a sphere without allocating vectors
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = o.speed * (0.4 + Math.random() * 0.6);
      pool.spawn(x, y, z, r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, o.life * (0.6 + Math.random() * 0.6),
        o.size[0], o.size[1], _c.setHex(o.colors[i % o.colors.length]), o.alpha ?? 1, o.gravity ?? 0, o.drag ?? 1.5);
    }
  }

  /** Particle size depends on viewport pixel height; call before rendering each view. */
  setScale(pixelHeight: number) {
    this.glow.mat.uniforms.uScale.value = this.smoke.mat.uniforms.uScale.value = pixelHeight * 0.87;
  }

  update(dt: number) {
    this.glow.update(dt);
    this.smoke.update(dt);
  }
}
