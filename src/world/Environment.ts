import * as THREE from 'three';
import { QUALITY, WORLD, type QualityName } from '../config';
import { M } from '../entities/assets';
import { PI } from '../utils/math';

const SKY = 0x9fd6f2;

/** Lights, sky, fog, water and clouds. Water waves run on the GPU; clouds are one instanced draw call. */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff0d8, 1.15);
  readonly boomLight = new THREE.PointLight(0xff8a3a, 0, 40, 2);
  private water: THREE.Mesh;
  private time = { value: 0 };
  private clouds: THREE.InstancedMesh;
  private cloudData: { x: number; y: number; z: number; v: number; puffs: number[] }[] = [];
  private _m = new THREE.Matrix4();

  constructor(private scene: THREE.Scene, quality: QualityName) {
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, WORLD.fogNear, QUALITY[quality].fogFar);
    scene.add(new THREE.HemisphereLight(0xcfeaff, 0x5a7a40, 0.62));
    const s = this.sun;
    s.castShadow = true;
    Object.assign(s.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
    s.shadow.bias = -0.0006;
    scene.add(s, s.target, this.boomLight);
    this.setQuality(quality);

    const geo = new THREE.PlaneGeometry(WORLD.waterSize, WORLD.waterSize, WORLD.waterSeg, WORLD.waterSeg);
    geo.rotateX(-PI / 2);
    const mat = M(0x2b8fc2, { transparent: true, opacity: 0.8, roughness: 0.2, metalness: 0.1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wpW = modelMatrix * vec4(position, 1.0);
        transformed.y += sin(wpW.x * .08 + uTime) * .22 + cos(wpW.z * .1 + uTime * 1.3) * .22;`,
      );
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    scene.add(this.water);

    const puffsPer = 6;
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M(0xffffff, { roughness: 1 }), WORLD.clouds * puffsPer);
    for (let i = 0; i < WORLD.clouds; i++) {
      const n = 3 + Math.floor(Math.random() * 4), puffs: number[] = [];
      for (let j = 0; j < puffsPer; j++)
        puffs.push(j < n ? j * 3.5 - n * 1.7 : 0, Math.random() * 1.5, (Math.random() - 0.5) * 3, j < n ? 3 + Math.random() * 2.5 : 0);
      this.cloudData.push({ x: (Math.random() - 0.5) * 520, y: 60 + Math.random() * 25, z: (Math.random() - 0.5) * 520, v: 2 + Math.random() * 3, puffs });
    }
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  }

  setQuality(q: QualityName) {
    const Q = QUALITY[q];
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
    // drop the old shadow map so three.js recreates it at the new size
    const sh = this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null };
    sh.map?.dispose();
    sh.map = null;
    (this.scene.fog as THREE.Fog).far = Q.fogFar;
  }

  /** Point the sun's shadow box at a player before rendering their view. */
  aimSun(x: number, y: number, z: number) {
    this.sun.position.set(x + 50, y + 90, z + 30);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
  }

  update(dt: number, t: number, fx: number, fz: number) {
    this.time.value = t;
    this.water.position.set(Math.round(fx / 10) * 10, 0, Math.round(fz / 10) * 10);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 25);
    let k = 0;
    for (const c of this.cloudData) {
      c.x += c.v * dt;
      if (c.x - fx > 260) c.x -= 520;
      if (c.x - fx < -260) c.x += 520;
      if (c.z - fz > 260) c.z -= 520;
      if (c.z - fz < -260) c.z += 520;
      for (let j = 0; j < c.puffs.length; j += 4) {
        const s = c.puffs[j + 3];
        this._m.makeScale(s, s, s).setPosition(c.x + c.puffs[j], c.y + c.puffs[j + 1], c.z + c.puffs[j + 2]);
        this.clouds.setMatrixAt(k++, this._m);
      }
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }
}
