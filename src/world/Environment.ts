// Sky, sun, fog, water, clouds, stars, rain/snow and lightning.
// Time of day can stand still or cycle; weather can be fixed or change every few minutes.
// Rain/snow and water waves animate on the GPU, clouds are one instanced draw call.
import * as THREE from 'three';
import { DAY_LENGTH, QUALITY, SKY_KEYS, TIME_HOURS, WEATHER_CHANGE, WEATHER_DEFS, WEATHER_GRIP, WORLD, type QualityName } from '../config';
import type { TimeOfDay, Weather } from '../../shared/protocol';
import { M } from '../entities/assets';
import { clamp, damp, lerp, PI } from '../utils/math';

type FixedWeather = Exclude<Weather, 'dynamic'>;
const DYNAMIC_POOL: FixedWeather[] = ['clear', 'clear', 'cloudy', 'rain', 'fog', 'storm', 'snow'];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

function precipitation(count: number, size: number, color: number, speed: number, drift: number, streak: number) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 80;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(color) }, uScale: { value: 600 } },
    // particles fall and wrap inside a 80x40x80 box that follows the camera
    vertexShader: `uniform float uTime;uniform float uAmount;uniform float uScale;varying float vA;
      void main(){vec3 p=position;p.y=mod(p.y-uTime*${speed.toFixed(1)},40.)-20.;
      p.x=mod(p.x+sin(uTime*.7+position.z)*${drift.toFixed(2)}+40.,80.)-40.;
      vA=step(fract(position.x*12.9898+position.z*78.233),uAmount);
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=min(${size.toFixed(2)}*uScale/max(1.,-mv.z),48.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 uColor;varying float vA;void main(){vec2 c=gl_PointCoord-.5;
      float d=${streak > 0 ? 'abs(c.x)*10.+abs(c.y)*1.2' : 'length(c)*2.'};if(d>1.||vA<.5)discard;gl_FragColor=vec4(uColor,(1.-d)*.55);}`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff0d8, 1.15);
  readonly hemi = new THREE.HemisphereLight(0xcfeaff, 0x5a7a40, 0.62);
  readonly boomLight = new THREE.PointLight(0xff8a3a, 0, 40, 2);
  hour: number;
  night = 0; // 0 = full day, 1 = full night
  weather: FixedWeather;
  onThunder: (() => void) | null = null;

  private sky = new THREE.Color();
  private fog: THREE.Fog;
  private fogFarBase: number;
  private water: THREE.Mesh;
  private time = { value: 0 };
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshStandardMaterial;
  private cloudData: { x: number; y: number; z: number; v: number; puffs: number[] }[] = [];
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private rain: ReturnType<typeof precipitation>;
  private snow: ReturnType<typeof precipitation>;
  private mix = { rain: 0, snow: 0, fog: 1, dark: 0, clouds: 0.6 };
  private flash = 0;
  private nextBolt = 6;
  private weatherT = WEATHER_CHANGE;
  private _m = new THREE.Matrix4();

  constructor(scene: THREE.Scene, quality: QualityName, private timeMode: TimeOfDay = 'day', private weatherMode: Weather = 'clear') {
    this.hour = timeMode === 'cycle' ? 10 : TIME_HOURS[timeMode];
    this.weather = weatherMode === 'dynamic' ? 'clear' : weatherMode;
    const w = WEATHER_DEFS[this.weather];
    Object.assign(this.mix, { rain: w.rain, snow: w.snow, fog: w.fogFar, dark: w.dark, clouds: w.clouds });

    this.fogFarBase = QUALITY[quality].fogFar;
    this.fog = new THREE.Fog(0x9fd6f2, WORLD.fogNear, this.fogFarBase);
    scene.fog = this.fog;
    scene.background = this.sky;
    scene.add(this.hemi);
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
    this.cloudMat = M(0xffffff, { roughness: 1 });
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMat, WORLD.clouds * puffsPer);
    for (let i = 0; i < WORLD.clouds; i++) {
      const n = 3 + Math.floor(Math.random() * 4), puffs: number[] = [];
      for (let j = 0; j < puffsPer; j++)
        puffs.push(j < n ? j * 3.5 - n * 1.7 : 0, Math.random() * 1.5, (Math.random() - 0.5) * 3, j < n ? 3 + Math.random() * 2.5 : 0);
      this.cloudData.push({ x: (Math.random() - 0.5) * 520, y: 60 + Math.random() * 25, z: (Math.random() - 0.5) * 520, v: 2 + Math.random() * 3, puffs });
    }
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const u = Math.random(), th = Math.random() * PI * 2, r = Math.sqrt(1 - u * u);
      sp.set([Math.cos(th) * r * 700, u * 700 + 20, Math.sin(th) * r * 700], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.rain = precipitation(6000, 0.42, 0xbfd8ff, 26, 0.3, 1);
    this.snow = precipitation(3500, 0.55, 0xffffff, 3.2, 2.5, 0);
    scene.add(this.rain.pts, this.snow.pts);
    this.applySky(0);
  }

  setQuality(q: QualityName) {
    const Q = QUALITY[q];
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
    const sh = this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null };
    sh.map?.dispose();
    sh.map = null; // three.js recreates it at the new size
    this.fogFarBase = Q.fogFar;
  }

  /** Grip multiplier from the road surface (wet/snowy). */
  get grip() {
    return lerp(1, WEATHER_GRIP.rain, this.mix.rain) * lerp(1, WEATHER_GRIP.snow, this.mix.snow);
  }

  get label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${WEATHER_DEFS[this.weather].label}`;
  }

  /** Point the sun's shadow box at a player and move rain/stars with their camera before rendering their view. */
  beforeRender(x: number, y: number, z: number, cam: THREE.Camera, pixelHeight: number) {
    const a = ((this.hour - 6) / 12) * PI, el = Math.max(0.25, Math.sin(a)); // sun arc; moon stays high at night
    const dir = this.night > 0.5 ? 1 : Math.cos(a);
    this.sun.position.set(x + dir * 70, y + 90 * el + 10, z + 30);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
    this.rain.pts.position.copy(cam.position);
    this.snow.pts.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.rain.mat.uniforms.uScale.value = this.snow.mat.uniforms.uScale.value = pixelHeight * 0.6;
  }

  private applySky(dt: number) {
    const h = ((this.hour % 24) + 24) % 24;
    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
    const A = SKY_KEYS[i], B = SKY_KEYS[i + 1], t = clamp((h - A.h) / (B.h - A.h), 0, 1);
    const dark = this.mix.dark, k = dt ? damp(dt, 2) : 1;
    _c1.setHex(A.sky).lerp(_c2.setHex(B.sky), t).lerp(_c2.setHex(0x55606e), dark * 0.7);
    this.sky.lerp(_c1, k);
    this.fog.color.copy(this.sky);
    this.sun.color.setHex(A.sun).lerp(_c2.setHex(B.sun), t);
    this.sun.intensity = lerp(A.sunI, B.sunI, t) * (1 - dark * 0.6);
    this.hemi.groundColor.setHex(A.ground).lerp(_c2.setHex(B.ground), t);
    this.hemi.color.copy(this.sky).lerp(_c2.setHex(0xffffff), 0.35);
    this.hemi.intensity = lerp(A.hemi, B.hemi, t) * (1 - dark * 0.35) + this.flash * 2.5;
    this.night = clamp(1 - (lerp(A.sunI, B.sunI, t) - 0.12) / 0.6, 0, 1);
    this.starMat.opacity = this.night * (1 - this.mix.clouds * 0.6);
    this.fog.far = this.fogFarBase * this.mix.fog * (1 - this.night * 0.25);
    this.fog.near = Math.min(WORLD.fogNear, this.fog.far * 0.45);
    this.cloudMat.color.copy(this.sky).lerp(_c2.setHex(0xffffff), 0.6 - dark * 0.4);
  }

  update(dt: number, t: number, fx: number, fz: number) {
    this.time.value = t;
    if (this.timeMode === 'cycle') this.hour = (this.hour + (dt * 24) / DAY_LENGTH) % 24;
    if (this.weatherMode === 'dynamic') {
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        this.weatherT = WEATHER_CHANGE * (0.7 + Math.random() * 0.6);
        const opts = DYNAMIC_POOL.filter((w) => w !== this.weather);
        this.weather = opts[Math.floor(Math.random() * opts.length)];
      }
    }
    // blend towards the current weather so changes roll in smoothly
    const W = WEATHER_DEFS[this.weather], k = damp(dt, 0.25);
    this.mix.rain = lerp(this.mix.rain, W.rain, k);
    this.mix.snow = lerp(this.mix.snow, W.snow, k);
    this.mix.fog = lerp(this.mix.fog, W.fogFar, k);
    this.mix.dark = lerp(this.mix.dark, W.dark, k);
    this.mix.clouds = lerp(this.mix.clouds, W.clouds, k);
    this.rain.mat.uniforms.uTime.value = this.snow.mat.uniforms.uTime.value = t;
    this.rain.mat.uniforms.uAmount.value = this.mix.rain;
    this.snow.mat.uniforms.uAmount.value = this.mix.snow;
    this.rain.pts.visible = this.mix.rain > 0.02;
    this.snow.pts.visible = this.mix.snow > 0.02;
    if (W.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 10;
        this.flash = 1;
        setTimeout(() => this.onThunder?.(), 300 + Math.random() * 900);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.applySky(dt);

    this.water.position.set(Math.round(fx / 10) * 10, 0, Math.round(fz / 10) * 10);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 25);
    let n = 0;
    const visible = Math.round(this.cloudData.length * Math.min(1, 0.4 + this.mix.clouds * 0.6));
    for (let ci = 0; ci < this.cloudData.length; ci++) {
      const c = this.cloudData[ci];
      c.x += c.v * dt;
      if (c.x - fx > 260) c.x -= 520;
      if (c.x - fx < -260) c.x += 520;
      if (c.z - fz > 260) c.z -= 520;
      if (c.z - fz < -260) c.z += 520;
      for (let j = 0; j < c.puffs.length; j += 4) {
        const s = ci < visible ? c.puffs[j + 3] * (1 + this.mix.dark * 0.4) : 0;
        this._m.makeScale(s, s * 0.8, s).setPosition(c.x + c.puffs[j], c.y + c.puffs[j + 1] - this.mix.dark * 12, c.z + c.puffs[j + 2]);
        this.clouds.setMatrixAt(n++, this._m);
      }
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }
}
