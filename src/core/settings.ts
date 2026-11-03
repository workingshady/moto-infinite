// Extra settings (graphics, controller feel, accessibility, key bindings) saved next to prefs under their own key.
// Gameplay reads small helpers from here (fovOffset, shakeScale, spd ...) so the hot paths stay one-liners.
import type { Action } from './Input';
import { mergeSaved, parseJson } from '../utils/store';

export type Layout = 'solo' | 'p1' | 'p2';
export type SpeedUnit = 'kmh' | 'mph';

export interface Settings {
  /** Base field of view in degrees (the chase camera default is 62). */
  fov: number;
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
  hudScale: number;
  hudOpacity: number;
  /** Gamepad: stick dead zone 0..0.4, steering sensitivity 0.5..2, response curve 1 (linear) .. 3 (gentle centre). */
  deadzone: number;
  sensitivity: number;
  curve: number;
  analogTriggers: boolean;
  invertLook: boolean;
  invertY: boolean;
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

export const SETTING_DEFAULTS: Settings = {
  fov: 62, renderScale: 1, fpsCap: 0, showFps: false, units: 'kmh', shake: 1, reducedMotion: reducedDefault, colorblind: false,
  hudScale: 1, hudOpacity: 1, deadzone: 0.15, sensitivity: 1, curve: 1.6, analogTriggers: true, invertLook: false, invertY: false,
  rumble: 70, vibrate: true, keys: {}, pad: {},
};

export const settings: Settings = (() => {
  try {
    return mergeSaved(structuredClone(SETTING_DEFAULTS), parseJson(localStorage.getItem(KEY))); // wrong-typed fields fall back to defaults
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
  applySettings();
}

/** Put the listed settings back to their defaults (used by each tab's Reset button). */
export function resetSettings(keys: (keyof Settings)[]) {
  const s = settings as unknown as Record<string, unknown>, d = SETTING_DEFAULTS as unknown as Record<string, unknown>;
  for (const k of keys) s[k] = structuredClone(d[k]);
  saveSettings();
}

/** Body classes and CSS variables for HUD scale / opacity, colourblind palette and reduced motion. */
export function applySettings() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('cb-safe', settings.colorblind);
  b.classList.toggle('reduce-motion', settings.reducedMotion);
  b.style.setProperty('--hud-scale', String(settings.hudScale));
  b.style.setProperty('--hud-opacity', String(settings.hudOpacity));
  fpsEl?.classList.toggle('on', settings.showFps);
}

// ---------------------------------------------------------------- helpers read by gameplay / HUD
/** km/h → the chosen unit. */
export const spd = (kmh: number) => (settings.units === 'mph' ? kmh * 0.621371 : kmh);
export const speedUnit = () => (settings.units === 'mph' ? 'mph' : 'km/h');
/** "120 km/h" in the chosen unit. */
export const fmtSpeed = (kmh: number) => `${Math.round(spd(kmh))} ${speedUnit()}`;
export const fovOffset = () => settings.fov - SETTING_DEFAULTS.fov;
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
let frames = 0, fpsT = 0;

/** Called at the top of every animation frame: true = skip this frame (frame-rate cap). Also feeds the FPS counter. */
export function skipFrame(now: number, last: number) {
  const cap = settings.fpsCap;
  if (cap && now - last < 1000 / cap - 2) return true;
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
