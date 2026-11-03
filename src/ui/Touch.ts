// Phone/tablet controls for player 1: mode-aware buttons, virtual joystick or tilt steering, a drag-to-edit layout,
// a settings sheet, a rotate-to-landscape hint, fullscreen and screen wake lock while playing.
import type { Action, Input } from '../core/Input';
import type { Game } from '../core/Game';
import { WakeLock, enterFullscreen, fullscreenSupported, isFullscreen, isTouchDevice, toggleFullscreen } from '../core/device';
import { TOUCH, TOUCH_BUTTONS, defaultCentre, orientKey, saveTouchSettings, stickCentre, touchSettings as S, type TouchCtx, type TouchScheme } from './TouchLayout';
import { clamp } from '../utils/math';

type DOEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** A quick tap must survive until the game's next input poll, even if the finger lifts in the same frame. */
const MIN_PRESS_MS = 60;

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
  private ctx: TouchCtx;
  private ctxKey = '';
  private raf = 0;
  private wake = new WakeLock();
  private editing = false;
  private drag: { id: string; dx: number; dy: number } | null = null;
  private sheet: HTMLDivElement | null = null;
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
      <div class="tc-edit"><span>Drag the buttons where your thumbs like them</span><button data-edit="reset">Reset</button><button data-edit="done" class="primary">Done</button></div>`;
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

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const ctx = this.readCtx(), key = JSON.stringify(ctx);
    if (key !== this.ctxKey) {
      this.ctx = ctx;
      this.ctxKey = key;
      this.refresh(false);
    }
    if (S.scheme === 'tilt' && !this.editing) this.input.touchSteer = this.tiltSteer();
  };

  /** Show the buttons this mode/vehicle needs, label them and lay them out. */
  private refresh(force: boolean) {
    if (force) this.ctxKey = JSON.stringify(this.ctx);
    const c = this.ctx;
    for (const b of TOUCH_BUTTONS) {
      const el = this.btns.get(b.id)!;
      // edit mode shows every button this mode can ever need, so all of them can be placed
      const on = this.editing ? b.show({ ...c, riding: true, cards: c.canWalk }) || (b.id === 'jump' && c.canWalk) : b.show(c);
      el.hidden = !on;
      el.textContent = b.label(c);
      el.classList.toggle('small', el.textContent.length > 3);
      el.classList.toggle('tiny', el.textContent.length > 5);
    }
    this.stick.hidden = S.scheme !== 'stick';
    this.sys.querySelector<HTMLElement>('[data-sys="level"]')!.hidden = S.scheme !== 'tilt';
    this.chip.hidden = S.scheme !== 'tilt' || this.tilt.have;
    this.root.classList.toggle('editing', this.editing);
    this.root.classList.toggle('lefty', S.leftHanded);
    this.layout();
  }

  private applyStyle() {
    const st = this.root.style;
    st.setProperty('--tc-u', `${TOUCH.unit * S.size}px`);
    st.setProperty('--tc-stick', `${TOUCH.stick * S.size}px`);
    st.setProperty('--tc-op', String(S.opacity));
  }

  private box() {
    const cs = getComputedStyle(this.root), n = (v: string) => parseFloat(v) || 0;
    const l = n(cs.paddingLeft), t = n(cs.paddingTop);
    return { l, t, w: innerWidth - l - n(cs.paddingRight), h: innerHeight - t - n(cs.paddingBottom) };
  }

  private layout() {
    const { l, t, w, h } = this.box(), ok = orientKey(w, h);
    const place = (el: HTMLElement, id: string, def: { x: number; y: number }) => {
      const saved = S.pos[`${ok}:${id}`];
      const x = saved ? saved[0] * w : def.x, y = saved ? saved[1] * h : def.y;
      el.style.left = `${l + clamp(x, 0, w)}px`;
      el.style.top = `${t + clamp(y, 0, h)}px`;
    };
    for (const b of TOUCH_BUTTONS) place(this.btns.get(b.id)!, b.id, defaultCentre(b, this.ctx, w, h, S));
    place(this.stick, 'stick', stickCentre(w, h, S));
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
      else if (edit === 'reset') this.resetLayout();
      else if (edit === 'done') this.setEditing(false);
      else void this.requestTilt();
      return;
    }
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    t.setPointerCapture?.(e.pointerId);
    if (this.editing) {
      const el = id === 'stick' ? this.stick : this.btns.get(id)!;
      this.drag = { id, dx: e.clientX - parseFloat(el.style.left), dy: e.clientY - parseFloat(el.style.top) };
      return;
    }
    this.ptrs.set(e.pointerId, id);
    this.pressedAt.set(id, performance.now());
    if (id === 'stick') this.stickMove(e);
    this.sync();
    navigator.vibrate?.(8);
  }

  private move(e: PointerEvent) {
    if (this.drag) {
      const { l, t, w, h } = this.box();
      const x = clamp(e.clientX - this.drag.dx - l, 0, w), y = clamp(e.clientY - this.drag.dy - t, 0, h);
      S.pos[`${orientKey(w, h)}:${this.drag.id}`] = [x / w, y / h];
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

  private up(e: PointerEvent) {
    if (this.drag) {
      this.drag = null;
      saveTouchSettings();
      return;
    }
    const id = this.ptrs.get(e.pointerId);
    if (!id) return;
    this.ptrs.delete(e.pointerId);
    if (id === 'stick') {
      this.stickVec = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.input.touchSteer = 0;
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
    const ax = Math.abs(x) < TOUCH.dead ? 0 : Math.sign(x) * (Math.abs(x) - TOUCH.dead) / (1 - TOUCH.dead);
    this.input.touchSteer = -ax; // positive = left
    this.sync();
  }

  private releaseAll() {
    this.ptrs.clear();
    this.pressedAt.clear();
    this.input.touch.clear();
    this.input.touchSteer = 0;
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
    let v = (this.tilt.raw - this.tilt.zero) / S.tiltRange;
    if (S.tiltInvert) v = -v;
    const a = Math.abs(v);
    return a < TOUCH.dead ? 0 : Math.sign(v) * Math.min(1, (a - TOUCH.dead) / (1 - TOUCH.dead));
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
    else if (id === 'level') this.tilt.zero = this.tilt.have ? this.tilt.raw : null;
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

  private setEditing(on: boolean) {
    this.editing = on;
    this.releaseAll();
    this.refresh(true);
    if (on) this.holdPause(true);
    else { saveTouchSettings(); this.holdPause(false); }
  }

  private resetLayout() {
    const ok = orientKey(innerWidth, innerHeight) + ':';
    for (const k of Object.keys(S.pos)) if (k.startsWith(ok)) delete S.pos[k];
    saveTouchSettings();
    this.layout();
  }

  private openSheet() {
    if (this.sheet) return;
    this.releaseAll();
    const sh = (this.sheet = document.createElement('div'));
    sh.className = 'touch-sheet';
    const seg = (v: TouchScheme, l: string) => `<button data-scheme="${v}" class="${S.scheme === v ? 'on' : ''}">${l}</button>`;
    sh.innerHTML = `<div class="ts-card" role="dialog" aria-label="Touch controls">
      <div class="ts-head"><b>Touch controls</b><button class="btn ghost" data-ts="close">Done</button></div>
      <label>Steering</label><div class="ts-seg">${seg('buttons', '◀ ▶ Buttons')}${seg('stick', '🕹 Joystick')}${seg('tilt', '📱 Tilt')}</div>
      <div class="ts-tilt" ${S.scheme === 'tilt' ? '' : 'hidden'}>
        <label>Tilt for full lock <span data-v="tilt">${S.tiltRange}°</span></label><input type="range" min="10" max="40" step="1" value="${S.tiltRange}" data-r="tiltRange">
        <div class="ts-row"><label><input type="checkbox" data-c="tiltInvert" ${S.tiltInvert ? 'checked' : ''}> Invert tilt</label><button class="btn" data-ts="level">⟲ Set level now</button></div>
      </div>
      <label>Button size <span data-v="size">${Math.round(S.size * 100)}%</span></label><input type="range" min="${TOUCH.sizes[0]}" max="${TOUCH.sizes[1]}" step="0.05" value="${S.size}" data-r="size">
      <label>Opacity <span data-v="opacity">${Math.round(S.opacity * 100)}%</span></label><input type="range" min="0.2" max="1" step="0.05" value="${S.opacity}" data-r="opacity">
      <div class="ts-row"><label><input type="checkbox" data-c="leftHanded" ${S.leftHanded ? 'checked' : ''}> Left-handed (swap sides)</label></div>
      <div class="ts-actions"><button class="btn" data-ts="edit">✥ Edit layout</button><button class="btn ghost" data-ts="reset">Reset layout</button>
        ${fullscreenSupported() ? `<button class="btn ghost" data-ts="fs">${isFullscreen() ? 'Exit fullscreen' : '⛶ Fullscreen'}</button>` : ''}</div>
    </div>`;
    sh.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === sh) return this.closeSheet();
      const scheme = t.closest<HTMLElement>('[data-scheme]')?.dataset.scheme as TouchScheme | undefined;
      if (scheme) {
        S.scheme = scheme;
        if (scheme === 'tilt') void this.requestTilt();
        this.input.touchSteer = 0;
        sh.querySelectorAll('[data-scheme]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.scheme === scheme));
        sh.querySelector<HTMLElement>('.ts-tilt')!.hidden = scheme !== 'tilt';
        this.changed();
      }
      const act = t.closest<HTMLElement>('[data-ts]')?.dataset.ts;
      if (act === 'close') this.closeSheet();
      else if (act === 'edit') { this.closeSheet(); this.setEditing(true); }
      else if (act === 'reset') { S.pos = {}; this.changed(); }
      else if (act === 'level') this.tilt.zero = this.tilt.have ? this.tilt.raw : null;
      else if (act === 'fs') { void toggleFullscreen(); this.closeSheet(); }
    });
    sh.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.r === 'size') S.size = +t.value;
      if (t.dataset.r === 'opacity') S.opacity = +t.value;
      if (t.dataset.r === 'tiltRange') S.tiltRange = +t.value;
      if (t.dataset.c === 'leftHanded') S.leftHanded = t.checked;
      if (t.dataset.c === 'tiltInvert') S.tiltInvert = t.checked;
      sh.querySelector('[data-v="size"]')!.textContent = `${Math.round(S.size * 100)}%`;
      sh.querySelector('[data-v="opacity"]')!.textContent = `${Math.round(S.opacity * 100)}%`;
      sh.querySelector('[data-v="tilt"]')!.textContent = `${S.tiltRange}°`;
      this.changed();
    });
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
    this.input.touchSteer = 0;
    this.applyStyle();
    this.ctx = this.readCtx();
    this.refresh(true);
  }

  private changed() {
    saveTouchSettings();
    this.applyStyle();
    this.ctx = this.readCtx();
    this.refresh(true);
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
    document.body.classList.remove('touch-on', 'touch-portrait');
  }
}
