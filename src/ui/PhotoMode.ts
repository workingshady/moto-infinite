// Photo mode: a free orbit/fly camera over the paused world (kept near the rider), FOV, roll, exposure,
// contrast, saturation, filters, frames, watermark and hide-UI; captures a PNG to download or share.
import * as THREE from 'three';
import type { Game, ViewOverride } from '../core/Game';
import type { Viewport } from '../core/Renderer';
import { REPLAY } from '../config';
import { clamp } from '../utils/math';
import { OrbitInput, PadReader, canShareFile, download, shareFile, stamp } from './mediaShare';

type Op = [kind: 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia', amount: number];
const FILTERS = {
  none: { label: 'None', ops: [] as Op[] },
  vivid: { label: 'Vivid', ops: [['saturate', 1.45], ['contrast', 1.12]] as Op[] },
  bw: { label: 'B&W', ops: [['grayscale', 1], ['contrast', 1.15]] as Op[] },
  sepia: { label: 'Sepia', ops: [['sepia', 0.85], ['contrast', 1.05]] as Op[] },
  film: { label: 'Film', ops: [['sepia', 0.22], ['contrast', 1.12], ['saturate', 0.85]] as Op[] },
};
type FilterId = keyof typeof FILTERS;
const FRAMES = { none: 'None', cinema: 'Cinema', border: 'Border' } as const;
type FrameId = keyof typeof FRAMES;
const SLIDERS = [
  ['fov', 'FOV', 15, 100, 1],
  ['roll', 'Roll', -45, 45, 1],
  ['exposure', 'Exposure', 0.4, 1.8, 0.05],
  ['contrast', 'Contrast', 0.5, 1.6, 0.05],
  ['saturation', 'Saturation', 0, 2, 0.05],
] as const;
type SliderKey = (typeof SLIDERS)[number][0];

export class PhotoMode implements ViewOverride {
  readonly root: HTMLDivElement;
  private cam = new THREE.PerspectiveCamera(50, 1, 0.3, 900);
  private pivot = new THREE.Vector3();
  private home = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0.25;
  private dist = 8;
  private set: Record<SliderKey, number> = { fov: 50, roll: 0, exposure: 1, contrast: 1, saturation: 1 };
  private filter: FilterId = 'none';
  private frame: FrameId = 'none';
  private mark = true;
  private uiHidden = false;
  private shoot = false;
  private shot: Blob | null = null;
  private shotUrl = '';
  private keys = new Set<string>();
  private vp: Viewport = { x: 0, y: 0, w: 1, h: 1 };
  private orbitIn: OrbitInput;
  private pad = new PadReader();
  private canvas: HTMLCanvasElement;

  constructor(private game: Game, private onExit: () => void) {
    const p = game.players[0];
    this.canvas = game.renderer.gl.domElement;
    if (p) {
      this.pivot.set(p.P.x, p.P.y + 1, p.P.z);
      const c = p.camera.position;
      this.dist = clamp(Math.hypot(c.x - this.pivot.x, c.y - this.pivot.y, c.z - this.pivot.z), 3, REPLAY.photoOrbitMax);
      this.yaw = Math.atan2(c.x - this.pivot.x, c.z - this.pivot.z);
      this.pitch = clamp(Math.asin(clamp((c.y - this.pivot.y) / this.dist, -1, 1)), -0.3, 1.45);
    }
    this.home.copy(this.pivot);
    this.root = document.createElement('div');
    this.root.id = 'photo';
    this.root.className = 'ph';
    this.root.innerHTML = this.html();
    document.body.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    // touch fly pad: hold a button = hold the key
    this.root.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => {
      const code = b.dataset.m!;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.keys.add(code); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.keys.delete(code));
    });
    this.orbitIn = new OrbitInput(this.canvas);
    addEventListener('keydown', this.onKey, true);
    addEventListener('keyup', this.onKeyUp, true);
    addEventListener('blur', this.onBlur);
    this.applyLook();
  }

  private html() {
    return `
      <div class="ph-overlay"><div class="ph-vignette"></div><div class="ph-bars"></div><div class="ph-mark">MOTO<span>INFINITE</span></div></div>
      <div class="ph-panel">
        <div class="ph-head"><b>📷 Photo mode</b><button class="rp-btn rp-exit" data-a="exit">✕ Exit</button></div>
        ${SLIDERS.map(([k, l, min, max, step]) => `<label class="ph-row"><span>${l}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${this.set[k]}" data-k="${k}"><em data-v="${k}">${this.set[k]}</em></label>`).join('')}
        <div class="ph-row"><span>Filter</span><div class="chips">${(Object.keys(FILTERS) as FilterId[]).map((f) => `<button class="chip ${f === this.filter ? 'on' : ''}" data-filter="${f}">${FILTERS[f].label}</button>`).join('')}</div></div>
        <div class="ph-row"><span>Frame</span><div class="chips">${(Object.keys(FRAMES) as FrameId[]).map((f) => `<button class="chip ${f === this.frame ? 'on' : ''}" data-frame="${f}">${FRAMES[f]}</button>`).join('')}</div></div>
        <div class="ph-row"><span>Logo</span><div class="chips"><button class="chip ${this.mark ? 'on' : ''}" data-a="mark">Watermark</button><button class="chip" data-a="reset">Reset camera</button></div></div>
        <div class="ph-actions">
          <button class="btn" data-a="hide">👁 Hide UI</button>
          <button class="btn primary" data-a="shoot">📸 Capture</button>
        </div>
        <p class="ph-keys">Drag orbit · wheel/pinch zoom · WASD/arrows fly · Q/E down/up · Z/X roll · −/= FOV · H hide · Enter capture · Esc exit · 🎮 sticks move/orbit · LT/RT height · LB/RB roll · A capture · Y hide · B exit</p>
      </div>
      <div class="ph-move">
        <button data-m="KeyW">▲</button><button data-m="KeyA">◀</button><button data-m="KeyS">▼</button><button data-m="KeyD">▶</button>
        <button data-m="KeyE">⤒</button><button data-m="KeyQ">⤓</button>
      </div>
      <button class="ph-snap" data-a="shoot" aria-label="Capture">📸</button>
      <button class="rp-show" data-a="hide">👁 Show UI</button>
      <div class="ph-sheet" hidden></div>`;
  }

  // ---------------------------------------------------------------- input
  private onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.filter) { this.filter = d.filter as FilterId; this.chipOn('filter', d.filter); return this.applyLook(); }
    if (d.frame) { this.frame = d.frame as FrameId; this.chipOn('frame', d.frame); return this.applyLook(); }
    switch (d.a) {
      case 'exit': return this.onExit();
      case 'hide': return this.toggleUi();
      case 'shoot': this.shoot = true; return;
      case 'mark': this.mark = !this.mark; b.classList.toggle('on', this.mark); return this.applyLook();
      case 'reset': this.pivot.copy(this.home); this.set.roll = 0; this.syncSliders(); return;
      case 'dl': if (this.shot) download(this.shot, `moto-infinite-${stamp()}.png`); return;
      case 'share': if (this.shot) void shareFile(this.shot, `moto-infinite-${stamp()}.png`, 'Shot in Moto Infinite'); return;
      case 'closeShot': return this.closeShot();
    }
  };

  private onInput = (e: Event) => {
    const t = e.target as HTMLInputElement, k = t.dataset.k as SliderKey | undefined;
    if (!k) return;
    this.set[k] = +t.value;
    this.syncSliders();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.code !== 'Escape') return;
    e.stopPropagation();
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Escape': case 'Backspace': e.preventDefault(); return this.shot ? this.closeShot() : this.onExit();
      case 'Enter': case 'KeyP': e.preventDefault(); this.shoot = true; return;
      case 'KeyH': return this.toggleUi();
      case 'Space': case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); return;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onBlur = () => this.keys.clear();

  private chipOn(attr: string, v: string) {
    this.root.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === v));
  }

  private syncSliders() {
    for (const [k] of SLIDERS) {
      const inp = this.root.querySelector<HTMLInputElement>(`[data-k="${k}"]`), out = this.root.querySelector<HTMLElement>(`[data-v="${k}"]`);
      if (inp && +inp.value !== this.set[k]) inp.value = String(this.set[k]);
      if (out) out.textContent = k === 'fov' || k === 'roll' ? `${Math.round(this.set[k])}°` : this.set[k].toFixed(2);
    }
    this.applyLook();
  }

  private toggleUi() {
    this.uiHidden = !this.uiHidden;
    this.root.classList.toggle('ph-hidden', this.uiHidden);
  }

  /** Every colour step as one list: drives the live CSS filter and the captured PNG alike. */
  private ops(): Op[] {
    const s = this.set;
    return [['brightness', s.exposure], ['contrast', s.contrast], ['saturate', s.saturation], ...FILTERS[this.filter].ops];
  }

  private applyLook() {
    const css = this.ops().filter(([k, v]) => !(v === 1 && (k === 'brightness' || k === 'contrast' || k === 'saturate'))).map(([k, v]) => `${k}(${v})`).join(' ');
    this.canvas.style.filter = css;
    this.root.dataset.frame = this.frame;
    this.root.classList.toggle('ph-film', this.filter === 'film');
    this.root.classList.toggle('ph-marked', this.mark);
  }

  // ---------------------------------------------------------------- per frame
  render(dt: number) {
    const g = this.game, r = g.renderer, c = this.cam, T = g.terrain;
    this.move(dt);
    const cp = Math.cos(this.pitch);
    c.position.set(this.pivot.x + Math.sin(this.yaw) * cp * this.dist, this.pivot.y + Math.sin(this.pitch) * this.dist, this.pivot.z + Math.cos(this.yaw) * cp * this.dist);
    c.position.y = Math.max(c.position.y, T.groundAt(c.position.x, c.position.z) + 0.3);
    c.up.set(0, 1, 0);
    c.lookAt(this.pivot);
    c.rotateZ((this.set.roll * Math.PI) / 180);
    c.fov = this.set.fov;
    const vp = this.vp;
    vp.w = innerWidth;
    vp.h = innerHeight;
    c.aspect = vp.w / vp.h;
    c.updateProjectionMatrix();
    g.env.beforeRender(this.pivot.x, this.pivot.y, this.pivot.z, c, r.pixelHeight(vp));
    g.fx.setScale(r.pixelHeight(vp));
    r.render(g.scene, c, vp, false);
    if (this.shoot) { this.shoot = false; this.capture(); } // read the drawing buffer right after rendering it
  }

  private move(dt: number) {
    const k = this.keys, p = this.pad, o = this.orbitIn, T = this.game.terrain;
    p.poll();
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let up = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    let roll = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);
    let fov = (k.has('Equal') || k.has('NumpadAdd') ? 1 : 0) - (k.has('Minus') || k.has('NumpadSubtract') ? 1 : 0);
    if (p.pad) {
      fwd -= p.axis(1);
      side += p.axis(0);
      this.yaw -= p.axis(2) * dt * 2.2;
      this.pitch = clamp(this.pitch + p.axis(3) * dt * 1.4, -0.3, 1.45);
      up += p.value(7) - p.value(6);
      roll += (p.held(5) ? 1 : 0) - (p.held(4) ? 1 : 0);
      fov += (p.held(13) ? 1 : 0) - (p.held(12) ? 1 : 0);
      if (p.hit(0)) this.shoot = true;
      if (p.hit(3)) this.toggleUi();
      if (p.hit(1)) { if (this.shot) this.closeShot(); else this.onExit(); return; }
    }
    this.yaw -= o.dx * 0.008;
    this.pitch = clamp(this.pitch + o.dy * 0.006, -0.3, 1.45);
    this.dist = clamp(this.dist * o.zoom, REPLAY.photoMinDist, REPLAY.photoOrbitMax);
    if (o.tapped && this.uiHidden) this.toggleUi();
    o.clear();
    if (fwd || side || up) {
      // fly relative to where the camera looks (forward = from camera towards the pivot)
      const sp = 9 * dt, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      this.pivot.x += (fx * fwd - fz * side) * sp;
      this.pivot.z += (fz * fwd + fx * side) * sp;
      this.pivot.y += up * sp;
      const dx = this.pivot.x - this.home.x, dz = this.pivot.z - this.home.z, d = Math.hypot(dx, dz), max = REPLAY.photoMaxDist;
      if (d > max) { this.pivot.x = this.home.x + (dx / d) * max; this.pivot.z = this.home.z + (dz / d) * max; }
      const gy = T.groundAt(this.pivot.x, this.pivot.z);
      this.pivot.y = clamp(this.pivot.y, gy + 0.3, gy + 25);
    }
    if (roll || fov) {
      this.set.roll = clamp(this.set.roll + roll * dt * 30, -45, 45);
      this.set.fov = clamp(this.set.fov + fov * dt * 25, 15, 100);
      this.syncSliders();
    }
  }

  // ---------------------------------------------------------------- capture
  private capture() {
    const src = this.canvas, W = src.width, H = src.height, out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    const ops = this.ops(), css = ops.map(([k, v]) => `${k}(${v})`).join(' ');
    const native = 'filter' in ctx;
    if (native) ctx.filter = css;
    ctx.drawImage(src, 0, 0);
    if (native) ctx.filter = 'none';
    else applyOps(ctx, W, H, ops);
    if (this.filter === 'film') {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.06;
      for (let i = 0; i < (W * H) / 220; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    if (this.frame === 'cinema') {
      const bar = Math.max(0, (H - W / 2.39) / 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    } else if (this.frame === 'border') {
      const b = Math.round(Math.min(W, H) * 0.035);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(0, 0, W, b);
      ctx.fillRect(0, H - b * 2.2, W, b * 2.2);
      ctx.fillRect(0, 0, b, H);
      ctx.fillRect(W - b, 0, b, H);
    }
    if (this.mark) {
      const s = Math.round(Math.min(W, H) * 0.032), pad = Math.round(s * 0.9);
      const y = H - pad - (this.frame === 'cinema' ? Math.max(0, (H - W / 2.39) / 2) : this.frame === 'border' ? Math.min(W, H) * 0.035 * 1.2 : 0);
      ctx.font = `900 italic ${s}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = s * 0.3;
      const w2 = ctx.measureText('INFINITE').width;
      ctx.fillStyle = this.frame === 'border' ? '#1b1f2a' : '#ffffff';
      ctx.fillText('MOTO', W - pad - w2 - s * 0.3, y);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('INFINITE', W - pad, y);
      ctx.shadowBlur = 0;
    }
    this.root.classList.add('ph-flash');
    setTimeout(() => this.root.classList.remove('ph-flash'), 180);
    out.toBlob((blob) => { if (blob && this.root.isConnected) this.showShot(blob); }, 'image/png');
  }

  private showShot(blob: Blob) {
    this.closeShot();
    this.shot = blob;
    this.shotUrl = URL.createObjectURL(blob);
    const sh = this.root.querySelector<HTMLElement>('.ph-sheet')!;
    sh.innerHTML = `<img src="${this.shotUrl}" alt="Your shot">
      <div class="ph-actions"><button class="btn primary" data-a="dl">⬇ Save PNG</button>
      ${canShareFile('image/png') ? '<button class="btn" data-a="share">📤 Share</button>' : ''}
      <button class="btn ghost" data-a="closeShot">Back</button></div>`;
    sh.hidden = false;
  }

  private closeShot() {
    if (this.shotUrl) URL.revokeObjectURL(this.shotUrl);
    this.shotUrl = '';
    this.shot = null;
    const sh = this.root.querySelector<HTMLElement>('.ph-sheet');
    if (sh) { sh.hidden = true; sh.innerHTML = ''; }
  }

  dispose() {
    this.closeShot();
    this.canvas.style.filter = '';
    this.orbitIn.dispose();
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('keyup', this.onKeyUp, true);
    removeEventListener('blur', this.onBlur);
    this.root.remove();
  }
}

/** CPU fallback for browsers without CanvasRenderingContext2D.filter (same maths as the CSS filters). */
function applyOps(ctx: CanvasRenderingContext2D, W: number, H: number, ops: Op[]) {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    for (const [k, v] of ops) {
      if (k === 'brightness') { r *= v; g *= v; b *= v; }
      else if (k === 'contrast') { r = (r - 128) * v + 128; g = (g - 128) * v + 128; b = (b - 128) * v + 128; }
      else if (k === 'saturate' || k === 'grayscale') {
        const s = k === 'saturate' ? v : 1 - v, l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
      } else {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * v; g += (sg - g) * v; b += (sb - b) * v;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}
