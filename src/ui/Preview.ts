// Menu previews: a spinning 3D rider+bike in your colours, and a top-down map of the world/track you're about to play.
import * as THREE from 'three';
import { buildRider, nameTag, seatRider } from '../entities/models';
import { buildVehicleModel } from '../entities/vehicleModels';
import { vehicleById } from '../data/vehicles';
import { DriftTrack, DRIFT_TRACKS, type DriftTrackId } from '../world/DriftTrack';
import { F1Track, F1_TRACKS, type F1TrackId } from '../world/F1Track';
import { canvasTex } from '../entities/assets';
import { Noise } from '../utils/noise';
import { Circuit, GridRoads } from '../world/layout';
import { Terrain } from '../world/Terrain';
import { GEN, POI_KINDS, RACE, TRACKS } from '../config';
import type { LobbySettings } from '../../shared/protocol';
import { TAU } from '../utils/math';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: THREE.Group | null = null;
  private color = -1;
  private raf = 0;
  private drag: number | null = null;
  private angle = 0.6;
  private spin = 0.5;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'char-preview';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene.add(new THREE.HemisphereLight(0xdff2ff, 0x334455, 0.8));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.1);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb8ff, 0.6);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.9 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.camera.position.set(0, 2.4, 7.2);
    this.camera.lookAt(0, 1.2, 0);
    // drag to rotate the bike
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.angle += (e.clientX - this.drag) * 0.012;
      this.drag = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; this.spin = 0.5; });
  }

  private vehicle = '';
  /** Show a vehicle in the player's colour (bikes get the rider, cars have their own driver). */
  setLook(vehicle: string, color: number) {
    if (color === this.color && vehicle === this.vehicle) return;
    this.color = color;
    this.vehicle = vehicle;
    if (this.model) this.scene.remove(this.model);
    const def = vehicleById(vehicle), b = buildVehicleModel(def.id, color), r = buildRider(color);
    seatRider(r, b);
    r.root.visible = def.kind === 'bike';
    this.model = b.root;
    this.scene.add(b.root);
    // frame bikes and longer cars equally
    this.camera.position.set(0, def.kind === 'car' ? 2.8 : 2.4, def.kind === 'car' ? 8.6 : 7.2);
    this.camera.lookAt(0, def.kind === 'car' ? 0.8 : 1.2, 0);
  }

  /** Put the canvas into a placeholder element and start the render loop. */
  mount(host: HTMLElement) {
    host.appendChild(this.canvas);
    const w = host.clientWidth || 280, h = host.clientHeight || 220;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.raf) {
      let last = performance.now();
      const loop = (now: number) => {
        this.raf = requestAnimationFrame(loop);
        if (!this.canvas.isConnected) { cancelAnimationFrame(this.raf); this.raf = 0; return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (this.drag === null) this.angle += dt * this.spin;
        if (this.model) {
          this.model.rotation.y = this.angle;
          this.model.position.y = Math.sin(now / 600) * 0.03;
        }
        this.renderer.render(this.scene, this.camera);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }
}

/** Named drift venues have a fixed seed so everyone gets the same layout; 'random' uses the session seed. */
export const driftSeed = (id: string, seed: number) => (id === 'random' ? seed : 9000 + DRIFT_TRACKS.findIndex((t) => t.id === id));

export interface MapInfo { lengthKm: number | null; climb: number; seed: number }

/** Draw a top-down terrain map of a world or circuit onto a canvas. Returns stats for the info line. */
export function drawMapPreview(canvas: HTMLCanvasElement, s: LobbySettings): MapInfo {
  const track = TRACKS.find((t) => t.id === s.trackId), dtrack = DRIFT_TRACKS.find((t) => t.id === s.trackId);
  const seed = s.mode === 'race' ? (s.trackId === 'random' || !track ? s.seed : track.seed) : s.mode === 'drift' ? driftSeed(s.trackId, s.seed) : s.seed;
  const theme = s.mode === 'race' && track && s.trackId !== 'random' ? track.theme : s.mode === 'drift' && dtrack && s.trackId !== 'random' ? dtrack.theme : s.theme;
  const noise = new Noise(seed);
  const layout = s.mode === 'race' ? new Circuit(noise, seed)
    : s.mode === 'drift' ? new DriftTrack(noise, (dtrack?.id ?? 'docks') as DriftTrackId, seed)
    : s.mode === 'f1' ? new F1Track(noise, (F1_TRACKS.find((t) => t.id === s.trackId)?.id ?? 'monza') as F1TrackId)
    : new GridRoads(noise, seed, s.gen.roads, GEN.poi[s.gen.poi].chance);
  const T = new Terrain(noise, layout, theme, s.gen);
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d')!;
  let cx = 0, cz = 0, span = 700;
  if (layout instanceof Circuit || layout instanceof DriftTrack || layout instanceof F1Track) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < layout.n; i++) {
      minX = Math.min(minX, layout.px[i]); maxX = Math.max(maxX, layout.px[i]);
      minZ = Math.min(minZ, layout.pz[i]); maxZ = Math.max(maxZ, layout.pz[i]);
    }
    cx = (minX + maxX) / 2; cz = (minZ + maxZ) / 2;
    span = Math.max(maxX - minX, maxZ - minZ) * 1.25;
  } else {
    const sp = layout.spawn(0);
    cx = sp.x; cz = sp.z;
  }
  const res = 4, img = ctx.createImageData(W, H), col = new THREE.Color();
  let lo = 1e9, hi = -1e9;
  for (let py = 0; py < H; py += res)
    for (let px = 0; px < W; px += res) {
      const x = cx + (px / W - 0.5) * span, z = cz + (py / H - 0.5) * span, y = T.heightAt(x, z);
      if (y < 0.2) col.setHex(0x2b8fc2).lerp(new THREE.Color(0x15486a), Math.min(1, -y / 12));
      else T.colorAt(x, y, z, col).multiplyScalar(0.85 + Math.min(0.3, y / 120));
      if (layout.roadDist(x, z) < 6) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      for (let a = 0; a < res; a++)
        for (let b = 0; b < res; b++) {
          const i = ((py + a) * W + px + b) * 4;
          img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255; img.data[i + 2] = col.b * 255; img.data[i + 3] = 255;
        }
    }
  ctx.putImageData(img, 0, 0);
  const toC = (x: number, z: number): [number, number] => [((x - cx) / span + 0.5) * W, ((z - cz) / span + 0.5) * H];
  ctx.lineCap = ctx.lineJoin = 'round';
  if (layout instanceof Circuit || layout instanceof DriftTrack || layout instanceof F1Track) {
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 7;
    layout.drawRoads(ctx, toC);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 4;
    layout.drawRoads(ctx, toC);
    if (layout instanceof F1Track) {
      // DRS / straight-mode zones in green, the pit lane in yellow beside the main straight
      const seg = (i0: number, i1: number, off: number) => {
        ctx.beginPath();
        for (let k = 0, n = (i1 - i0 + layout.n) % layout.n; k <= n; k += 3) {
          const i = (i0 + k) % layout.n, [a, b] = toC(layout.px[i] + layout.tz[i] * off, layout.pz[i] - layout.tx[i] * off);
          if (k) ctx.lineTo(a, b); else ctx.moveTo(a, b);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = '#39e07a';
      ctx.lineWidth = 3;
      for (const z of layout.drsZones) seg(z.i0, z.i1, 0);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      seg(layout.pit.i0, layout.pit.i1, layout.pit.side * (layout.halfWidth + 12));
    }
    for (let c = 0; c < RACE.checkpoints; c++) {
      const i = Math.round((c / RACE.checkpoints) * layout.n) % layout.n, [a, b] = toC(layout.px[i], layout.pz[i]);
      ctx.fillStyle = c === 0 ? '#ffd23f' : '#3cc8ff';
      ctx.beginPath();
      ctx.arc(a, b, c === 0 ? 7 : 4.5, 0, TAU);
      ctx.fill();
    }
    const [a, b] = toC(layout.px[0], layout.pz[0]);
    ctx.font = 'bold 13px system-ui';
    ctx.fillStyle = '#fff';
    ctx.fillText('🏁 START', a + 9, b - 8);
  } else {
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 3;
    layout.drawRoads(ctx, toC, cx, cz, span / 2);
    // landmarks
    ctx.font = 'bold 11px system-ui';
    for (const poi of layout.pois(cx - span / 2, cz - span / 2, span)) {
      const [a, b] = toC(poi.x, poi.z), def = POI_KINDS.find((k) => k.kind === poi.kind)!;
      ctx.fillStyle = def.color;
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(a - 5, b - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
    }
    const [a, b] = toC(cx, cz);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(a, b, 6, 0, TAU);
    ctx.fill();
    ctx.font = 'bold 13px system-ui';
    ctx.fillStyle = '#fff';
    ctx.fillText('YOU START HERE', a + 9, b - 8);
  }
  return { lengthKm: layout instanceof Circuit || layout instanceof DriftTrack || layout instanceof F1Track ? layout.length / 1000 : null, climb: Math.max(0, Math.round(hi - lo)), seed };
}

interface Slot {
  key: string; root: THREE.Group; body: THREE.Group; wheels: THREE.Group[]; tag: THREE.Sprite; bike: boolean; phase: number; lane: number;
  // tiny spring-damper "physics" so each vehicle rides over the road instead of just bobbing
  y: number; vy: number; pitch: number; vp: number; roll: number; vr: number; x: number; vx: number; z: number;
}

const ROAD_LEN = 120;
const SPEED = 16; // m/s the road scrolls past (~58 km/h)

/** Spring-damper step: pulls `v` towards `target`, returns [value, velocity]. */
function spring(v: number, vel: number, target: number, k: number, c: number, dt: number): [number, number] {
  vel += (k * (target - v) - c * vel) * dt;
  return [v + vel * dt, vel];
}

const SKY_VERT = `varying vec3 vP;
void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
void main() {
  float h = vP.y;
  vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(hor, mid, smoothstep(-0.02, 0.12, h));
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * Room lobby lineup: every player's vehicle in their colours, driving side by side down a floodlit dusk road
 * (scrolling asphalt, kerbs, lamp posts, mountains, speed streaks). Suspension, lean, weave and wheel spin
 * are simulated per vehicle. The camera auto-frames the whole grid; drag/swipe to orbit with inertia.
 */
export class LobbyShowcase {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 2, 0.1, 200);
  private slots = new Map<string, Slot>();
  private road: THREE.Texture;
  private kerbTex: THREE.Texture;
  private roadMesh: THREE.Mesh;
  private kerbs: THREE.Mesh[] = [];
  private lamps: THREE.Group[] = [];
  private streaks: THREE.Points;
  private raf = 0;
  private angle = 0;
  private angVel = 0;
  private drag: number | null = null;
  private span = 4;
  private width = 10;
  private resize: ResizeObserver | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lineup';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // dusk sky: gradient dome + matching fog so the far road melts into the horizon
    const FOG = 0x3a3550;
    this.scene.fog = new THREE.Fog(FOG, 30, 95);
    this.scene.background = new THREE.Color(FOG);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { top: { value: new THREE.Color(0x0b1430) }, mid: { value: new THREE.Color(0x3a3a66) }, hor: { value: new THREE.Color(0xf0a070) } },
    }));
    this.scene.add(sky);
    // studio-style reflections on the paintwork
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x2a2030, 0.55));
    const key = new THREE.DirectionalLight(0xffd2a0, 1.1); // low warm sun from behind-right
    key.position.set(8, 9, -6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -18, right: 18, top: 10, bottom: -10, near: 1, far: 40 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6fb8ff, 0.6); // cool rim from the camera side
    fill.position.set(-6, 5, 8);
    this.scene.add(fill);

    // asphalt: speckled grey with lane dashes, scrolls towards the camera
    this.road = canvasTex(128, 512, (g, w, h) => {
      g.fillStyle = '#34383f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgb(${v},${v + 2},${v + 6})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(w * 0.18, 0, w * 0.14, h); g.fillRect(w * 0.68, 0, w * 0.14, h); // tyre-worn tracks
      g.fillStyle = '#efeee0';
      for (let y = 0; y < h; y += 128) g.fillRect(w - 3, y, 3, 64); // lane dash on the tile edge = between vehicles
    });
    this.road.wrapS = this.road.wrapT = THREE.RepeatWrapping;
    this.road.anisotropy = 4;
    this.roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, ROAD_LEN).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.road, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.4 }));
    this.roadMesh.receiveShadow = true;
    this.roadMesh.position.z = -ROAD_LEN / 2 + 14;
    this.scene.add(this.roadMesh);
    // red/white kerbs
    this.kerbTex = canvasTex(16, 64, (g, w, h) => { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#d0262e'; g.fillRect(0, 0, w, h / 2); });
    this.kerbTex.wrapS = this.kerbTex.wrapT = THREE.RepeatWrapping;
    this.kerbTex.repeat.set(1, ROAD_LEN / 2);
    for (let s = 0; s < 2; s++) {
      const k = new THREE.Mesh(new THREE.PlaneGeometry(0.9, ROAD_LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.kerbTex, roughness: 0.6 }));
      k.receiveShadow = true;
      k.position.set(0, 0.01, this.roadMesh.position.z);
      this.kerbs.push(k);
      this.scene.add(k);
    }
    // grass verges either side
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(240, ROAD_LEN + 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 1 }));
    grass.position.set(0, -0.02, this.roadMesh.position.z);
    grass.receiveShadow = true;
    this.scene.add(grass);
    // low-poly mountains on the horizon
    const rock = new THREE.MeshStandardMaterial({ color: 0x2c2a44, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU, r = 70 + Math.random() * 20, h = 10 + Math.random() * 18;
      const m = new THREE.Mesh(new THREE.ConeGeometry(8 + Math.random() * 10, h, 5), rock);
      m.position.set(Math.sin(a) * r, h / 2 - 1, Math.cos(a) * r - 20);
      m.rotation.y = Math.random() * TAU;
      this.scene.add(m);
    }
    // floodlight posts along both sides, recycled as they pass the camera
    const pole = new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.6, roughness: 0.4 });
    const bulb = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group(), p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 6), pole), arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), pole);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulb);
      p.position.y = 3; arm.position.set(0.6, 5.95, 0); b.position.set(1.2, 5.8, 0);
      p.castShadow = true;
      g.add(p, arm, b);
      g.userData.side = i % 2 ? 1 : -1;
      g.position.z = -Math.floor(i / 2) * 15 + 12;
      this.lamps.push(g);
      this.scene.add(g);
    }
    // speed streaks: little light dashes flying past = sense of motion
    const N = 140, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = 0.2 + Math.random() * 5; pos[i * 3 + 2] = -80 + Math.random() * 95; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streaks = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.streaks);
    this.layoutRoad();

    // drag / swipe to orbit with inertia; vertical swipes still scroll the page on phones (touch-action: pan-y)
    this.canvas.style.touchAction = 'pan-y';
    let lastT = 0;
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; lastT = e.timeStamp; this.angVel = 0; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      const d = -(e.clientX - this.drag) * 0.006, dt = Math.max(1, e.timeStamp - lastT) / 1000;
      this.angle += d;
      this.angVel = d / dt;
      this.drag = e.clientX;
      lastT = e.timeStamp;
    });
    const end = () => (this.drag = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /** Size the road, kerbs and lamp rows to the grid width. */
  private layoutRoad() {
    this.width = this.span + 4;
    this.roadMesh.scale.x = this.width;
    this.road.repeat.set(this.width / 3.5, ROAD_LEN / 14);
    this.kerbs.forEach((k, i) => (k.position.x = (i ? 1 : -1) * (this.width / 2 + 0.45)));
    for (const l of this.lamps) {
      l.position.x = l.userData.side * (this.width / 2 + 2.4);
      l.rotation.y = l.userData.side > 0 ? Math.PI : 0; // arms reach over the road
    }
  }

  setPlayers(players: { id: string; name: string; color: number; vehicle: string; host: boolean; ready: boolean }[], you: string) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, s] of this.slots) if (!ids.has(id)) { this.scene.remove(s.root); this.slots.delete(id); }
    const gap = players.some((p) => vehicleById(p.vehicle).kind === 'car') ? 3.9 : 3.1;
    this.span = players.length * gap;
    players.forEach((p, i) => {
      const label = `${p.host ? '👑 ' : ''}${p.name}${p.id === you ? ' (you)' : ''}${p.ready ? ' ✓' : ''}`, key = `${p.color}|${p.vehicle}|${label}`;
      let s = this.slots.get(p.id);
      if (s && s.key !== key) { this.scene.remove(s.root); this.slots.delete(p.id); s = undefined; }
      if (!s) {
        const def = vehicleById(p.vehicle), b = buildVehicleModel(def.id, p.color), r = buildRider(p.color), tag = nameTag(label, p.color);
        const root = new THREE.Group(), body = new THREE.Group();
        seatRider(r, b);
        r.root.visible = def.kind === 'bike';
        b.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        b.root.rotation.y = 0.35; // nose towards the camera with a slight 3/4 angle
        body.add(b.root);
        tag.position.set(0, 3.5, 0);
        tag.scale.set(3.6, 0.9, 1);
        root.add(body, tag);
        this.scene.add(root);
        s = { key, root, body, wheels: b.wheels, tag, bike: def.kind === 'bike', phase: Math.random() * 100, lane: 0, y: 0, vy: 0, pitch: 0, vp: 0, roll: 0, vr: 0, x: 0, vx: 0, z: 0 };
        this.slots.set(p.id, s);
      }
      s.lane = (i - (players.length - 1) / 2) * gap;
      s.z = (i % 2) * -1.6; // staggered grid
    });
    this.layoutRoad();
  }

  mount(host: HTMLElement) {
    host.appendChild(this.canvas);
    const fit = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 220;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    fit();
    // the lobby panel stretches with the window, so keep the 3D view sized to it
    this.resize?.disconnect();
    this.resize = new ResizeObserver(fit);
    this.resize.observe(host);
    if (this.raf) return;
    let last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.canvas.isConnected) { cancelAnimationFrame(this.raf); this.raf = 0; this.resize?.disconnect(); return; }
      const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
      last = now;
      if (document.hidden) return;
      this.step(dt, t);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private step(dt: number, t: number) {
    const move = SPEED * dt;
    // world scrolls towards the camera (+z)
    this.road.offset.y += move / 14;
    this.kerbTex.offset.y += move / 2;
    for (const l of this.lamps) { l.position.z += move; if (l.position.z > 20) l.position.z -= 120; }
    const p = this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { let z = p.getZ(i) + move * 1.6; if (z > 15) z -= 95; p.setZ(i, z); }
    p.needsUpdate = true;

    for (const s of this.slots.values()) {
      const ph = s.phase;
      // road surface: overlapping bump frequencies under the front and rear axles
      const bump = (u: number) => Math.sin(u * 1.7) * 0.02 + Math.sin(u * 4.3 + 1) * 0.012 + Math.max(0, Math.sin(u * 0.37)) ** 12 * 0.06;
      const u = t * SPEED * 0.25 + ph, front = bump(u), rear = bump(u - 0.6);
      [s.y, s.vy] = spring(s.y, s.vy, (front + rear) / 2, 180, 14, dt);
      [s.pitch, s.vp] = spring(s.pitch, s.vp, (front - rear) * 0.9, 160, 12, dt);
      // gentle weave within the lane; bikes lean into it, cars roll out of it
      const tx = Math.sin(t * 0.45 + ph) * 0.45 + Math.sin(t * 0.17 + ph * 2) * 0.25;
      const ax = (tx - s.x) * 6 - s.vx * 3.2;
      s.vx += ax * dt;
      s.x += s.vx * dt;
      [s.roll, s.vr] = spring(s.roll, s.vr, s.bike ? -ax * 0.09 : ax * 0.02, 90, 10, dt);
      s.root.position.set(s.lane + s.x, 0, s.z + Math.sin(t * 0.3 + ph) * 0.6);
      s.body.position.y = s.y;
      s.body.rotation.set(s.pitch, -s.vx * 0.12, s.roll);
      s.wheels.forEach((w) => (w.rotation.x += move / 0.34));
      s.tag.position.y = 3.5 + s.y;
    }

    // camera: inertial orbit while released, slowly drifting back to the hero 3/4 view
    if (this.drag === null) {
      this.angle += this.angVel * dt;
      this.angVel *= Math.exp(-2.5 * dt);
      this.angle += (Math.sin(t * 0.15) * 0.35 - this.angle) * Math.min(1, dt * 0.25);
    }
    this.angle = Math.max(-1.1, Math.min(1.1, this.angle));
    // pull back just far enough that the whole grid (plus name tags) fits the frame, whatever its shape
    const half = this.span / 2 + 1.4, vHalf = Math.tan((this.camera.fov * Math.PI) / 360), hHalf = vHalf * this.camera.aspect;
    const d = Math.max(half / hHalf, 2.7 / vHalf, 6.5) + 1.5, a = this.angle;
    const shake = Math.sin(t * 23) * 0.006 + Math.sin(t * 31) * 0.004;
    this.camera.position.set(Math.sin(a) * d, 2.2 + d * 0.2 + shake, Math.cos(a) * d + 1);
    this.camera.lookAt(0, 1.2, -0.6);
  }
}
