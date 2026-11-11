// Phone/tablet controls for player 1: mode-aware buttons, virtual joystick or tilt steering, a drag-to-edit layout
// (snap grid, alignment guides, per-button size), a settings sheet, a rotate-to-landscape hint, fullscreen and screen
// wake lock while playing. Buttons hide while a gamepad is connected (Settings → Touch → Controller).
import type { Action, Input } from '../core/Input';
import type { Game } from '../core/Game';
import { WakeLock, enterFullscreen, fullscreenSupported, isFullscreen, isTouchDevice, toggleFullscreen } from '../core/device';
import { anyPadConnected } from '../core/gamepad';
import {
  TOUCH, TOUCH_BUTTONS, buttonDims, hiddenByStyle, keepOnScreen, keepOut, layoutButtons, orientKey, saveTouchSettings, snapPoint, stickCentre, stickSize,
  touchSettings as S, type Rect, type TouchCtx,
} from './TouchLayout';
import { touchSettingsEvent, touchSettingsHtml } from './touchSettingsUi';
import { clamp } from '../utils/math';

type DOEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** A quick tap must survive until the game's next input poll, even if the finger lifts in the same frame. */
const MIN_PRESS_MS = 60;
/** The tap that opens the ⚙ sheet also sends a click to whatever is under the finger afterwards (the sheet's backdrop). */
const SHEET_GUARD_MS = 450;

/** What the touch layer needs from App: whether a pause it started may end, and the replay entry point. */
export interface TouchHooks {
  /** False while a menu, replay or photo mode is open: then lifting the rotate hint / sheet must not resume the game. */
  canResume(): boolean;
  /** Instant replay (local games); returns false when there is nothing to show. */
  replay?(): boolean;
}

export function createTouch(input: Input, game: Game, hooks: TouchHooks): TouchControls | null {
  return isTouchDevice() ? new TouchControls(input, game, hooks) : null;
}

/** Settings → Touch controls changed the shared touch settings: re-lay out the live controls (if any). */
export function touchSettingsChanged() {
  TouchControls.current?.reload();
}

/** Joystick / tilt amount (-1..1) → steering: dead zone, then sensitivity, capped at full lock. */
export function shapeSteer(v: number, dead: number, sens: number) {
  const a = Math.abs(v);
  return a < dead ? 0 : Math.sign(v) * Math.min(1, ((a - dead) / (1 - dead)) * sens);
}

export class TouchControls {
  /** The controls of the running session (one at a time). */
  static current: TouchControls | null = null;
  readonly root: HTMLDivElement;
  private btns = new Map<string, HTMLButtonElement>();
  private stick: HTMLDivElement;
  private knob: HTMLElement;
  private sys: HTMLDivElement;
  /** pointerId -> button id ('stick' for the joystick) */
  private ptrs = new Map<number, string>();
  private pressedAt = new Map<string, number>();
  private stickVec = { x: 0, y: 0 };
  /** Steering the stick / tilt asks for, and what is sent after smoothing. */
  private steerWant = 0;
  private steerOut = 0;
  private ctx: TouchCtx;
  private ctxKey = '';
  private raf = 0;
  private frame = 0;
  private padOn = false;
  private wake = new WakeLock();
  private editing = false;
  private selected: string | null = null;
  private drag: { id: string; dx: number; dy: number; zones: Rect[] } | null = null;
  private sheet: HTMLDivElement | null = null;
  private sheetAt = 0;
  private hint: HTMLDivElement;
  private portraitOk = false;
  private wePaused = false;
  private tilt = { have: false, raw: 0, zero: null as number | null };
  private chip: HTMLButtonElement;
  private offs: (() => void)[] = [];

