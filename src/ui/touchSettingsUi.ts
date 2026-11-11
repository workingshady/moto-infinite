// The touch-controls options, shared by Settings → Controls → Touch and the in-game ⚙ sheet: presets, sizes, steering
// feel, tilt, haptics, labels, controller auto-hide, saved layouts. Renders HTML and handles its clicks / sliders.
import { TOUCH, TOUCH_PRESETS, applyTouchPreset, loadTouchSlot, saveTouchSettings, saveTouchSlot, touchPreset, touchSettings as S, type TouchPreset } from './TouchLayout';

type RangeKey = 'size' | 'opacity' | 'tiltRange' | 'sens' | 'dead' | 'smooth';
const pct = (v: number) => `${Math.round(v * 100)}%`;
const RANGES: Record<RangeKey, { label: string; r: readonly [number, number]; step: number; fmt: (v: number) => string }> = {
  size: { label: 'Button size', r: TOUCH.sizes, step: 0.05, fmt: pct },
  opacity: { label: 'Opacity', r: TOUCH.opacity, step: 0.05, fmt: pct },
  sens: { label: 'Steering sensitivity', r: TOUCH.sens, step: 0.05, fmt: pct },
  dead: { label: 'Dead zone', r: TOUCH.deadRange, step: 0.01, fmt: pct },
  smooth: { label: 'Smoothing', r: TOUCH.smooth, step: 0.05, fmt: (v) => (v ? pct(v) : 'Off') },
  tiltRange: { label: 'Tilt for full lock', r: TOUCH.tiltRange, step: 1, fmt: (v) => `${v}°` },
};

const chip = (on: boolean, attr: string, l: string) => `<button class="chip ${on ? 'on' : ''}" ${attr}>${l}</button>`;
const slider = (k: RangeKey) => {
  const d = RANGES[k];
  return `<div class="opt"><span>${d.label}</span><div class="srange"><input type="range" data-trange="${k}" min="${d.r[0]}" max="${d.r[1]}" step="${d.step}" value="${S[k]}" aria-label="${d.label}"><output>${d.fmt(S[k])}</output></div></div>`;
};
const flag = (k: 'leftHanded' | 'tiltInvert' | 'haptics' | 'padHide', label: string, off: string, on: string) =>
  `<div class="opt"><span>${label}</span><div class="chips">${chip(!S[k], `data-tflag="${k}" data-val="false"`, off)}${chip(S[k], `data-tflag="${k}" data-val="true"`, on)}</div></div>`;

/** `live`: a game is running, so Edit layout and Set level work right away. */
export function touchSettingsHtml(live: boolean) {
  const pre = touchPreset(S), steer = S.scheme !== 'buttons';
  const slots = S.slots.map((s, i) => `<div class="tslot"><span>${i + 1}. ${s ? `<b>${s.name}</b> <small>${TOUCH_PRESETS.find((p) => p.id === touchPreset(s))?.label ?? ''}</small>` : '<em>empty</em>'}</span>
    <button class="chip" data-tslot-save="${i}">💾 Save</button><button class="chip" data-tslot-load="${i}" ${s ? '' : 'disabled'}>⤓ Load</button></div>`).join('');
  return `
    <div class="opt"><span>Layout</span><div class="chips">${TOUCH_PRESETS.map((p) => chip(pre === p.id, `data-tpreset="${p.id}"`, p.label)).join('')}</div></div>
    <div class="opt"><span></span><div class="chips">${live ? '<button class="chip hot" data-tact="edit">✥ Edit layout</button>' : ''}<button class="chip" data-tact="reset">↺ Default positions &amp; sizes</button></div></div>
    <p class="hint">${live ? 'Edit layout: drag any button, tap it to resize it on its own. It snaps to a grid and lines up with the others.' : 'Edit layout (drag, resize each button) is on the ⚙ button while riding.'}</p>
    ${slider('size')}${slider('opacity')}
    ${steer ? `${slider('sens')}${slider('dead')}${slider('smooth')}` : ''}
    ${S.scheme === 'tilt' ? `${slider('tiltRange')}${flag('tiltInvert', 'Tilt', 'Normal', 'Inverted')}${live ? '<div class="opt"><span></span><div class="chips"><button class="chip" data-tact="level">⟲ Calibrate: this is level</button></div></div>' : ''}` : ''}
    ${flag('leftHanded', 'Hands', 'Right-handed', 'Left-handed')}
    ${flag('haptics', 'Haptics', 'Off', 'On')}
    <div class="opt"><span>Labels</span><div class="chips">${chip(S.labels === 'text', 'data-tlabels="text"', 'GAS · NOS')}${chip(S.labels === 'icons', 'data-tlabels="icons"', '▲ · ⚡ icons')}</div></div>
    ${flag('padHide', 'Controller', 'Keep buttons', 'Hide buttons')}
    <p class="hint">With a Bluetooth / USB controller connected the on-screen buttons hide by themselves (pause and camera stay).</p>
    <h3 class="set-h">Saved layouts</h3><div class="tslots">${slots}</div>`;
}

/** Handle a click / slider event inside the touch options. Returns what happened: 'edit' / 'level' (caller acts),
 *  'render' (re-render the options), 'live' (value changed in place) or null (not ours). */
export function touchSettingsEvent(e: Event, commit: boolean, changed: () => void): 'edit' | 'level' | 'render' | 'live' | null {
  const t = e.target as HTMLElement;
  if (e.type === 'input' || e.type === 'change') {
    const k = (t as HTMLInputElement).dataset.trange as RangeKey | undefined;
    if (!k) return null;
    S[k] = +(t as HTMLInputElement).value;
    const out = t.parentElement?.querySelector('output');
    if (out) out.textContent = RANGES[k].fmt(S[k]);
    if (commit) { saveTouchSettings(); changed(); }
    return 'live';
  }
  const b = t.closest<HTMLElement>('button');
  if (!b) return null;
  const d = b.dataset;
  if (d.tact === 'edit' || d.tact === 'level') return d.tact;
  if (d.tpreset) applyTouchPreset(S, d.tpreset as TouchPreset);
  else if (d.tflag === 'leftHanded' || d.tflag === 'tiltInvert' || d.tflag === 'haptics' || d.tflag === 'padHide') S[d.tflag] = d.val === 'true';
  else if (d.tlabels === 'text' || d.tlabels === 'icons') S.labels = d.tlabels;
  else if (d.tact === 'reset') { S.pos = {}; S.sizes = {}; }
  else if (d.tslotSave !== undefined) saveTouchSlot(S, +d.tslotSave);
  else if (d.tslotLoad !== undefined) loadTouchSlot(S, +d.tslotLoad);
  else return null;
  saveTouchSettings();
  changed();
  return 'render';
}
