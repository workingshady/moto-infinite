// Replay playback: one full-screen view over the frozen world with TV/trackside, chase, orbit, onboard and
// helicopter cameras; play/pause, 0.25x-2x, a scrubbable timeline with event markers, and WebM clips.
// Keyboard, gamepad and touch all drive the same actions.
import * as THREE from 'three';
import type { Game, ViewOverride } from '../core/Game';
import type { Viewport } from '../core/Renderer';
import { EVENT_ICON, type ActorPose, type ReplayEventKind } from '../systems/Replay';
import { REPLAY } from '../config';
import { clamp, damp, escapeHtml, hex } from '../utils/math';
import { ClipRecorder, OrbitInput, PadReader, canShareFile, clipMime, download, shareFile, stamp } from './mediaShare';

const CAMS = ['tv', 'chase', 'orbit', 'onboard', 'heli'] as const;
type ReplayCam = (typeof CAMS)[number];
const CAM_NAME: Record<ReplayCam, string> = { tv: '📺 TV', chase: '🎥 Chase', orbit: '🔄 Orbit', onboard: '🏍 Onboard', heli: '🚁 Heli' };
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // camera looks down -Z, vehicles face +Z
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

interface Ev { t: number; kind: ReplayEventKind; actor: number; label: string }

export class ReplayPanel implements ViewOverride {
  readonly root: HTMLDivElement;
  private cam = new THREE.PerspectiveCamera(55, 1, 0.3, 900);
  private t: number;
  private t0: number;
  private t1: number;
  private playing = true;
  private speed = 1;
  private mode: ReplayCam = 'tv';
  private focus = 0;
  private pose: ActorPose = { present: false, x: 0, y: 0, z: 0, q: new THREE.Quaternion(), speed: 0, yaw: 0, kind: 'bike' };
  private tv = { x: 0, y: 0, z: 0, set: false, side: 1, held: 0 };
  private chasePos = new THREE.Vector3();
  private snap = true;
  private orbit = { yaw: 0, pitch: 0.3, dist: 9 };
  private heliA = 0;
  private v = new THREE.Vector3();
  private vp: Viewport = { x: 0, y: 0, w: 1, h: 1 };
  private events: Ev[];
  private orbitIn: OrbitInput;
  private pad = new PadReader();
  private clip: ClipRecorder | null = null;
  private clipEnd = 0;
  private clipBlob: { blob: Blob; ext: string } | null = null;
  private mime = clipMime();
  private lastLabel = '';
  private lastSpeedo = -1;
  private uiHidden = false;
  private el: { fill: HTMLElement; head: HTMLElement; time: HTMLElement; speedo: HTMLElement; play: HTMLElement; line: HTMLElement; clip: HTMLElement | null; who: HTMLElement; sheet: HTMLElement };
  private scrubbing = false;

  constructor(private game: Game, private onExit: () => void, rewind: number) {
    const rp = game.replay!;
    this.t0 = rp.start;
    this.t1 = rp.end;
    this.t = Math.max(this.t0, this.t1 - rewind);
    this.events = rp.events();
    const me = rp.actors.findIndex((a) => a.local === game.players[0]);
    this.focus = Math.max(0, me);
    rp.open();
    this.root = document.createElement('div');
    this.root.id = 'replay';
    this.root.className = 'rp';
    this.root.innerHTML = this.html();
    document.body.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.el = { fill: q('.rp-fill'), head: q('.rp-head'), time: q('.rp-time'), speedo: q('.rp-speedo'), play: q('[data-a="play"]'), line: q('.rp-line'), clip: this.root.querySelector('[data-a="clip"]'), who: q('[data-a="focus"]'), sheet: q('.rp-sheet') };
    this.root.addEventListener('click', this.onClick);
    this.wireTimeline();
    this.orbitIn = new OrbitInput(game.renderer.gl.domElement);
    addEventListener('keydown', this.onKey, true);
    this.paintFocus();
  }

