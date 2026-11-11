// Settings screen: tabs (Display, Graphics, Audio, Controls, Gameplay, Accessibility, Account), sub-pages for Display
// (UI size, HUD, Camera) and Controls (Touch, Controller, Keyboard), each tab with its own Reset button, plus key /
// gamepad rebinding. Rendered into the Menu card; owns its clicks, sliders and "press a key" capture.
import { ASSIST, CAMERA, QUALITY, UI_SIZE, type QualityName } from '../config';
import type { Action } from '../core/Input';
import { prefs, savePrefs } from '../core/prefs';
import { CAM_LABEL, CAM_VIEWS } from '../core/cameraViews';
import { HUD_PARTS, applySettings, resetSettings, saveSettings, settings, type HudPart, type Layout, type PadPreset, type Settings } from '../core/settings';
import { ACTIONS, LAYOUT_LABEL, PAD_PRESETS, SLOTS, actionLabel, applyPadPreset, bindKey, bindPad, clearSlot, keyLabel, resetBindings } from '../core/bindings';
import { BINDINGS, PAD } from '../core/Input';
import { anyPadConnected, buttonName, currentPadType, padFamily } from '../core/gamepad';
import { testRumble } from '../core/rumble';
import { escapeHtml } from '../utils/math';
import { isTouchDevice } from '../core/device';
import { saveTouchSettings, touchDefaults, touchSettings } from './TouchLayout';
import { touchSettingsHtml, touchSettingsEvent } from './touchSettingsUi';
import { TouchControls, touchSettingsChanged } from './Touch';
import '../styles/settings.css';

type Tab = 'display' | 'graphics' | 'audio' | 'controls' | 'gameplay' | 'access' | 'account';
type Sub = 'ui' | 'hud' | 'camera' | 'touch' | 'pad' | 'keys';
type BindLayout = Layout | 'pad';
const TABS: [Tab, string][] = [['display', '📐 Display'], ['graphics', '🖥 Graphics'], ['audio', '🔊 Audio'], ['controls', '🎮 Controls'], ['gameplay', '🏍 Gameplay'], ['access', '♿ Accessibility'], ['account', '👤 Account']];
const SUBS: Partial<Record<Tab, [Sub, string][]>> = {
  display: [['ui', '🔠 UI size'], ['hud', '📊 HUD'], ['camera', '🎥 Camera']],
  controls: [['touch', '📱 Touch'], ['pad', '🎮 Controller'], ['keys', '⌨ Keyboard']],
};
const HUD_LABEL: Record<HudPart, string> = {
  stats: 'Status panel', minimap: 'Minimap', gauges: 'Speedo / gauges', nitro: 'Nitro bar', tower: 'Positions / timing tower', keycard: 'Key card', chat: 'Chat feed', objective: 'Objective text',
};

export interface SettingsHooks {
  rerender(): void;
  setQuality(q: QualityName): void;
  volumes(): void;
  /** Close the menu and open the touch layout editor; false when no game is running. */
  editTouch(): boolean;
}
export interface SettingsCtx { quality: QualityName; keyTest: boolean; muted: boolean }

const K = (k: string) => `<kbd class="key">${k}</kbd>`;
const defaultQuality = (): QualityName => (matchMedia('(pointer: coarse)').matches ? 'low' : 'medium');

