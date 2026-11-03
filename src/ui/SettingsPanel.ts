// Settings screen: tabs (Graphics, Audio, Controls, Gameplay, Accessibility), each with its own Reset button,
// plus key / gamepad rebinding. Rendered into the Menu card; owns its clicks, sliders and "press a key" capture.
import { ASSIST, QUALITY, type QualityName } from '../config';
import type { Action } from '../core/Input';
import { prefs, savePrefs } from '../core/prefs';
import { CAM_LABEL, CAM_VIEWS } from '../core/cameraViews';
import { applySettings, resetSettings, saveSettings, settings, type Layout, type Settings } from '../core/settings';
import { ACTIONS, LAYOUT_LABEL, SLOTS, actionLabel, bindKey, bindPad, clearSlot, keyLabel, resetBindings } from '../core/bindings';
import { BINDINGS, PAD } from '../core/Input';
import { anyPadConnected, buttonName, currentPadType, padFamily } from '../core/gamepad';
import { testRumble } from '../core/rumble';
import { escapeHtml } from '../utils/math';
import { isTouchDevice } from '../core/device';
import { TOUCH, saveTouchSettings, touchSettings, type TouchScheme } from './TouchLayout';
import { touchSettingsChanged } from './Touch';
import '../styles/settings.css';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'access';
type BindLayout = Layout | 'pad';
const TABS: [Tab, string][] = [['graphics', '🖥 Graphics'], ['audio', '🔊 Audio'], ['controls', '🎮 Controls'], ['gameplay', '🏍 Gameplay'], ['access', '♿ Accessibility']];

export interface SettingsHooks {
  rerender(): void;
  setQuality(q: QualityName): void;
  volumes(): void;
}
export interface SettingsCtx { quality: QualityName; keyTest: boolean; muted: boolean }

const K = (k: string) => `<kbd class="key">${k}</kbd>`;
const defaultQuality = (): QualityName => (matchMedia('(pointer: coarse)').matches ? 'low' : 'medium');