  private html() {
    const span = Math.max(0.001, this.t1 - this.t0), rp = this.game.replay!;
    const marks = this.events.map((e, i) => {
      const who = e.actor >= 0 ? rp.actors[e.actor] : null;
      return `<button class="rp-mark k-${e.kind}" data-ev="${i}" style="left:${((e.t - this.t0) / span) * 100}%" title="${escapeHtml(`${e.label} · ${who?.name ?? ''}`)}">${EVENT_ICON[e.kind]}</button>`;
    }).join('');
    return `
      <div class="rp-top">
        <span class="rp-badge">● REPLAY</span>
        <div class="rp-cams">${CAMS.map((c) => `<button class="chip ${c === this.mode ? 'on' : ''}" data-cam="${c}">${CAM_NAME[c]}</button>`).join('')}</div>
        <button class="rp-btn" data-a="focus"></button>
        <button class="rp-btn" data-a="hide" title="Hide controls (H)">👁</button>
        <button class="rp-btn rp-exit" data-a="exit">✕ Exit</button>
      </div>
      <div class="rp-bottom">
        <div class="rp-line"><div class="rp-fill"></div>${marks}<div class="rp-head"></div></div>
        <div class="rp-ctrl">
          <button class="rp-btn" data-a="prevEv" title="Previous event ([)">⏮</button>
          <button class="rp-btn" data-a="back" title="−5 s (←)">−5s</button>
          <button class="rp-btn rp-play" data-a="play" title="Play / pause (Space)">⏸</button>
          <button class="rp-btn" data-a="fwd" title="+5 s (→)">+5s</button>
          <button class="rp-btn" data-a="nextEv" title="Next event (])">⏭</button>
          <div class="rp-speeds">${REPLAY.speeds.map((s) => `<button class="chip ${s === this.speed ? 'on' : ''}" data-speed="${s}">${s}x</button>`).join('')}</div>
          <span class="rp-time"></span>
          <span class="rp-speedo"></span>
          ${this.mime ? '<button class="rp-btn rp-rec" data-a="clip" title="Record a clip of the replay (R)">● Clip</button>' : ''}
        </div>
        <div class="rp-keys">Space play · ←/→ seek · ↑/↓ speed · C camera · Tab rider · [ ] events · R clip · H hide · Esc exit · 🎮 A play · B exit · X cam · Y rider · LB/RB events · LT/RT scrub</div>
      </div>
      <div class="rp-sheet" hidden></div>
      <button class="rp-show" data-a="hide">👁 Show controls</button>`;
  }