/** Sliders: setting key → [min, max, step, display]. Values in the DOM are the setting value × scale. */
const RANGES: Partial<Record<keyof Settings, { min: number; max: number; step: number; scale: number; fmt: (v: number) => string }>> = {
  fov: { min: CAMERA.fov[0], max: CAMERA.fov[1], step: 1, scale: 1, fmt: (v) => `${v}°` },
  camDist: { min: CAMERA.dist[0] * 100, max: CAMERA.dist[1] * 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  camHeight: { min: CAMERA.height[0] * 100, max: CAMERA.height[1] * 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  renderScale: { min: 50, max: 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  shake: { min: 0, max: 100, step: 5, scale: 100, fmt: (v) => (v ? `${v}%` : 'Off') },
  uiScale: { min: UI_SIZE.fine[0] * 100, max: UI_SIZE.fine[1] * 100, step: 5, scale: 100, fmt: (v) => `${v}%` },
  edgePad: { min: UI_SIZE.edgePad[0], max: UI_SIZE.edgePad[1], step: 4, scale: 1, fmt: (v) => (v ? `${v} px` : 'Off') },
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
  private tab: Tab = 'display';
  private sub: Partial<Record<Tab, Sub>> = { display: 'ui', controls: isTouchDevice() ? 'touch' : 'keys' };
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
    const sub = this.sub[this.tab], subs = SUBS[this.tab];
    const body = this.tab === 'display' ? (sub === 'hud' ? this.hud() : sub === 'camera' ? this.camera() : this.uiSize())
      : this.tab === 'graphics' ? this.graphics(c) : this.tab === 'audio' ? this.audio(c)
      : this.tab === 'controls' ? (sub === 'touch' ? this.touch() : sub === 'pad' ? this.pad() : this.keys(c))
      : this.tab === 'gameplay' ? this.gameplay() : this.tab === 'access' ? this.access()
      : '<div class="acct-host" data-acct="settings"></div>'; // filled by ui/AccountPanel.ts
    return `
    <h2>Settings</h2>
    <div class="set-tabs" role="tablist">${TABS.map(([t, l]) => `<button class="set-tab ${t === this.tab ? 'on' : ''}" role="tab" aria-selected="${t === this.tab}" data-stab="${t}">${l}</button>`).join('')}</div>
    ${subs ? `<div class="chips set-subtabs">${subs.map(([s, l]) => `<button class="chip ${s === sub ? 'on' : ''}" data-ssub="${s}">${l}</button>`).join('')}</div>` : ''}
    <div class="set-body">${body}</div>
    <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button>${this.tab === 'account' ? '' : `<button class="btn ghost" data-sreset="${this.tab}">↺ Reset ${escapeHtml(TABS.find(([t]) => t === this.tab)![1].replace(/^\S+ /, ''))}</button>`}</div>`;
  }

  // ---------------------------------------------------------------- Display
  private uiSize() {
    return `
    ${this.chips('uiSize', 'UI size', [['auto', 'Auto'], ['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']])}
    <p class="hint">Menus and HUD together. Auto = Compact on short landscape screens (phones), Normal elsewhere: more of the game stays visible.</p>
    ${this.range('uiScale', 'Fine size')}
    ${this.range('edgePad', 'Edge padding')}
    <p class="hint">Keeps buttons and HUD away from a camera notch / punch-hole or curved edges, if your phone does not report them by itself.</p>`;
  }

  private hud() {
    return `
    ${this.range('hudScale', 'HUD size')}
    ${this.range('hudOpacity', 'HUD opacity')}
    ${this.chips('mapSize', 'Minimap', [[0.8, 'Small'], [1, 'Medium'], [1.2, 'Large']])}
    ${this.chips('gaugeStyle', 'Gauges', [['dial', '⏱ Dials'], ['digital', '🔢 Compact digital']])}
    <h3 class="set-h">Show on screen</h3>
    <div class="hud-toggles">${HUD_PARTS.map((p) => `<button class="chip ${settings.hudHide.includes(p) ? '' : 'on'}" data-hudpart="${p}" aria-pressed="${!settings.hudHide.includes(p)}">${HUD_LABEL[p]}</button>`).join('')}
      <button class="chip ${settings.showFps ? 'on' : ''}" data-set="showFps" data-val="${!settings.showFps}">FPS counter</button></div>
    <p class="hint">Tap to hide or show. Race positions, F1 timing and banners still appear when you need them unless switched off here.</p>`;
  }

  private camera() {
    return `
    <div class="opt"><span>View</span><div class="chips">${CAM_VIEWS.map((v) => `<button class="chip ${(prefs.cams?.[0] ?? 'chase') === v ? 'on' : ''}" data-cam="${v}">${CAM_LABEL[v]}</button>`).join('')}</div></div>
    <p class="hint">Starting view for every player. Switch any time while riding with ${K(keyLabel(BINDINGS.solo.camera[0] ?? 'KeyV'))} (player 2: ${K(keyLabel(BINDINGS.p2.camera[0] ?? 'KeyL'))}, gamepad: right stick ↑, touch: 🎥).</p>
    ${this.range('fov', 'Field of view')}
    ${this.range('camDist', 'Distance')}
    ${this.range('camHeight', 'Height')}
    <p class="hint">Zoom out: a little more distance, height and field of view show more of the road ahead (phones start at ${CAMERA.phone.fov}° · ${Math.round(CAMERA.phone.dist * 100)}%).</p>
    ${this.range('shake', 'Camera shake')}`;
  }

  // ---------------------------------------------------------------- other tabs
  private graphics(c: SettingsCtx) {
    return `
    <div class="opt"><span>Quality</span><div class="chips">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<button class="chip ${q === c.quality ? 'on' : ''}" data-quality="${q}">${QUALITY[q].label}</button>`).join('')}</div></div>
    <p class="hint">Low turns off shadows and shortens view distance. Use it on laptops, phones and in split screen if it stutters.</p>
    ${this.range('renderScale', 'Resolution')}
    <p class="hint">Renders fewer pixels and scales up: a big speed-up on high-DPI screens. The game also lowers it by itself while the frame rate drops.</p>
    ${this.chips('fpsCap', 'FPS target', [[30, '30'], [60, '60'], [0, 'Unlimited']])}
    <p class="hint">60 is smooth and keeps a 90 / 120 Hz phone cool; 30 saves the most battery.</p>
    ${this.chips('showFps', 'FPS counter', [[false, 'Hide'], [true, 'Show']])}`;
  }

  private audio(c: SettingsCtx) {
    return `
    <div class="opt"><span>Music</span><div class="chips">${([['Off', 0], ['Low', 0.3], ['Med', 0.6], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.music === v ? 'on' : ''}" data-music="${v}">${l}</button>`).join('')}</div></div>
    <div class="opt"><span>Effects</span><div class="chips">${([['Off', 0], ['Low', 0.4], ['Med', 0.7], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.sfx === v ? 'on' : ''}" data-sfx="${v}">${l}</button>`).join('')}</div></div>
    <p class="hint">All sound is generated live: each vehicle has its own engine (cylinders, gears, turbo, exhaust crackle) and the soundtrack builds with the action.</p>
    <div class="opt"><span>Sound</span><div class="chips"><button class="chip" data-go="mute">${c.muted ? '🔇 Off' : '🔊 On'}</button></div></div>`;
  }

  /** Rebind table for a keyboard layout or the gamepad. */
  private bindTable(l: BindLayout) {
    const pad = l === 'pad';
    const list = (a: Action): string[] => (pad ? PAD[a].map((b) => 'Pad' + b) : BINDINGS[l as Layout][a]);
    const rows = ACTIONS.filter(({ a }) => !(pad && a === 'camera')).map(({ a, label }) => {
      const keys = list(a), on = listening && listening.l === l && listening.a === a ? listening.slot : -1;
      const chip = (k: string | null, i: number) => `<button class="bkey ${on === i ? 'listen' : ''} ${k ? '' : 'add'}" data-bind="${a}" data-slot="${i}" title="${k ? 'Click to change' : 'Add a key'}">${on === i ? (pad ? 'Press a button…' : 'Press a key…') : k ? escapeHtml(keyLabel(k)) : '+'}</button>`;
      return `<div class="bind-row"><span>${label}</span><div class="bkeys">${keys.map((k, i) => chip(k, i)).join('')}${keys.length < SLOTS ? chip(null, keys.length) : ''}</div></div>`;
    }).join('');
    return `${this.msg ? `<p class="bind-msg">${escapeHtml(this.msg)}</p>` : ''}<div class="bind-table">${rows}</div>`;
  }

  private touch() {
    if (!isTouchDevice()) return '<p class="hint">No touch screen on this device. Touch controls appear by themselves on phones and tablets.</p>';
    return `${touchSettingsHtml(!!TouchControls.current)}
    <h3 class="set-h">Feedback</h3>
    ${this.chips('vibrate', 'Crash vibration', [[true, 'On'], [false, 'Off']])}`;
  }

  private pad() {
    const pt = currentPadType(), on = anyPadConnected();
    return `
    <p class="pad-status ${on ? 'on' : ''}">${on ? `🎮 ${padFamily(pt)} controller connected` : '🎮 No controller yet: connect one by Bluetooth or USB, then press any button'}</p>
    <div class="opt"><span>Preset</span><div class="chips">${PAD_PRESETS.map((p) => `<button class="chip ${settings.padPreset === p.id ? 'on' : ''}" data-padpreset="${p.id}">${p.label}</button>`).join('')}${settings.padPreset === 'custom' ? '<button class="chip on" disabled>Custom</button>' : ''}</div></div>
    <p class="hint">${escapeHtml(PAD_PRESETS.find((p) => p.id === settings.padPreset)?.hint ?? 'Your own buttons (rebound below).')}</p>
    ${isTouchDevice() ? `<div class="opt"><span>Touch buttons</span><div class="chips"><button class="chip ${touchSettings.padHide ? 'on' : ''}" data-tpadhide="true">Hide with controller</button><button class="chip ${touchSettings.padHide ? '' : 'on'}" data-tpadhide="false">Keep</button></div></div>` : ''}
    <h3 class="set-h">Buttons</h3>
    <p class="hint">${listening ? `Press a gamepad button for <b>${actionLabel(listening.a)}</b> · ${K('Esc')} cancel · ${K('Del')} clear` : `Tap a button to change it. Start (${buttonName(9, pt)}) always pauses; the right stick ↑ cycles the camera.`}</p>
    ${this.bindTable('pad')}
    <div class="row-buttons left"><button class="btn ghost small" data-breset="pad">↺ Default gamepad buttons</button></div>
    <h3 class="set-h">Feel</h3>
    ${this.range('deadzone', 'Dead zone')}
    ${this.range('sensitivity', 'Steering sensitivity')}
    ${this.range('curve', 'Steering curve')}
    <p class="hint">Curve: Linear = stick maps straight to steering; higher = finer control around the centre, full lock at the edge.</p>
    ${this.chips('analogTriggers', 'Triggers', [[true, 'Analog'], [false, 'On / off']])}
    ${this.chips('invertLook', 'Look stick', [[false, 'Normal'], [true, 'Inverted']])}
    ${this.chips('invertY', 'Drive stick ↑↓', [[false, 'Normal'], [true, 'Inverted']])}
    ${this.range('rumble', 'Rumble')}<div class="opt"><span></span><div class="chips"><button class="chip" data-go-rumble>📳 Test</button></div></div>`;
  }

  private keys(c: SettingsCtx) {
    const l = this.layout === 'pad' ? 'solo' : this.layout;
    const lays: [Layout, string][] = [['solo', LAYOUT_LABEL.solo], ['p1', LAYOUT_LABEL.p1], ['p2', LAYOUT_LABEL.p2]];
    return `
    <div class="chips set-sub">${lays.map(([k, t]) => `<button class="chip ${k === l ? 'on' : ''}" data-blay="${k}">${t}</button>`).join('')}</div>
    <p class="hint">${listening ? `Press a key for <b>${actionLabel(listening.a)}</b> · ${K('Esc')} cancel · ${K('Del')} clear`
      : `Click a key to change it. A key already in use is swapped onto the other action. ${K('Esc')} pause, ${K('M')} mute and ${K('H')} help are reserved.`}</p>
    ${this.bindTable(l)}
    <div class="row-buttons left"><button class="btn ghost small" data-breset="${l}">↺ Default keys (${LAYOUT_LABEL[l]})</button></div>
    <div class="opt"><span>Nitro</span><div class="chips"><button class="chip ${prefs.nitroToggle ? '' : 'on'}" data-go="nitroHold">Hold</button><button class="chip ${prefs.nitroToggle ? 'on' : ''}" data-go="nitroToggle">Tap to toggle</button></div></div>
    <p class="hint">Toggle mode helps keyboards that ignore 3 keys at once: tap nitro once, then only steer.</p>
    <div class="opt"><span>Test</span><div class="chips"><button class="chip ${c.keyTest ? 'on' : ''}" data-go="keytest">⌨ Test keys</button></div></div>
    ${c.keyTest ? `<div class="keytest" data-keytest></div>
    <p class="hint">Hold the keys you play with: each one lights up while the browser receives it. If ${K('←')} goes dark when you also hold ${K('Space')} + ${K('↑')}, your keyboard is <b>ghosting</b> (a hardware limit, many keyboards drop ↑ ← Space together but not ↑ → Space). Fixes: nitro drives by itself so let go of ${K('↑')}; use ${K('W')}${K('A')}${K('S')}${K('D')}; use ${K('N')} or ${K('B')} for nitro; or pick <b>Nitro: Tap to toggle</b> above. Tip: tapping Shift 5× may open Windows Sticky Keys, so prefer ${K('N')}/${K('B')} for tapping.</p>` : ''}`;
  }

  private gameplay() {
    return `
    <div class="opt"><span>Assist</span><div class="chips">${ASSIST.map((a, i) => `<button class="chip ${prefs.assist === i ? 'on' : ''}" data-assist="${i}">${a.label}</button>`).join('')}</div></div>
    <p class="hint">Riding assist keeps the bike on the road when you're not steering, glances you off trees instead of stopping dead, and softens crashes. Pro = no help.</p>
    ${this.chips('units', 'Speed', [['kmh', 'km/h'], ['mph', 'mph']])}
    <p class="hint">Camera view, field of view and zoom are in Display → Camera.</p>`;
  }

  private access() {
    return `
    ${this.chips('reducedMotion', 'Reduced motion', [[false, 'Off'], [true, 'On']])}
    <p class="hint">Less camera shake and speed zoom, no speed lines or HUD animations.</p>
    ${this.chips('colorblind', 'Colours', [[false, 'Standard'], [true, 'Colourblind-safe']])}
    <p class="hint">Swaps red / green pairs on the HUD, minimap and checkpoints for blue / orange. Text and HUD size: Display → UI size and HUD.</p>`;
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
    if (!this.inPanel(t)) return;
    if (t.dataset.trange) { touchSettingsEvent(e, commit, touchSettingsChanged); return; }
    if (!t.dataset.range) return;
    const k = t.dataset.range as keyof Settings, r = RANGES[k]!, v = +t.value;
    (settings as unknown as Record<string, number>)[k] = v / r.scale;
    const out = t.parentElement?.querySelector('output');
    if (out) out.textContent = r.fmt(v);
    if (k !== 'uiScale') applySettings(); // the UI size applies on release: re-zooming under the finger makes the slider jump
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
    if (d.ssub) {
      this.sub[this.tab] = d.ssub as Sub;
      this.layout = d.ssub === 'pad' ? 'pad' : 'solo';
      this.stopListen();
      this.msg = '';
      return this.h.rerender();
    }
    if (d.blay) { this.layout = d.blay as BindLayout; this.stopListen(); this.msg = ''; return this.h.rerender(); }
    if (d.set) {
      (settings as unknown as Record<string, unknown>)[d.set] = JSON.parse(d.val ?? 'null');
      saveSettings();
      return this.h.rerender();
    }
    if (d.hudpart) {
      const p = d.hudpart as HudPart;
      settings.hudHide = settings.hudHide.includes(p) ? settings.hudHide.filter((x) => x !== p) : [...settings.hudHide, p];
      saveSettings();
      return this.h.rerender();
    }
    if (d.padpreset) { applyPadPreset(d.padpreset as PadPreset); this.msg = ''; return this.h.rerender(); }
    if (d.tpadhide) { touchSettings.padHide = d.tpadhide === 'true'; saveTouchSettings(); touchSettingsChanged(); return this.h.rerender(); }
    if (d.bind) {
      listening = { l: this.layout, a: d.bind as Action, slot: +(d.slot ?? 0) };
      this.msg = '';
      (document.activeElement as HTMLElement | null)?.blur(); // Space / Enter must not re-press the button
      if (this.layout === 'pad') this.listenPad();
      return this.h.rerender();
    }
    if (d.breset) { resetBindings(d.breset as BindLayout); this.stopListen(); this.msg = 'Defaults restored'; return this.h.rerender(); }
    if (d.goRumble !== undefined) return testRumble();
    if (d.sreset) return this.resetTab(d.sreset as Tab);
    const r = touchSettingsEvent(e, true, touchSettingsChanged);
    if (r === 'edit' && !this.h.editTouch()) { this.msg = 'Start a ride first'; return this.h.rerender(); }
    if (r === 'level') TouchControls.current?.calibrate();
    if (r === 'render') this.h.rerender();
  }

  private resetTab(tab: Tab) {
    this.stopListen();
    this.msg = '';
    if (tab === 'display') {
      resetSettings(['uiSize', 'uiScale', 'edgePad', 'hudScale', 'hudOpacity', 'hudHide', 'mapSize', 'gaugeStyle', 'showFps', 'fov', 'camDist', 'camHeight', 'shake']);
      prefs.cams = ['chase', 'chase'];
      savePrefs();
    }
    if (tab === 'graphics') { resetSettings(['renderScale', 'fpsCap', 'showFps']); this.h.setQuality(defaultQuality()); }
    if (tab === 'audio') { prefs.music = 0.6; prefs.sfx = 1; savePrefs(); this.h.volumes(); }
    if (tab === 'controls') {
      resetSettings(['deadzone', 'sensitivity', 'curve', 'analogTriggers', 'invertLook', 'invertY', 'rumble', 'vibrate', 'padPreset', 'padSticks']);
      (['solo', 'p1', 'p2', 'pad'] as const).forEach((l) => resetBindings(l));
      prefs.nitroToggle = false;
      savePrefs();
      if (isTouchDevice()) {
        const slots = touchSettings.slots; // saved layouts survive a reset
        Object.assign(touchSettings, touchDefaults(), { slots });
        saveTouchSettings();
        touchSettingsChanged();
      }
    }
    if (tab === 'gameplay') { resetSettings(['units']); prefs.assist = 1; savePrefs(); }
    if (tab === 'access') resetSettings(['reducedMotion', 'colorblind']);
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