/** Sliders: setting key → [min, max, step, display]. Values in the DOM are the setting value × scale. */
const RANGES: Partial<Record<keyof Settings, { min: number; max: number; step: number; scale: number; fmt: (v: number) => string }>> = {
  fov: { min: 50, max: 95, step: 1, scale: 1, fmt: (v) => `${v}°` },
  renderScale: { min: 50, max: 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  shake: { min: 0, max: 100, step: 5, scale: 100, fmt: (v) => (v ? `${v}%` : 'Off') },
  hudScale: { min: 70, max: 140, step: 5, scale: 100, fmt: (v) => `${v}%` },
  hudOpacity: { min: 40, max: 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  deadzone: { min: 0, max: 40, step: 1, scale: 100, fmt: (v) => `${v}%` },
  sensitivity: { min: 50, max: 200, step: 5, scale: 100, fmt: (v) => `${v}%` },
  curve: { min: 10, max: 30, step: 1, scale: 10, fmt: (v) => (v <= 10 ? 'Linear' : `${(v / 10).toFixed(1)}×`) },
  rumble: { min: 0, max: 100, step: 5, scale: 1, fmt: (v) => (v ? `${v}%` : 'Off') },
};

/** Active "press a key / button" capture (menu navigation stays out of the way while this is set). */
let listening: { l: BindLayout; a: Action; slot: number } | null = null;
const panelOpen = () => !!document.querySelector('#menu .scr-settings') && document.getElementById('menu')?.style.display !== 'none';
export const isRebinding = () => listening !== null && panelOpen();

export class SettingsPanel {
  private tab: Tab = 'graphics';
  private layout: BindLayout = 'solo';
  private msg = '';
  private padRaf = 0;

  constructor(private root: HTMLElement, private h: SettingsHooks) {
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('input', (e) => this.slide(e, false));
    root.addEventListener('change', (e) => this.slide(e, true));
    addEventListener('keydown', (e) => this.captureKey(e), true);
  }

  render(c: SettingsCtx): string {
    const body = this.tab === 'graphics' ? this.graphics(c) : this.tab === 'audio' ? this.audio(c) : this.tab === 'controls' ? this.controls(c) : this.tab === 'gameplay' ? this.gameplay() : this.access();
    return `
    <h2>Settings</h2>
    <div class="set-tabs" role="tablist">${TABS.map(([t, l]) => `<button class="set-tab ${t === this.tab ? 'on' : ''}" role="tab" aria-selected="${t === this.tab}" data-stab="${t}">${l}</button>`).join('')}</div>
    <div class="set-body">${body}</div>
    <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button><button class="btn ghost" data-sreset="${this.tab}">↺ Reset ${escapeHtml(TABS.find(([t]) => t === this.tab)![1].replace(/^\S+ /, ''))}</button></div>`;
  }

  // ---------------------------------------------------------------- tabs
  private graphics(c: SettingsCtx) {
    return `
    <div class="opt"><span>Quality</span><div class="chips">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<button class="chip ${q === c.quality ? 'on' : ''}" data-quality="${q}">${QUALITY[q].label}</button>`).join('')}</div></div>
    <p class="hint">Low turns off shadows and shortens view distance. Use it on laptops, phones and in split screen if it stutters.</p>
    ${this.range('renderScale', 'Resolution')}
    <p class="hint">Renders fewer pixels and scales up: a big speed-up on high-DPI screens.</p>
    ${this.range('fov', 'Field of view')}
    ${this.chips('fpsCap', 'Frame cap', [[30, '30'], [60, '60'], [0, 'Unlimited']])}
    ${this.chips('showFps', 'FPS counter', [[false, 'Hide'], [true, 'Show']])}`;
  }

  private audio(c: SettingsCtx) {
    return `
    <div class="opt"><span>Music</span><div class="chips">${([['Off', 0], ['Low', 0.3], ['Med', 0.6], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.music === v ? 'on' : ''}" data-music="${v}">${l}</button>`).join('')}</div></div>
    <div class="opt"><span>Effects</span><div class="chips">${([['Off', 0], ['Low', 0.4], ['Med', 0.7], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.sfx === v ? 'on' : ''}" data-sfx="${v}">${l}</button>`).join('')}</div></div>
    <p class="hint">All sound is generated live: each vehicle has its own engine (cylinders, gears, turbo, exhaust crackle) and the soundtrack builds with the action.</p>
    <div class="opt"><span>Sound</span><div class="chips"><button class="chip" data-go="mute">${c.muted ? '🔇 Off' : '🔊 On'}</button></div></div>`;
  }

  private controls(c: SettingsCtx) {
    const l = this.layout, pad = l === 'pad';
    const lays: [BindLayout, string][] = [['solo', LAYOUT_LABEL.solo], ['p1', LAYOUT_LABEL.p1], ['p2', LAYOUT_LABEL.p2], ['pad', `🎮 Gamepad`]];
    const list = (a: Action): string[] => (pad ? PAD[a].map((b) => 'Pad' + b) : BINDINGS[l as Layout][a]);
    const rows = ACTIONS.filter(({ a }) => !(pad && a === 'camera')).map(({ a, label }) => {
      const keys = list(a), on = listening && listening.l === l && listening.a === a ? listening.slot : -1;
      const chip = (k: string | null, i: number) => `<button class="bkey ${on === i ? 'listen' : ''} ${k ? '' : 'add'}" data-bind="${a}" data-slot="${i}" title="${k ? 'Click to change' : 'Add a key'}">${on === i ? (pad ? 'Press a button…' : 'Press a key…') : k ? escapeHtml(keyLabel(k)) : '+'}</button>`;
      return `<div class="bind-row"><span>${label}</span><div class="bkeys">${keys.map((k, i) => chip(k, i)).join('')}${keys.length < SLOTS ? chip(null, keys.length) : ''}</div></div>`;
    }).join('');
    const pt = currentPadType();
    return `
    ${isTouchDevice() ? this.touch() : ''}
    <div class="chips set-sub">${lays.map(([k, t]) => `<button class="chip ${k === l ? 'on' : ''}" data-blay="${k}">${t}</button>`).join('')}</div>
    <p class="hint">${listening ? (pad ? `Press a gamepad button for <b>${actionLabel(listening.a)}</b> · ${K('Esc')} cancel · ${K('Del')} clear` : `Press a key for <b>${actionLabel(listening.a)}</b> · ${K('Esc')} cancel · ${K('Del')} clear`)
      : `Click a key to change it. A key already in use is swapped onto the other action. ${pad ? `Start (${buttonName(9, pt)}) always pauses; the right stick ↑ cycles the camera.` : `${K('Esc')} pause, ${K('M')} mute and ${K('H')} help are reserved.`}`}</p>
    ${this.msg ? `<p class="bind-msg">${escapeHtml(this.msg)}</p>` : ''}
    <div class="bind-table">${rows}</div>
    <div class="row-buttons left"><button class="btn ghost small" data-breset="${l}">↺ Default ${pad ? 'gamepad buttons' : `keys (${LAYOUT_LABEL[l as Layout]})`}</button></div>
    ${pad ? `
    <h3 class="set-h">Gamepad feel · ${anyPadConnected() ? `${padFamily(pt)} controller detected` : 'no controller connected (press a button)'}</h3>
    ${this.range('deadzone', 'Dead zone')}
    ${this.range('sensitivity', 'Steering sensitivity')}
    ${this.range('curve', 'Steering curve')}
    <p class="hint">Curve: Linear = stick maps straight to steering; higher = finer control around the centre, full lock at the edge.</p>
    ${this.chips('analogTriggers', 'Triggers', [[true, 'Analog'], [false, 'On / off']])}
    ${this.chips('invertLook', 'Look (R-stick)', [[false, 'Normal'], [true, 'Inverted']])}
    ${this.chips('invertY', 'L-stick ↑↓', [[false, 'Normal'], [true, 'Inverted']])}` : ''}
    <h3 class="set-h">Feedback</h3>
    ${this.range('rumble', 'Rumble')}<div class="opt"><span></span><div class="chips"><button class="chip" data-go-rumble>📳 Test</button></div></div>
    ${this.chips('vibrate', 'Phone vibration', [[true, 'On'], [false, 'Off']])}
    <h3 class="set-h">Keyboard</h3>
    <div class="opt"><span>Nitro</span><div class="chips"><button class="chip ${prefs.nitroToggle ? '' : 'on'}" data-go="nitroHold">Hold</button><button class="chip ${prefs.nitroToggle ? 'on' : ''}" data-go="nitroToggle">Tap to toggle</button></div></div>
    <p class="hint">Toggle mode helps keyboards that ignore 3 keys at once: tap nitro once, then only steer.</p>
    <div class="opt"><span>Test</span><div class="chips"><button class="chip ${c.keyTest ? 'on' : ''}" data-go="keytest">⌨ Test keys</button></div></div>
    ${c.keyTest ? `<div class="keytest" data-keytest></div>
    <p class="hint">Hold the keys you play with: each one lights up while the browser receives it. If ${K('←')} goes dark when you also hold ${K('Space')} + ${K('↑')}, your keyboard is <b>ghosting</b> (a hardware limit, many keyboards drop ↑ ← Space together but not ↑ → Space). Fixes: nitro drives by itself so let go of ${K('↑')}; use ${K('W')}${K('A')}${K('S')}${K('D')}; use ${K('N')} or ${K('B')} for nitro; or pick <b>Nitro: Tap to toggle</b> above. Tip: tapping Shift 5× may open Windows Sticky Keys, so prefer ${K('N')}/${K('B')} for tapping.</p>` : ''}`;
  }

  /** Phone / tablet: the same touch settings as the in-game ⚙ sheet (saved per device in moto:touch). */
  private touch() {
    const S = touchSettings, chip = (on: boolean, attr: string, l: string) => `<button class="chip ${on ? 'on' : ''}" ${attr}>${l}</button>`;
    const slider = (k: 'size' | 'opacity' | 'tiltRange', label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<div class="opt"><span>${label}</span><div class="srange"><input type="range" data-trange="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}" aria-label="${label}"><output>${fmt(S[k])}</output></div></div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return `
    <h3 class="set-h">📱 Touch controls</h3>
    <div class="opt"><span>Steering</span><div class="chips">${(([['buttons', '◀ ▶ Buttons'], ['stick', '🕹 Joystick'], ['tilt', '📱 Tilt']]) as [TouchScheme, string][]).map(([v, l]) => chip(S.scheme === v, `data-tscheme="${v}"`, l)).join('')}</div></div>
    ${slider('size', 'Button size', TOUCH.sizes[0], TOUCH.sizes[1], 0.05, pct)}
    ${slider('opacity', 'Button opacity', 0.2, 1, 0.05, pct)}
    ${S.scheme === 'tilt' ? slider('tiltRange', 'Tilt for full lock', 10, 40, 1, (v) => `${v}°`) : ''}
    <div class="opt"><span>Hands</span><div class="chips">${chip(!S.leftHanded, 'data-tflag="leftHanded" data-val="false"', 'Right-handed')}${chip(S.leftHanded, 'data-tflag="leftHanded" data-val="true"', 'Left-handed')}</div></div>
    ${S.scheme === 'tilt' ? `<div class="opt"><span>Tilt</span><div class="chips">${chip(!S.tiltInvert, 'data-tflag="tiltInvert" data-val="false"', 'Normal')}${chip(S.tiltInvert, 'data-tflag="tiltInvert" data-val="true"', 'Inverted')}</div></div>` : ''}
    <div class="opt"><span>Layout</span><div class="chips"><button class="chip" data-treset>↺ Default positions</button></div></div>
    <p class="hint">Drag buttons where your thumbs like them while riding: ⚙ on the top bar → ✥ Edit layout. Tilt steering asks for motion access the first time.</p>`;
  }

  private gameplay() {
    return `
    <div class="opt"><span>Assist</span><div class="chips">${ASSIST.map((a, i) => `<button class="chip ${prefs.assist === i ? 'on' : ''}" data-assist="${i}">${a.label}</button>`).join('')}</div></div>
    <p class="hint">Riding assist keeps the bike on the road when you're not steering, glances you off trees instead of stopping dead, and softens crashes. Pro = no help.</p>
    <div class="opt"><span>Camera</span><div class="chips">${CAM_VIEWS.map((v) => `<button class="chip ${(prefs.cams?.[0] ?? 'chase') === v ? 'on' : ''}" data-cam="${v}">${CAM_LABEL[v]}</button>`).join('')}</div></div>
    <p class="hint">Starting view for every player. Switch any time while riding with ${K(keyLabel(BINDINGS.solo.camera[0] ?? 'KeyV'))} (player 2: ${K(keyLabel(BINDINGS.p2.camera[0] ?? 'KeyL'))}, gamepad: right stick ↑). Each player keeps their own last choice.</p>
    ${this.chips('units', 'Speed', [['kmh', 'km/h'], ['mph', 'mph']])}
    ${this.range('shake', 'Camera shake')}`;
  }

  private access() {
    return `
    ${this.chips('reducedMotion', 'Reduced motion', [[false, 'Off'], [true, 'On']])}
    <p class="hint">Less camera shake and speed zoom, no speed lines or HUD animations.</p>
    ${this.chips('colorblind', 'Colours', [[false, 'Standard'], [true, 'Colourblind-safe']])}
    <p class="hint">Swaps red / green pairs on the HUD, minimap and checkpoints for blue / orange.</p>
    ${this.range('hudScale', 'HUD size')}
    ${this.range('hudOpacity', 'HUD opacity')}`;
  }

  // ---------------------------------------------------------------- widgets
  private range(k: keyof Settings, label: string) {
    const r = RANGES[k]!, v = Math.round((settings[k] as number) * r.scale);
    return `<div class="opt"><span>${label}</span><div class="srange"><input type="range" data-range="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-label="${label}"><output>${r.fmt(v)}</output></div></div>`;
  }

  private chips(k: keyof Settings, label: string, opts: [unknown, string][]) {
    return `<div class="opt"><span>${label}</span><div class="chips">${opts.map(([v, l]) => `<button class="chip ${settings[k] === v ? 'on' : ''}" data-set="${k}" data-val='${JSON.stringify(v)}'>${l}</button>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- events
  private inPanel(t: EventTarget | null) {
    return t instanceof Element && !!t.closest('.scr-settings');
  }

  private slide(e: Event, commit: boolean) {
    const t = e.target as HTMLInputElement;
    if (this.inPanel(t) && t.dataset.trange) {
      const k = t.dataset.trange as 'size' | 'opacity' | 'tiltRange';
      touchSettings[k] = +t.value;
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = k === 'tiltRange' ? `${t.value}°` : `${Math.round(+t.value * 100)}%`;
      if (commit) { saveTouchSettings(); touchSettingsChanged(); }
      return;
    }
    if (!this.inPanel(t) || !t.dataset.range) return;
    const k = t.dataset.range as keyof Settings, r = RANGES[k]!, v = +t.value;
    (settings as unknown as Record<string, number>)[k] = v / r.scale;
    const out = t.parentElement?.querySelector('output');
    if (out) out.textContent = r.fmt(v);
    applySettings();
    if (!commit) return;
    saveSettings();
    if (k === 'renderScale') this.h.setQuality(this.currentQuality());
  }

  private currentQuality(): QualityName {
    const on = this.root.querySelector<HTMLElement>('[data-quality].on')?.dataset.quality;
    return (on as QualityName) ?? defaultQuality();
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || !this.inPanel(t)) return;
    const d = t.dataset;
    if (d.stab) { this.tab = d.stab as Tab; this.stopListen(); this.msg = ''; return this.h.rerender(); }
    if (d.blay) { this.layout = d.blay as BindLayout; this.stopListen(); this.msg = ''; return this.h.rerender(); }
    if (d.set) {
      (settings as unknown as Record<string, unknown>)[d.set] = JSON.parse(d.val ?? 'null');
      saveSettings();
      return this.h.rerender();
    }
    if (d.bind) {
      listening = { l: this.layout, a: d.bind as Action, slot: +(d.slot ?? 0) };
      this.msg = '';
      (document.activeElement as HTMLElement | null)?.blur(); // Space / Enter must not re-press the button
      if (this.layout === 'pad') this.listenPad();
      return this.h.rerender();
    }
    if (d.breset) { resetBindings(d.breset as BindLayout); this.stopListen(); this.msg = 'Defaults restored'; return this.h.rerender(); }
    if (d.goRumble !== undefined) return testRumble();
    if (d.tscheme || d.tflag || d.treset !== undefined) {
      if (d.tscheme) touchSettings.scheme = d.tscheme as TouchScheme;
      if (d.tflag === 'leftHanded' || d.tflag === 'tiltInvert') touchSettings[d.tflag] = d.val === 'true';
      if (d.treset !== undefined) touchSettings.pos = {};
      saveTouchSettings();
      touchSettingsChanged();
      return this.h.rerender();
    }
    if (d.sreset) return this.resetTab(d.sreset as Tab);
  }

  private resetTab(tab: Tab) {
    this.stopListen();
    this.msg = '';
    if (tab === 'graphics') { resetSettings(['fov', 'renderScale', 'fpsCap', 'showFps']); this.h.setQuality(defaultQuality()); }
    if (tab === 'audio') { prefs.music = 0.6; prefs.sfx = 1; savePrefs(); this.h.volumes(); }
    if (tab === 'controls') {
      resetSettings(['deadzone', 'sensitivity', 'curve', 'analogTriggers', 'invertLook', 'invertY', 'rumble', 'vibrate']);
      (['solo', 'p1', 'p2', 'pad'] as const).forEach((l) => resetBindings(l));
      prefs.nitroToggle = false;
      savePrefs();
    }
    if (tab === 'gameplay') { resetSettings(['units', 'shake']); prefs.assist = 1; prefs.cams = ['chase', 'chase']; savePrefs(); }
    if (tab === 'access') resetSettings(['reducedMotion', 'colorblind', 'hudScale', 'hudOpacity']);
    this.h.rerender();
  }

  private stopListen() {
    listening = null;
    cancelAnimationFrame(this.padRaf);
  }

  private finish(msg: string) {
    this.stopListen();
    this.msg = msg;
    this.h.rerender();
  }

  private captureKey(e: KeyboardEvent) {
    const L = listening;
    if (!L) return;
    if (!panelOpen()) { this.stopListen(); return; } // left the screen mid-capture
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') return this.finish('');
    if (e.code === 'Delete') { clearSlot(L.l, L.a, L.slot); return this.finish(`${actionLabel(L.a)}: key cleared`); }
    if (L.l === 'pad') return; // waiting for a gamepad button
    this.finish(bindKey(L.l, L.a, L.slot, e.code));
  }

  /** Wait for a button that was not already held when listening started. */
  private listenPad() {
    cancelAnimationFrame(this.padRaf);
    const held = new Set<string>(), start = performance.now();
    const pads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);
    for (const p of pads()) p?.buttons.forEach((b, i) => b.pressed && held.add(`${p.index}:${i}`));
    const tick = () => {
      if (!listening || listening.l !== 'pad') return;
      if (!panelOpen()) return this.stopListen();
      if (performance.now() - start > 8000) return this.finish('No button pressed');
      for (const p of pads()) {
        if (!p?.connected) continue;
        for (let i = 0; i < p.buttons.length; i++) {
          const id = `${p.index}:${i}`;
          if (!p.buttons[i].pressed) { held.delete(id); continue; }
          if (held.has(id)) continue;
          const L = listening;
          return this.finish(bindPad(L.a, L.slot, i));
        }
      }
      this.padRaf = requestAnimationFrame(tick);
    };
    this.padRaf = requestAnimationFrame(tick);
  }
}
