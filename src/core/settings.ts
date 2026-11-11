// Extra settings (display, graphics, camera, HUD, controller feel, accessibility, key bindings) saved next to prefs under
// their own key. Gameplay reads small helpers from here (fovOffset, shakeScale, spd ...) so the hot paths stay one-liners.
import type { Action } from './Input';
import { CAMERA, UI_SIZE } from '../config';
import { mergeSaved, parseJson } from '../utils/store';
import { markChanged } from './syncBus';

export type Layout = 'solo' | 'p1' | 'p2';
export type SpeedUnit = 'kmh' | 'mph';
export type UiSize = 'auto' | 'compact' | 'normal' | 'large';
export type GaugeStyle = 'dial' | 'digital';
export type PadPreset = 'default' | 'racing' | 'classic' | 'southpaw' | 'custom';
/** HUD elements the player can switch off (Settings → Display → HUD). */
export const HUD_PARTS = ['stats', 'minimap', 'gauges', 'nitro', 'tower', 'keycard', 'chat', 'objective'] as const;
export type HudPart = (typeof HUD_PARTS)[number];

export interface Settings {
  /** Base field of view in degrees (the chase camera default is CAMERA.baseFov). */
  fov: number;
  /** Chase camera distance / height multipliers (Settings → Display → Camera). */
  camDist: number;
  camHeight: number;
  /** Multiplier on the quality preset's pixel ratio (0.5 = half resolution). */
  renderScale: number;
  /** Frame-rate cap: 0 = unlimited. */
  fpsCap: 0 | 30 | 60;
  showFps: boolean;
  units: SpeedUnit;
  /** Camera shake amount 0..1. */
  shake: number;
  reducedMotion: boolean;
  colorblind: boolean;
  /** Global size of menus and HUD: a preset (auto = compact on short landscape screens) times the fine slider. */
  uiSize: UiSize;
  uiScale: number;
  /** Extra padding (px) on every screen edge, for WebViews that report no safe-area insets around a notch. */
  edgePad: number;
  hudScale: number;
  hudOpacity: number;
  /** HUD elements switched off. */
  hudHide: HudPart[];
  /** Minimap size multiplier. */
  mapSize: number;
  gaugeStyle: GaugeStyle;
  /** Gamepad: stick dead zone 0..0.4, steering sensitivity 0.5..2, response curve 1 (linear) .. 3 (gentle centre). */
  deadzone: number;
  sensitivity: number;
  curve: number;
  analogTriggers: boolean;
  invertLook: boolean;
  invertY: boolean;
  /** Last controller preset picked ('custom' once a button is rebound by hand). */
  padPreset: PadPreset;
  /** Southpaw: steer with the right stick, look with the left. */
  padSticks: 'normal' | 'swapped';
  /** Controller rumble 0..100 (0 = off). */
  rumble: number;
  /** Phone vibration on crashes and hard landings. */
  vibrate: boolean;
  /** User key overrides per keyboard layout (missing action = default). */
  keys: Partial<Record<Layout, Partial<Record<Action, string[]>>>>;
  /** User gamepad button overrides (standard mapping indices). */
  pad: Partial<Record<Action, number[]>>;
}

const KEY = 'moto:settings';
const reducedDefault = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A phone (coarse pointer, short screen side): gets the wider camera and a 60 fps cap by default. */
export function isPhoneScreen() {
  try {
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= UI_SIZE.phoneShortSide;
  } catch {
    return false;
  }
}

/** Defaults; phones get a slightly wider, further camera (wide 20:9 landscape) and a 60 fps cap (90/120 Hz panels run hot). */
export function settingDefaults(phone: boolean): Settings {
  return {
    fov: phone ? CAMERA.phone.fov : CAMERA.baseFov, camDist: phone ? CAMERA.phone.dist : 1, camHeight: phone ? CAMERA.phone.height : 1,
    renderScale: 1, fpsCap: phone ? 60 : 0, showFps: false, units: 'kmh', shake: 1, reducedMotion: reducedDefault, colorblind: false,
    uiSize: 'auto', uiScale: 1, edgePad: 0, hudScale: 1, hudOpacity: 1, hudHide: [], mapSize: 1, gaugeStyle: 'dial',
    deadzone: 0.15, sensitivity: 1, curve: 1.6, analogTriggers: true, invertLook: false, invertY: false, padPreset: 'default', padSticks: 'normal',
    rumble: 70, vibrate: true, keys: {}, pad: {},
  };
}

export const SETTING_DEFAULTS: Settings = settingDefaults(isPhoneScreen());

/** Allowed ranges / values: anything outside (old versions, hand edits, a damaged cloud save) is clamped or falls back. */
const NUM: Partial<Record<keyof Settings, readonly [number, number]>> = {
  fov: CAMERA.fov, camDist: CAMERA.dist, camHeight: CAMERA.height, renderScale: [0.5, 1], shake: [0, 1], uiScale: UI_SIZE.fine, edgePad: UI_SIZE.edgePad,
  hudScale: [0.7, 1.4], hudOpacity: [0.4, 1], mapSize: [0.7, 1.3], deadzone: [0, 0.4], sensitivity: [0.5, 2], curve: [1, 3], rumble: [0, 100],
};
const ONE_OF: Partial<Record<keyof Settings, readonly unknown[]>> = {
  fpsCap: [0, 30, 60], units: ['kmh', 'mph'], uiSize: ['auto', 'compact', 'normal', 'large'], gaugeStyle: ['dial', 'digital'],
  padPreset: ['default', 'racing', 'classic', 'southpaw', 'custom'], padSticks: ['normal', 'swapped'],
};

