// Menu previews: a spinning 3D rider+bike in your colours, and a top-down map of the world/track you're about to play.
import * as THREE from 'three';
import { buildBike, buildRider, seatRider } from '../entities/models';
import { Noise } from '../utils/noise';
import { Circuit, GridRoads } from '../world/layout';
import { Terrain } from '../world/Terrain';
import { GEN, POI_KINDS, RACE, TRACKS } from '../config';
import type { LobbySettings } from '../../shared/protocol';
import { TAU } from '../utils/math';

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

  setColor(color: number) {
    if (color === this.color) return;
    this.color = color;
    if (this.model) this.scene.remove(this.model);
    const b = buildBike(color), r = buildRider(color);
    seatRider(r, b);
    this.model = b.root;
    this.scene.add(b.root);
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

export interface MapInfo { lengthKm: number | null; climb: number; seed: number }

/** Draw a top-down terrain map of a world or circuit onto a canvas. Returns stats for the info line. */
export function drawMapPreview(canvas: HTMLCanvasElement, s: LobbySettings): MapInfo {
  const track = TRACKS.find((t) => t.id === s.trackId);
  const seed = s.mode === 'race' ? (s.trackId === 'random' || !track ? s.seed : track.seed) : s.seed;
  const theme = s.mode === 'race' && track && s.trackId !== 'random' ? track.theme : s.theme;
  const noise = new Noise(seed);
  const layout = s.mode === 'race' ? new Circuit(noise, seed) : new GridRoads(noise, seed, s.gen.roads, GEN.poi[s.gen.poi].chance);
  const T = new Terrain(noise, layout, theme, s.gen);
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d')!;
  let cx = 0, cz = 0, span = 700;
  if (layout instanceof Circuit) {
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
  if (layout instanceof Circuit) {
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 7;
    layout.drawRoads(ctx, toC);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 4;
    layout.drawRoads(ctx, toC);
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
  return { lengthKm: layout instanceof Circuit ? layout.length / 1000 : null, climb: Math.max(0, Math.round(hi - lo)), seed };
}