  constructor(private input: Input, private game: Game, private hooks: TouchHooks) {
    TouchControls.current = this;
    this.ctx = this.readCtx();
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div class="tc-stick" data-id="stick"><i></i></div>
      ${TOUCH_BUTTONS.map((b) => `<button class="tc-btn${b.big ? ' big' : ''}" data-id="${b.id}" aria-label="${b.id}"></button>`).join('')}
      <div class="tc-sys">
        <button data-sys="pause" aria-label="Pause">❚❚</button>
        <button data-sys="camera" aria-label="Camera">🎥</button>
        ${hooks.replay && game.replay && !game.net ? '<button data-sys="replay" aria-label="Instant replay">🎬</button>' : ''}
        <button data-sys="level" aria-label="Level tilt">⟲</button>
        ${fullscreenSupported() ? '<button data-sys="fs" aria-label="Fullscreen">⛶</button>' : ''}
        <button data-sys="settings" aria-label="Touch settings">⚙</button>
      </div>
      <button class="tc-chip">Tap to enable tilt steering</button>
      <i class="tc-guide v" hidden></i><i class="tc-guide h" hidden></i>
      <div class="tc-edit"><span>Drag buttons · tap one to resize</span><button data-edit="snap">⊞ Snap</button><button data-edit="reset">Reset</button><button data-edit="done" class="primary">Done</button></div>
      <div class="tc-sel" hidden><b data-sel="name"></b><button data-edit="smaller" aria-label="Smaller">−</button><span data-sel="size"></span><button data-edit="bigger" aria-label="Bigger">+</button><button data-edit="breset" aria-label="Reset this button">↺</button></div>`;
    root.querySelectorAll<HTMLButtonElement>('.tc-btn').forEach((b) => this.btns.set(b.dataset.id!, b));
    this.stick = root.querySelector('.tc-stick')!;
    this.knob = this.stick.querySelector('i')!;
    this.sys = root.querySelector('.tc-sys')!;
    this.chip = root.querySelector('.tc-chip')!;

    this.hint = document.createElement('div');
    this.hint.className = 'rotate-hint';
    this.hint.innerHTML = `<div><div class="rh-phone"></div><h3>Turn your phone sideways</h3><p>Moto Infinite plays best in landscape: bigger view, room for both thumbs.</p>
      ${fullscreenSupported() ? '<button class="btn primary" data-rh="fs">⛶ Fullscreen landscape</button>' : ''}<button class="btn ghost" data-rh="stay">Play in portrait</button></div>`;
    this.hint.addEventListener('click', (e) => {
      const go = (e.target as HTMLElement).closest<HTMLElement>('[data-rh]')?.dataset.rh;
      if (go === 'fs') void enterFullscreen(true);
      if (go === 'stay') { this.portraitOk = true; this.updateHint(); }
    });

    this.wire();
    document.body.append(root, this.hint);
    document.body.classList.add('touch-on');
    this.applyStyle();
    this.refresh(true);
    this.updateHint();
    this.wake.set(true);
    this.loop();
  }

  // ---------------------------------------------------------------- state
  private readCtx(): TouchCtx {
    const p = this.game.players[0], o = this.game.opts;
    const f1 = !!p?.def.f1 && o.mode === 'f1';
    return {
      mode: o.mode, scheme: S.scheme, f1, car: !!p?.isCar, riding: !!p?.riding,
      weapons: !f1 && (o.mode === 'open' || o.pvp), canWalk: o.mode === 'open', cards: !!p?.cards.length, thrusters: !!p?.ev?.thrusters,
    };
  }

  /** The context buttons are shown for: edit mode adds the upgrade button (it only shows up with cards). Riding and on-foot
   *  sets share slots (WHEELIE / JUMP), so the editor shows the set you are using now: get off to place the on-foot ones. */
  private shownCtx(): TouchCtx {
    const c = this.ctx;
    return this.editing ? { ...c, cards: c.canWalk } : c;
  }

  private visible() {
    const c = this.shownCtx();
    return TOUCH_BUTTONS.filter((b) => b.show(c) && !hiddenByStyle(b, S));
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const ctx = this.readCtx(), key = JSON.stringify(ctx);
    if (key !== this.ctxKey) {
      this.ctx = ctx;
      this.ctxKey = key;
      this.refresh(false);
    }
    if (++this.frame % 30 === 0) this.checkPad();
    if (this.editing) return;
    if (S.scheme === 'tilt') this.steerWant = this.tiltSteer();
    if (S.scheme !== 'buttons') {
      // smoothing: ease towards the wanted steering (0 = instant)
      this.steerOut += (this.steerWant - this.steerOut) * (1 - S.smooth);
      if (Math.abs(this.steerOut) < 0.005 && !this.steerWant) this.steerOut = 0;
      this.input.touchSteer = this.steerOut;
    }
  };

  /** A gamepad took over: hide the on-screen driving buttons (pause / camera stay). */
  private checkPad() {
    const on = S.padHide && anyPadConnected();
    if (on === this.padOn) return;
    this.padOn = on;
    this.root.classList.toggle('pad-on', on);
    if (on) this.releaseAll();
  }

  /** Show the buttons this mode/vehicle needs, label them and lay them out. */
  private refresh(force: boolean) {
    if (force) this.ctxKey = JSON.stringify(this.ctx);
    const c = this.ctx, vis = new Set(this.visible());
    for (const b of TOUCH_BUTTONS) {
      const el = this.btns.get(b.id)!;
      el.hidden = !vis.has(b);
      const icon = S.labels === 'icons' && b.icon ? b.icon(c) : '';
      el.textContent = icon || b.label(c);
      el.classList.toggle('small', el.textContent.length > 3);
      el.classList.toggle('tiny', el.textContent.length > 5);
      el.classList.toggle('pedal', S.style === 'racing' && (b.id === 'gas' || b.id === 'brake'));
    }
    this.stick.hidden = S.scheme !== 'stick';
    this.sys.querySelector<HTMLElement>('[data-sys="level"]')!.hidden = S.scheme !== 'tilt';
    this.chip.hidden = S.scheme !== 'tilt' || this.tilt.have;
    this.root.classList.toggle('editing', this.editing);
    document.body.classList.toggle('touch-editing', this.editing);
    this.root.classList.toggle('lefty', S.leftHanded);
    this.root.querySelector('[data-edit="snap"]')!.classList.toggle('on', S.snap);
    this.layout();
    this.showSelection();
  }

  private applyStyle() {
    const st = this.root.style;
    st.setProperty('--tc-u', `${TOUCH.unit * S.size}px`);
    st.setProperty('--tc-stick', `${stickSize(S)}px`);
    st.setProperty('--tc-op', String(S.opacity));
  }

  private box() {
    const cs = getComputedStyle(this.root), n = (v: string) => parseFloat(v) || 0;
    const l = n(cs.paddingLeft), t = n(cs.paddingTop);
    return { l, t, w: innerWidth - l - n(cs.paddingRight), h: innerHeight - t - n(cs.paddingBottom) };
  }

  /** Size of a placed element (px): as laid out (short screens shorten racing pedals). */
  private dims(id: string) {
    if (id === 'stick') { const d = stickSize(S); return { w: d, h: d }; }
    return this.sizes.get(id) ?? buttonDims(TOUCH_BUTTONS.find((b) => b.id === id)!, S);
  }

  private sizes = new Map<string, { w: number; h: number }>();

  private layout() {
    const { l, t, w, h } = this.box(), ok = orientKey(w, h), vis = this.visible();
    const def = layoutButtons(vis, this.shownCtx(), w, h, S);
    this.sizes = new Map(Object.entries(def).map(([id, p]) => [id, { w: p.w, h: p.h }]));
    const place = (el: HTMLElement, id: string, d: { x: number; y: number }) => {
      const saved = S.pos[`${ok}:${id}`], { w: bw, h: bh } = this.dims(id);
      const p = keepOnScreen(saved ? saved[0] * w : d.x, saved ? saved[1] * h : d.y, bw, bh, w, h); // never half off-screen
      el.style.left = `${l + p.x}px`;
      el.style.top = `${t + p.y}px`;
      el.style.setProperty('--w', `${bw}px`);
      el.style.setProperty('--h', `${bh}px`);
    };
    for (const b of vis) place(this.btns.get(b.id)!, b.id, def[b.id]);
    place(this.stick, 'stick', stickCentre(w, h, S));
    const sysR = this.sys.getBoundingClientRect().right; // the online dock lines up after the system buttons (display.css)
    if (sysR > 0) document.body.style.setProperty('--tc-sys-r', `${sysR}px`);
  }

  // ---------------------------------------------------------------- input
  private wire() {
    const r = this.root;
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: never) => void, opt?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opt);
      this.offs.push(() => el.removeEventListener(ev, fn as EventListener, opt));
    };
    on(r, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(r, 'pointermove', (e: PointerEvent) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) on(r, ev, (e: PointerEvent) => this.up(e));
    on(r, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'gesturestart', (e: Event) => e.preventDefault()); // iOS pinch zoom
    on(document, 'dblclick', (e: Event) => e.preventDefault());
    on(window, 'resize', () => { this.layout(); this.updateHint(); });
    on(window, 'orientationchange', () => setTimeout(() => { this.layout(); this.updateHint(); }, 250));
    on(window, 'deviceorientation', (e: DeviceOrientationEvent) => this.onTilt(e));
    on(window, 'blur', () => this.releaseAll());
  }

  private down(e: PointerEvent) {
    const t = e.target as HTMLElement;
    const sys = t.closest<HTMLElement>('[data-sys]')?.dataset.sys, edit = t.closest<HTMLElement>('[data-edit]')?.dataset.edit;
    if (sys || edit || t.closest('.tc-chip')) {
      e.preventDefault();
      if (sys) this.system(sys);
      else if (edit) this.editAction(edit);
      else void this.requestTilt();
      return;
    }
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) {
      if (this.editing && this.selected) { this.selected = null; this.showSelection(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    t.setPointerCapture?.(e.pointerId);
    if (this.editing) {
      const el = id === 'stick' ? this.stick : this.btns.get(id)!;
      this.selected = id;
      this.showSelection();
      this.drag = { id, dx: e.clientX - parseFloat(el.style.left), dy: e.clientY - parseFloat(el.style.top), zones: this.keepOutZones(id) };
      return;
    }
    if (this.padOn) return;
    this.ptrs.set(e.pointerId, id);
    this.pressedAt.set(id, performance.now());
    if (id === 'stick') this.stickMove(e);
    this.sync();
    if (S.haptics) navigator.vibrate?.(8);
  }

  /** Areas a dragged button must not cover: the system button row, the minimap, the stats panel, the gauges and the
   *  other buttons (so a drop never hides one under another). */
  private keepOutZones(self: string): Rect[] {
    const { l, t, w } = this.box(), out: Rect[] = [{ l: 0, t: 0, r: w, b: TOUCH.sysBar }];
    const hud = this.game.hudLayer.querySelector('.hud');
    const els = [...['.z-tr .mapwrap', '.z-tl .stats', '.z-br'].map((sel) => hud?.querySelector<HTMLElement>(sel)),
      ...[...this.btns].filter(([id, el]) => id !== self && !el.hidden).map(([, el]) => el), self !== 'stick' && !this.stick.hidden ? this.stick : null];
    for (const el of els) {
      const r = el?.getBoundingClientRect();
      if (r && r.width > 4 && r.height > 4 && getComputedStyle(el!).display !== 'none') out.push({ l: r.left - l, t: r.top - t, r: r.right - l, b: r.bottom - t });
    }
    return out;
  }

  private move(e: PointerEvent) {
    if (this.drag) {
      const { w, h } = this.box(), d = this.drag, { w: bw, h: bh } = this.dims(d.id), { l, t } = this.box();
      let x = e.clientX - d.dx - l, y = e.clientY - d.dy - t, gx: number | null = null, gy: number | null = null;
      if (S.snap) {
        const others = [...this.btns.entries()].filter(([id, el]) => id !== d.id && !el.hidden).map(([, el]) => ({ x: parseFloat(el.style.left) - l, y: parseFloat(el.style.top) - t }));
        if (!this.stick.hidden && d.id !== 'stick') others.push({ x: parseFloat(this.stick.style.left) - l, y: parseFloat(this.stick.style.top) - t });
        ({ x, y, gx, gy } = snapPoint(x, y, others));
      }
      const p = keepOut(x, y, bw, bh, w, h, d.zones);
      this.guides(p.x === gx ? l + p.x : null, p.y === gy ? t + p.y : null);
      S.pos[`${orientKey(w, h)}:${d.id}`] = [Math.round((p.x / w) * 1e4) / 1e4, Math.round((p.y / h) * 1e4) / 1e4];
      this.layout();
      return;
    }
    const id = this.ptrs.get(e.pointerId);
    if (!id) return;
    if (id === 'stick') { this.stickMove(e); return; }
    // slide between buttons (e.g. ◀ to ▶) without lifting the thumb
    const over = this.buttonAt(e.clientX, e.clientY);
    if (over && over !== id) {
      this.ptrs.set(e.pointerId, over);
      this.pressedAt.set(over, performance.now());
      this.sync();
    }
  }

  private guides(x: number | null, y: number | null) {
    const v = this.root.querySelector<HTMLElement>('.tc-guide.v')!, h = this.root.querySelector<HTMLElement>('.tc-guide.h')!;
    v.hidden = x === null;
    h.hidden = y === null;
    if (x !== null) v.style.left = `${x}px`;
    if (y !== null) h.style.top = `${y}px`;
  }

  private up(e: PointerEvent) {
    if (this.drag) {
      this.drag = null;
      this.guides(null, null);
      saveTouchSettings();
      return;
    }
    const id = this.ptrs.get(e.pointerId);
    if (!id) return;
    this.ptrs.delete(e.pointerId);
    if (id === 'stick') {
      this.stickVec = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.steerWant = 0;
    }
    const left = MIN_PRESS_MS - (performance.now() - (this.pressedAt.get(id) ?? 0));
    if (left > 0) setTimeout(() => this.sync(), left);
    else this.sync();
  }

  private buttonAt(x: number, y: number) {
    for (const [id, el] of this.btns) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  /** Held actions = everything under a finger, plus recent taps that the game has not polled yet. */
  private sync() {
    const held = new Set<Action>(), now = performance.now();
    const active = new Set(this.ptrs.values());
    for (const [id, at] of this.pressedAt) if (now - at < MIN_PRESS_MS) active.add(id);
    for (const b of TOUCH_BUTTONS) {
      const on = active.has(b.id);
      this.btns.get(b.id)!.classList.toggle('on', on);
      if (on) b.actions.forEach((a) => held.add(a));
    }
    if (active.has('stick')) {
      if (this.stickVec.y < -0.6) held.add('up');
      if (this.stickVec.y > 0.6) held.add('down');
    }
    this.input.touch.clear();
    held.forEach((a) => this.input.touch.add(a));
  }

  private stickMove(e: PointerEvent) {
    const r = this.stick.getBoundingClientRect(), rad = r.width / 2;
    let x = (e.clientX - (r.left + rad)) / rad, y = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.stickVec = { x, y };
    this.knob.style.transform = `translate(${x * rad * 0.6}px, ${y * rad * 0.6}px)`;
    this.steerWant = -shapeSteer(x, S.dead, S.sens); // positive = left
    this.sync();
  }

  private releaseAll() {
    this.ptrs.clear();
    this.pressedAt.clear();
    this.input.touch.clear();
    this.input.touchSteer = this.steerWant = this.steerOut = 0;
    this.btns.forEach((b) => b.classList.remove('on'));
  }

  // ---------------------------------------------------------------- tilt
  private onTilt(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    // steering-wheel tilt: beta in landscape (sign flips with the side the top of the phone points to), gamma in portrait
    const raw = angle === 90 ? -e.beta : angle === 270 || angle === -90 ? e.beta : -e.gamma;
    if (this.tilt.zero === null || Math.abs(raw - this.tilt.raw) > 120) this.tilt.zero = raw; // first reading / orientation flip = level
    this.tilt.raw = raw;
    if (!this.tilt.have) {
      this.tilt.have = true;
      this.chip.hidden = true;
    }
  }

  private tiltSteer() {
    if (!this.tilt.have || this.tilt.zero === null) return 0;
    const v = (this.tilt.raw - this.tilt.zero) / S.tiltRange;
    return shapeSteer(S.tiltInvert ? -v : v, S.dead, S.sens);
  }

  /** Tilt calibration: the way the phone is held now counts as straight ahead. */
  calibrate() {
    this.tilt.zero = this.tilt.have ? this.tilt.raw : null;
  }

  /** iOS 13+ needs an explicit permission prompt from a tap. */
  private async requestTilt() {
    const DO = window.DeviceOrientationEvent as DOEvent | undefined;
    if (!DO) return;
    try {
      if (DO.requestPermission && (await DO.requestPermission()) !== 'granted') this.chip.textContent = 'Tilt blocked: allow Motion & Orientation';
    } catch {
      /* not from a gesture */
    }
    this.tilt.zero = null;
  }

  // ---------------------------------------------------------------- system buttons, sheet, edit mode
  private system(id: string) {
    if (id === 'pause') this.input.onPause?.();
    else if (id === 'camera') { this.input.touch.add('camera'); setTimeout(() => this.input.touch.delete('camera'), MIN_PRESS_MS); }
    else if (id === 'fs') void toggleFullscreen();
    else if (id === 'level') this.calibrate();
    else if (id === 'settings') this.openSheet();
    else if (id === 'replay') { this.releaseAll(); this.hooks.replay?.(); }
  }

  private holdPause(on: boolean) {
    if (on && !this.wePaused && !this.game.paused) {
      this.wePaused = true;
      this.game.setMenuPaused(true);
    } else if (!on && this.wePaused && !this.sheet && !this.editing && !this.hintShown()) {
      this.wePaused = false;
      // the pause menu (e.g. opened by locking the phone meanwhile), replay or photo mode keep their own pause
      if (this.hooks.canResume()) this.game.setMenuPaused(false);
    }
  }

  /** Open the layout editor (⚙ sheet or Settings → Touch → Edit layout). */
  startEditing() {
    this.closeSheet();
    this.setEditing(true);
  }

  private setEditing(on: boolean) {
    this.editing = on;
    this.selected = null;
    this.releaseAll();
    this.refresh(true);
    if (on) this.holdPause(true);
    else { saveTouchSettings(); this.holdPause(false); }
  }

  private editAction(a: string) {
    const { w, h } = this.box(), ok = orientKey(w, h) + ':', id = this.selected;
    if (a === 'done') return this.setEditing(false);
    if (a === 'snap') S.snap = !S.snap;
    else if (a === 'reset') {
      for (const k of Object.keys(S.pos)) if (k.startsWith(ok)) delete S.pos[k];
      S.sizes = {};
      this.applyStyle();
    } else if (id && (a === 'smaller' || a === 'bigger')) {
      const v = (S.sizes[id] ?? 1) + (a === 'bigger' ? 0.1 : -0.1);
      S.sizes[id] = Math.round(clamp(v, TOUCH.btnSizes[0], TOUCH.btnSizes[1]) * 100) / 100;
      if (id === 'stick') this.applyStyle();
    } else if (id && a === 'breset') {
      delete S.sizes[id];
      delete S.pos[ok + id];
      if (id === 'stick') this.applyStyle();
    }
    this.refresh(true);
    const at = id ? S.pos[ok + id] : undefined;
    if (id && at && (a === 'smaller' || a === 'bigger')) {
      // a moved button that grew must still clear its neighbours and the HUD
      const { w: bw, h: bh } = this.dims(id), p = keepOut(at[0] * w, at[1] * h, bw, bh, w, h, this.keepOutZones(id));
      S.pos[ok + id] = [Math.round((p.x / w) * 1e4) / 1e4, Math.round((p.y / h) * 1e4) / 1e4];
      this.layout();
    }
    saveTouchSettings();
  }

  /** Edit mode: the selected button's size bar. */
  private showSelection() {
    const bar = this.root.querySelector<HTMLElement>('.tc-sel')!, id = this.editing ? this.selected : null;
    bar.hidden = !id;
    this.btns.forEach((b, k) => b.classList.toggle('sel', k === id));
    this.stick.classList.toggle('sel', id === 'stick');
    if (!id) return;
    const el = id === 'stick' ? null : this.btns.get(id);
    bar.querySelector('[data-sel="name"]')!.textContent = id === 'stick' ? 'Joystick' : el?.textContent ?? id;
    bar.querySelector('[data-sel="size"]')!.textContent = `${Math.round((S.sizes[id] ?? 1) * 100)}%`;
  }

  private openSheet() {
    if (this.sheet) return;
    this.releaseAll();
    const sh = (this.sheet = document.createElement('div'));
    this.sheetAt = performance.now();
    sh.className = 'touch-sheet';
    const render = () => {
      sh.innerHTML = `<div class="ts-card" role="dialog" aria-label="Touch controls">
        <div class="ts-head"><b>Touch controls</b><button class="btn ghost" data-ts="close">Done</button></div>
        ${touchSettingsHtml(true)}
        ${fullscreenSupported() ? `<div class="ts-actions"><button class="btn ghost" data-ts="fs">${isFullscreen() ? 'Exit fullscreen' : '⛶ Fullscreen'}</button></div>` : ''}
      </div>`;
    };
    render();
    const handle = (e: Event, commit: boolean) => {
      const r = touchSettingsEvent(e, commit, () => this.changed());
      if (r === 'edit') this.startEditing();
      else if (r === 'level') this.calibrate();
      else if (r === 'render') {
        if (S.scheme === 'tilt') void this.requestTilt();
        const y = sh.querySelector('.ts-card')?.scrollTop ?? 0;
        render();
        sh.querySelector('.ts-card')!.scrollTop = y;
      }
      return r;
    };
    sh.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (performance.now() - this.sheetAt < SHEET_GUARD_MS) return; // the click of the tap that opened the sheet
      if (t === sh) return this.closeSheet();
      if (handle(e, true)) return;
      const act = t.closest<HTMLElement>('[data-ts]')?.dataset.ts;
      if (act === 'close') this.closeSheet();
      else if (act === 'fs') { void toggleFullscreen(); this.closeSheet(); }
    });
    sh.addEventListener('input', (e) => handle(e, false));
    sh.addEventListener('change', (e) => handle(e, true));
    document.body.appendChild(sh);
    this.holdPause(true);
  }

  /** App resumed from a menu / replay: if the rotate hint, sheet or layout editor is still up, keep holding the game. */
  afterResume() {
    if (!this.sheet && !this.editing && !this.hintShown()) return;
    this.wePaused = false;
    this.holdPause(true);
  }

  /** Touch settings were edited elsewhere (Settings screen). */
  reload() {
    this.releaseAll();
    this.applyStyle();
    this.ctx = this.readCtx();
    this.refresh(true);
    this.padOn = !this.padOn; // re-evaluate the controller auto-hide now
    this.checkPad();
  }

  private changed() {
    saveTouchSettings();
    this.reload();
  }

  private closeSheet() {
    this.sheet?.remove();
    this.sheet = null;
    this.holdPause(false);
  }

  // ---------------------------------------------------------------- portrait hint
  private hintShown() {
    return !this.portraitOk && innerHeight > innerWidth;
  }

  private updateHint() {
    const show = this.hintShown();
    this.hint.classList.toggle('show', show);
    document.body.classList.toggle('touch-portrait', innerHeight > innerWidth);
    if (show) this.holdPause(true);
    else this.holdPause(false);
  }

  remove() {
    if (TouchControls.current === this) TouchControls.current = null;
    cancelAnimationFrame(this.raf);
    this.offs.forEach((off) => off());
    this.releaseAll();
    this.wake.dispose();
    this.sheet?.remove();
    this.hint.remove();
    this.root.remove();
    document.body.classList.remove('touch-on', 'touch-portrait', 'touch-editing');
  }
}