  // ---------------------------------------------------------------- actions
  private onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.cam) return this.setCam(d.cam as ReplayCam);
    if (d.speed) return this.setSpeed(+d.speed);
    if (d.ev) return this.seek(this.events[+d.ev].t - 1.5, true);
    switch (d.a) {
      case 'exit': return this.onExit();
      case 'play': return this.togglePlay();
      case 'back': return this.seek(this.t - 5, true);
      case 'fwd': return this.seek(this.t + 5, true);
      case 'prevEv': return this.jumpEvent(-1);
      case 'nextEv': return this.jumpEvent(1);
      case 'focus': return this.nextFocus();
      case 'hide': return this.toggleUi();
      case 'clip': return this.toggleClip();
      case 'dl': if (this.clipBlob) download(this.clipBlob.blob, `moto-infinite-${stamp()}.${this.clipBlob.ext}`); return;
      case 'share': if (this.clipBlob) void shareFile(this.clipBlob.blob, `moto-infinite-${stamp()}.${this.clipBlob.ext}`, 'My Moto Infinite replay'); return;
      case 'closeSheet': this.clipBlob = null; this.el.sheet.hidden = true; return;
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    e.stopPropagation(); // the game (and its pause key) stays out while the replay is open
    if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    switch (e.code) {
      case 'Escape': case 'Backspace': e.preventDefault(); return this.onExit();
      case 'Space': case 'KeyK': e.preventDefault(); return this.togglePlay();
      case 'ArrowLeft': e.preventDefault(); return this.seek(this.t - (e.shiftKey ? 1 / REPLAY.hz : 5), true);
      case 'ArrowRight': e.preventDefault(); return this.seek(this.t + (e.shiftKey ? 1 / REPLAY.hz : 5), true);
      case 'ArrowUp': e.preventDefault(); return this.stepSpeed(1);
      case 'ArrowDown': e.preventDefault(); return this.stepSpeed(-1);
      case 'KeyC': case 'KeyV': return this.setCam(CAMS[(CAMS.indexOf(this.mode) + 1) % CAMS.length]);
      case 'Tab': e.preventDefault(); return this.nextFocus();
      case 'BracketLeft': return this.jumpEvent(-1);
      case 'BracketRight': return this.jumpEvent(1);
      case 'KeyH': return this.toggleUi();
      case 'KeyR': return this.toggleClip();
      case 'Home': return this.seek(this.t0, true);
      case 'End': return this.seek(this.t1, true);
    }
  };

  private togglePlay() {
    if (!this.playing && this.t >= this.t1 - 0.01) this.seek(this.t0, true); // replay from the start
    this.playing = !this.playing;
  }

  private setSpeed(s: number) {
    this.speed = s;
    this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed! === s));
  }

  private stepSpeed(d: number) {
    const L = REPLAY.speeds, i = clamp(L.indexOf(this.speed) + d, 0, L.length - 1);
    this.setSpeed(L[i]);
  }

  private setCam(c: ReplayCam) {
    this.mode = c;
    this.snap = true;
    this.tv.set = false;
    if (c === 'orbit') this.orbit.yaw = this.pose.yaw + Math.PI;
    this.root.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === c));
  }

  private nextFocus() {
    const n = this.game.replay!.actors.length;
    if (!n) return;
    this.focus = (this.focus + 1) % n;
    this.snap = true;
    this.tv.set = false;
    this.paintFocus();
  }

  private paintFocus() {
    const a = this.game.replay!.actors[this.focus];
    this.el.who.innerHTML = a ? `<i style="background:${hex(a.color)}"></i>${escapeHtml(a.name)} ▸` : '—';
  }

  private jumpEvent(dir: number) {
    const lead = 1.5;
    let best: Ev | null = null;
    for (const e of this.events) {
      const t = e.t - lead;
      if (dir > 0 ? t > this.t + 0.05 && (!best || t < best.t - lead) : t < this.t - 0.3 && (!best || t > best.t - lead)) best = e;
    }
    if (best) {
      this.seek(best.t - lead, true);
      if (best.actor >= 0 && best.actor !== this.focus) { this.focus = best.actor; this.paintFocus(); }
    }
  }

  private seek(t: number, cut: boolean) {
    this.t = clamp(t, this.t0, this.t1);
    if (cut) { this.snap = true; this.tv.set = false; }
  }

  private toggleUi() {
    this.uiHidden = !this.uiHidden;
    this.root.classList.toggle('rp-hidden', this.uiHidden);
  }

  private wireTimeline() {
    const line = this.el.line;
    const at = (e: PointerEvent) => {
      const r = line.getBoundingClientRect();
      this.seek(this.t0 + clamp((e.clientX - r.left) / r.width, 0, 1) * (this.t1 - this.t0), true);
    };
    line.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.rp-mark')) return;
      this.scrubbing = true;
      line.setPointerCapture(e.pointerId);
      at(e);
    });
    line.addEventListener('pointermove', (e) => { if (this.scrubbing) at(e); });
    const end = () => { this.scrubbing = false; };
    line.addEventListener('pointerup', end);
    line.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- clips
  private toggleClip() {
    if (!this.mime) return;
    if (this.clip) return void this.finishClip();
    try {
      this.clip = new ClipRecorder(this.game.renderer.gl.domElement, this.mime, REPLAY.clipFps);
    } catch {
      this.clip = null;
      this.mime = null;
      this.el.clip?.remove();
      return;
    }
    if (this.t >= this.t1 - 0.5) this.seek(Math.max(this.t0, this.t1 - REPLAY.instantBack), true);
    this.clipEnd = Math.min(this.t1, this.t + REPLAY.clipMax);
    this.playing = true;
    this.root.classList.add('rp-recording');
    if (this.el.clip) this.el.clip.textContent = '■ Stop';
  }

  private async finishClip() {
    const c = this.clip;
    if (!c) return;
    this.clip = null;
    this.root.classList.remove('rp-recording');
    if (this.el.clip) this.el.clip.textContent = '● Clip';
    const blob = await c.stop();
    if (!blob.size || !this.root.isConnected) return;
    this.clipBlob = { blob, ext: c.ext };
    const sh = this.el.sheet;
    sh.innerHTML = `<b>🎬 Clip ready</b><span>${(blob.size / 1e6).toFixed(1)} MB · ${c.ext.toUpperCase()}</span>
      <button class="btn primary" data-a="dl">⬇ Download</button>
      ${canShareFile(blob.type) ? '<button class="btn" data-a="share">📤 Share</button>' : ''}
      <button class="btn ghost" data-a="closeSheet">Close</button>`;
    sh.hidden = false;
  }

  // ---------------------------------------------------------------- per frame
  render(dt: number) {
    const g = this.game, rp = g.replay!, r = g.renderer;
    this.handlePad(dt);
    if (this.playing && !this.scrubbing) {
      this.t += dt * this.speed;
      if (this.t >= this.t1) { this.t = this.t1; this.playing = false; }
    }
    if (this.clip && (this.t >= this.clipEnd || !this.playing)) void this.finishClip();
    const actor = rp.actors[this.focus];
    if (actor) rp.pose(actor, this.t, this.pose);
    this.updateCamera(dt);
    const vp = this.vp;
    vp.w = innerWidth;
    vp.h = innerHeight;
    this.cam.aspect = vp.w / vp.h;
    this.cam.updateProjectionMatrix();
    rp.apply(this.t);
    g.env.beforeRender(this.pose.x, this.pose.y, this.pose.z, this.cam, r.pixelHeight(vp));
    g.fx.setScale(r.pixelHeight(vp));
    r.render(g.scene, this.cam, vp, false);
    rp.unpose();
    this.paintUi();
  }

  private handlePad(dt: number) {
    const p = this.pad;
    p.poll();
    if (!p.pad) return;
    if (p.hit(0)) this.togglePlay();
    if (p.hit(1)) return this.onExit();
    if (p.hit(2)) this.setCam(CAMS[(CAMS.indexOf(this.mode) + 1) % CAMS.length]);
    if (p.hit(3)) this.nextFocus();
    if (p.hit(4)) this.jumpEvent(-1);
    if (p.hit(5)) this.jumpEvent(1);
    if (p.hit(12)) this.stepSpeed(1);
    if (p.hit(13)) this.stepSpeed(-1);
    if (p.hit(14)) this.seek(this.t - 5, true);
    if (p.hit(15)) this.seek(this.t + 5, true);
    if (p.hit(8)) this.toggleClip();
    const scrub = p.value(7) - p.value(6);
    if (Math.abs(scrub) > 0.1) this.seek(this.t + scrub * dt * 6, false);
    const rx = p.axis(2), ry = p.axis(3);
    if (rx || ry) {
      if (this.mode !== 'orbit') this.setCam('orbit');
      this.orbit.yaw -= rx * dt * 2.5;
      this.orbit.pitch = clamp(this.orbit.pitch + ry * dt * 1.5, -0.1, 1.4);
    }
  }

  private updateCamera(dt: number) {
    const P = this.pose, c = this.cam, T = this.game.terrain, k = this.snap ? 1 : damp(dt, 5);
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), car = P.kind === 'car';
    const o = this.orbitIn;
    if (o.dx || o.dy || o.zoom !== 1) {
      if (this.mode !== 'orbit') this.setCam('orbit');
      this.orbit.yaw -= o.dx * 0.008;
      this.orbit.pitch = clamp(this.orbit.pitch + o.dy * 0.006, -0.1, 1.4);
      this.orbit.dist = clamp(this.orbit.dist * o.zoom, 3, 40);
    }
    if (o.tapped && this.uiHidden) this.toggleUi();
    o.clear();
    let fov = 55;
    switch (this.mode) {
      case 'tv': {
        const tv = this.tv, d = Math.hypot(tv.x - P.x, tv.z - P.z), behind = (P.x - tv.x) * fx + (P.z - tv.z) * fz > 18;
        tv.held += dt * this.speed;
        if (!tv.set || d > 85 || behind || tv.held > 9) {
          const ahead = clamp(22 + P.speed * 0.45, 22, 75);
          tv.side = -tv.side;
          const side = tv.side * (8 + Math.random() * 6);
          tv.x = P.x + fx * ahead + fz * side;
          tv.z = P.z + fz * ahead - fx * side;
          tv.y = Math.max(T.groundAt(tv.x, tv.z), P.y - 4) + 2 + Math.random() * 4;
          tv.set = true;
          tv.held = 0;
        }
        c.position.set(tv.x, tv.y, tv.z);
        c.up.set(0, 1, 0);
        c.lookAt(P.x, P.y + 0.9, P.z);
        fov = clamp((2 * Math.atan(5.5 / Math.max(1, Math.hypot(tv.x - P.x, tv.y - P.y, tv.z - P.z))) * 180) / Math.PI, 10, 60);
        break;
      }
      case 'chase': {
        const back = car ? 9 : 7, h = car ? 3.2 : 2.6;
        this.v.set(P.x - fx * back, P.y + h, P.z - fz * back);
        this.chasePos.lerp(this.v, k);
        if (this.snap) this.chasePos.copy(this.v);
        c.position.copy(this.chasePos);
        c.position.y = Math.max(c.position.y, T.groundAt(c.position.x, c.position.z) + 0.6);
        c.up.set(0, 1, 0);
        c.lookAt(P.x + fx * 3, P.y + 1.1, P.z + fz * 3);
        fov = 60 + clamp(P.speed / 12, 0, 14);
        break;
      }
      case 'orbit': {
        const O = this.orbit, cp = Math.cos(O.pitch);
        c.position.set(P.x + Math.sin(O.yaw) * cp * O.dist, P.y + 1 + Math.sin(O.pitch) * O.dist, P.z + Math.cos(O.yaw) * cp * O.dist);
        c.position.y = Math.max(c.position.y, T.groundAt(c.position.x, c.position.z) + 0.4);
        c.up.set(0, 1, 0);
        c.lookAt(P.x, P.y + 1, P.z);
        break;
      }
      case 'onboard': {
        this.v.set(0, car ? 1.15 : 1.55, car ? -0.35 : -0.15).applyQuaternion(P.q);
        c.position.set(P.x + this.v.x, P.y + this.v.y, P.z + this.v.z);
        c.quaternion.copy(P.q).multiply(FLIP);
        fov = 74;
        break;
      }
      case 'heli': {
        this.heliA += dt * this.speed * 0.12;
        c.position.set(P.x + Math.sin(this.heliA) * 28, P.y + 26, P.z + Math.cos(this.heliA) * 28);
        c.up.set(0, 1, 0);
        c.lookAt(P.x, P.y, P.z);
        fov = 45;
        break;
      }
    }
    c.fov = this.snap ? fov : c.fov + (fov - c.fov) * damp(dt, 4);
    this.snap = false;
  }

  private paintUi() {
    const span = Math.max(0.001, this.t1 - this.t0), f = (this.t - this.t0) / span;
    this.el.fill.style.transform = `scaleX(${f})`;
    this.el.head.style.left = `${f * 100}%`;
    const label = `${fmt(this.t - this.t0)} / ${fmt(span)}`;
    if (label !== this.lastLabel) { this.lastLabel = label; this.el.time.textContent = label; }
    const kmh = Math.round(this.pose.speed);
    if (kmh !== this.lastSpeedo) { this.lastSpeedo = kmh; this.el.speedo.textContent = `${kmh} km/h`; }
    const icon = this.playing ? '⏸' : '▶';
    if (this.el.play.textContent !== icon) this.el.play.textContent = icon;
  }

  dispose() {
    if (this.clip) void this.clip.stop();
    this.clip = null;
    this.game.replay?.close();
    this.orbitIn.dispose();
    removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }
}