/** Saved settings over the defaults: known keys of the right type only, numbers clamped, choices checked. */
export function cleanSettings(raw: unknown, base: Settings = SETTING_DEFAULTS): Settings {
  const out = mergeSaved(structuredClone(base), raw) as unknown as Record<string, unknown>, def = base as unknown as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(NUM) as [string, readonly [number, number]][]) out[k] = Math.min(hi, Math.max(lo, out[k] as number));
  for (const [k, list] of Object.entries(ONE_OF) as [string, readonly unknown[]][]) if (!list.includes(out[k])) out[k] = structuredClone(def[k]);
  out.hudHide = [...new Set((out.hudHide as unknown[]).filter((p): p is HudPart => (HUD_PARTS as readonly unknown[]).includes(p)))];
  return out as unknown as Settings;
}

export const settings: Settings = (() => {
  try {
    return cleanSettings(parseJson(localStorage.getItem(KEY))); // wrong-typed fields fall back to defaults
  } catch {
    return structuredClone(SETTING_DEFAULTS);
  }
})();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not persisted */
  }
  markChanged('settings');
  applySettings();
}

/** Put the listed settings back to their defaults (used by each tab's Reset button). */
export function resetSettings(keys: (keyof Settings)[]) {
  const s = settings as unknown as Record<string, unknown>, d = SETTING_DEFAULTS as unknown as Record<string, unknown>;
  for (const k of keys) s[k] = structuredClone(d[k]);
  saveSettings();
}

/** The UI size factor for a viewport: the preset (auto = compact on a short landscape screen) times the fine slider. */
export function uiFactor(s: Pick<Settings, 'uiSize' | 'uiScale'>, w: number, h: number) {
  const size = s.uiSize === 'auto' ? (w > h && h <= UI_SIZE.compactMaxH ? 'compact' : 'normal') : s.uiSize;
  return Math.round(UI_SIZE.presets[size] * s.uiScale * 1000) / 1000;
}

let resizeHooked = false;
const applyUi = () => document.documentElement.style.setProperty('--ui', String(uiFactor(settings, innerWidth, innerHeight)));

/** Body classes and CSS variables: UI size, edge padding, HUD scale / opacity / parts / minimap / gauges, colourblind palette, reduced motion. */
export function applySettings() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('cb-safe', settings.colorblind);
  b.classList.toggle('reduce-motion', settings.reducedMotion);
  b.classList.toggle('gauge-digital', settings.gaugeStyle === 'digital');
  for (const p of HUD_PARTS) b.classList.toggle(`hudx-${p}`, settings.hudHide.includes(p));
  b.style.setProperty('--hud-scale', String(settings.hudScale));
  b.style.setProperty('--hud-opacity', String(settings.hudOpacity));
  b.style.setProperty('--map-user', String(settings.mapSize));
  document.documentElement.style.setProperty('--edge', `${settings.edgePad}px`);
  applyUi();
  if (!resizeHooked) {
    resizeHooked = true;
    addEventListener('resize', applyUi); // "auto" follows rotation
  }
  fpsEl?.classList.toggle('on', settings.showFps);
}

// ---------------------------------------------------------------- helpers read by gameplay / HUD
/** km/h → the chosen unit. */
export const spd = (kmh: number) => (settings.units === 'mph' ? kmh * 0.621371 : kmh);
export const speedUnit = () => (settings.units === 'mph' ? 'mph' : 'km/h');
/** "120 km/h" in the chosen unit. */
export const fmtSpeed = (kmh: number) => `${Math.round(spd(kmh))} ${speedUnit()}`;
export const fovOffset = () => settings.fov - CAMERA.baseFov;
export const shakeScale = () => settings.shake * (settings.reducedMotion ? 0.25 : 1);
/** Speed-dependent FOV widening and similar motion effects. */
export const motionScale = () => (settings.reducedMotion ? 0.3 : 1);

/** Colourblind-safe swaps (Okabe-Ito): green/red pairs become blue/orange. */
const CB: Record<string, string> = {
  '#7cffb2': '#56b4e9', '#39c46a': '#56b4e9', '#5dff8a': '#56b4e9', '#3c8dff': '#cc79a7', '#ff3355': '#e69f00', '#ff4d5e': '#e69f00', '#ff3040': '#e69f00',
};
export const pal = (c: string) => (settings.colorblind ? CB[c] ?? c : c);

// ---------------------------------------------------------------- frame cap + FPS counter
let fpsEl: HTMLDivElement | null = null;
let frames = 0, fpsT = 0, due = 0;

/** Frame pacing for a cap: render when the next slot is due and keep the cadence, so a 60 cap on a 90 Hz screen renders
 *  2 of every 3 frames (60 fps) instead of every other one (45). Returns the new due time, or -1 to skip this frame. */
export function paceFrame(now: number, due: number, cap: number) {
  const iv = 1000 / cap;
  if (now < due - 1.5) return -1;
  return Math.max(due + iv, now + iv * 0.5);
}

/** Called at the top of every animation frame: true = skip this frame (frame-rate cap). Also feeds the FPS counter. */
export function skipFrame(now: number) {
  const cap = settings.fpsCap;
  if (cap) {
    const next = paceFrame(now, due, cap);
    if (next < 0) return true;
    due = next;
  }
  if (settings.showFps) {
    if (!fpsEl) {
      fpsEl = document.createElement('div');
      fpsEl.className = 'fps-counter on';
      document.body.appendChild(fpsEl);
    }
    frames++;
    if (now - fpsT >= 500) {
      fpsEl.textContent = `${Math.round((frames * 1000) / Math.max(1, now - fpsT))} FPS`;
      frames = 0;
      fpsT = now;
    }
  }
  return false;
}
