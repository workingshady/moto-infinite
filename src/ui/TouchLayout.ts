// Touch control settings (saved per device) and the button table: which buttons a mode/vehicle needs and where they sit.
// Pure layout maths (default grid with per-button sizes, presets, keep-on-screen / keep-out, snapping) so it is testable.
import type { Action } from '../core/Input';
import { mergeSaved, parseJson } from '../utils/store';
import { markChanged } from '../core/syncBus';

export type TouchScheme = 'buttons' | 'stick' | 'tilt';
/** Button arrangement: classic grid, racing (tall pedals, wide steer arrows), one-thumb (joystick drives, extras on the other side). */
export type TouchStyle = 'classic' | 'racing' | 'onethumb';
export type TouchPreset = 'classic' | 'stick' | 'tilt' | 'racing' | 'onethumb';

/** A saved custom layout (Settings → Controls → Touch → slots 1-3). */
export interface TouchSlot {
  name: string;
  scheme: TouchScheme;
  style: TouchStyle;
  size: number;
  sizes: Record<string, number>;
  pos: Record<string, [number, number]>;
}

export interface TouchSettings {
  scheme: TouchScheme;
  style: TouchStyle;
  /** Button size multiplier (all buttons). */
  size: number;
  /** Per-button size multipliers on top of `size` ("gas" -> 1.2; "stick" for the joystick). */
  sizes: Record<string, number>;
  /** 0.2..1 */
  opacity: number;
  /** Steering on the right thumb, throttle cluster on the left. */
  leftHanded: boolean;
  /** Tilt angle (degrees) for full steering lock. */
  tiltRange: number;
  tiltInvert: boolean;
  /** Joystick / tilt steering: sensitivity multiplier, dead zone 0..0.4, smoothing 0 (instant) .. 0.85. */
  sens: number;
  dead: number;
  smooth: number;
  /** Short vibration on every button press. */
  haptics: boolean;
  /** Button faces: words (GAS, NOS) or symbols. */
  labels: 'text' | 'icons';
  /** Hide the on-screen buttons while a gamepad is connected. */
  padHide: boolean;
  /** Edit mode: snap to a grid and to other buttons. */
  snap: boolean;
  /** Dragged button centres as fractions of the screen, per orientation: "land:gas" -> [x, y]. */
  pos: Record<string, [number, number]>;
  /** Up to 3 saved layouts (null = empty slot). */
  slots: (TouchSlot | null)[];
}

export const TOUCH = {
  unit: 62, // button diameter at size 1 (px)
  gap: 10,
  margin: 14,
  stick: 128, // joystick base diameter at size 1
  topBand: 140, // px at the top kept for the minimap / stats panel (default slots only; the minimap ends ~132 px down on a 412 px phone)
  sysBar: 56, // px at the top for the system buttons (pause, camera, ...): buttons are never dropped there
  dead: 0.12, // default joystick / tilt dead zone
  sizes: [0.8, 1.3] as const, // global size slider
  btnSizes: [0.6, 1.6] as const, // per-button size
  sens: [0.5, 2] as const,
  deadRange: [0, 0.4] as const,
  smooth: [0, 0.85] as const,
  tiltRange: [10, 40] as const,
  opacity: [0.2, 1] as const,
  big: 1.12, // GAS / BRK / ◀ ▶ are a little bigger
  pedal: 1.5, // racing pedals: height / width
  wide: 1.3, // racing steer arrows: width / height
  snapGrid: 8, // px
  guide: 10, // px: align with another button's centre line within this distance
  slots: 3,
};

export const TOUCH_PRESETS: { id: TouchPreset; label: string; scheme: TouchScheme; style: TouchStyle }[] = [
  { id: 'classic', label: '◀ ▶ Classic', scheme: 'buttons', style: 'classic' },
  { id: 'stick', label: '🕹 Joystick', scheme: 'stick', style: 'classic' },
  { id: 'tilt', label: '📱 Tilt', scheme: 'tilt', style: 'classic' },
  { id: 'racing', label: '🏁 Racing', scheme: 'buttons', style: 'racing' },
  { id: 'onethumb', label: '👍 One-thumb', scheme: 'stick', style: 'onethumb' },
];
/** The preset a scheme + style pair matches (custom combinations show the closest). */
export const touchPreset = (s: Pick<TouchSettings, 'scheme' | 'style'>): TouchPreset =>
  TOUCH_PRESETS.find((p) => p.scheme === s.scheme && p.style === s.style)?.id ?? (s.style === 'classic' ? (s.scheme === 'buttons' ? 'classic' : s.scheme) : s.style);

const KEY = 'moto:touch';

export const touchDefaults = (): TouchSettings => ({
  scheme: 'buttons', style: 'classic', size: 1, sizes: {}, opacity: 0.75, leftHanded: false, tiltRange: 22, tiltInvert: false,
  sens: 1, dead: TOUCH.dead, smooth: 0, haptics: true, labels: 'text', padHide: true, snap: true, pos: {}, slots: [null, null, null],
});

const clampN = (v: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const ID_RE = /^[a-z0-9]{1,16}$/i, POS_RE = /^(land|port):[a-z0-9]{1,16}$/i;
const cleanSizes = (v: unknown) => {
  const o: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, n] of Object.entries(v).slice(0, 40)) if (ID_RE.test(k) && typeof n === 'number' && Number.isFinite(n)) o[k] = clampN(n, TOUCH.btnSizes, 1);
  return o;
};
const cleanPos = (v: unknown) => {
  const o: Record<string, [number, number]> = {};
  if (v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, p] of Object.entries(v).slice(0, 80))
      if (POS_RE.test(k) && Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
        o[k] = [Math.round(clampN(p[0], [0, 1], 0.5) * 1e4) / 1e4, Math.round(clampN(p[1], [0, 1], 0.5) * 1e4) / 1e4];
  return o;
};
const SCHEMES: TouchScheme[] = ['buttons', 'stick', 'tilt'], STYLES: TouchStyle[] = ['classic', 'racing', 'onethumb'];

/** Saved touch settings over the defaults: every number clamped, positions / sizes / slots validated (old or damaged saves load safely). */
export function cleanTouch(raw: unknown, base: TouchSettings = touchDefaults()): TouchSettings {
  const s = mergeSaved(structuredClone(base), raw);
  if (!SCHEMES.includes(s.scheme)) s.scheme = base.scheme;
  if (!STYLES.includes(s.style)) s.style = base.style;
  if (s.labels !== 'text' && s.labels !== 'icons') s.labels = base.labels;
  s.size = clampN(s.size, TOUCH.sizes, 1);
  s.opacity = clampN(s.opacity, TOUCH.opacity, 0.75);
  s.tiltRange = clampN(s.tiltRange, TOUCH.tiltRange, 22);
  s.sens = clampN(s.sens, TOUCH.sens, 1);
  s.dead = clampN(s.dead, TOUCH.deadRange, TOUCH.dead);
  s.smooth = clampN(s.smooth, TOUCH.smooth, 0);
  s.sizes = cleanSizes(s.sizes);
  s.pos = cleanPos(s.pos);
  const slots = Array.isArray(s.slots) ? s.slots : [];
  s.slots = Array.from({ length: TOUCH.slots }, (_, i) => {
    const v = slots[i] as Partial<TouchSlot> | null | undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return {
      name: typeof v.name === 'string' ? v.name.slice(0, 24) : `Layout ${i + 1}`,
      scheme: SCHEMES.includes(v.scheme as TouchScheme) ? (v.scheme as TouchScheme) : 'buttons',
      style: STYLES.includes(v.style as TouchStyle) ? (v.style as TouchStyle) : 'classic',
      size: clampN(v.size, TOUCH.sizes, 1), sizes: cleanSizes(v.sizes), pos: cleanPos(v.pos),
    };
  });
  return s;
}

export const touchSettings: TouchSettings = (() => {
  try {
    return cleanTouch(parseJson(localStorage.getItem(KEY)));
  } catch {
    return touchDefaults();
  }
})();

export function saveTouchSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(touchSettings));
  } catch {
    /* not persisted */
  }
  markChanged('touch');
}

/** Pick a preset: steering scheme + arrangement. Dragged positions are kept (they are per button). */
export function applyTouchPreset(s: TouchSettings, id: TouchPreset) {
  const p = TOUCH_PRESETS.find((x) => x.id === id);
  if (!p) return;
  s.scheme = p.scheme;
  s.style = p.style;
}

/** Store the current layout in slot i / load slot i into the live settings. */
export function saveTouchSlot(s: TouchSettings, i: number) {
  if (i < 0 || i >= TOUCH.slots) return;
  s.slots[i] = { name: `Layout ${i + 1}`, scheme: s.scheme, style: s.style, size: s.size, sizes: { ...s.sizes }, pos: structuredClone(s.pos) };
}
export function loadTouchSlot(s: TouchSettings, i: number) {
  const v = s.slots[i];
  if (!v) return false;
  Object.assign(s, { scheme: v.scheme, style: v.style, size: v.size, sizes: { ...v.sizes }, pos: structuredClone(v.pos) });
  return true;
}

/** What the current player is doing: decides which buttons are worth showing. */
export interface TouchCtx {
  mode: string;
  scheme: TouchScheme;
  f1: boolean;
  car: boolean;
  riding: boolean;
  weapons: boolean;
  /** Open world: get on/off the bike. */
  canWalk: boolean;
  cards: boolean;
  /** Tesla Roadster with thrusters: lift + kickflip buttons. */
  thrusters: boolean;
}

export interface TouchButton {
  id: string;
  actions: Action[];
  label: (c: TouchCtx) => string;
  /** Symbol face (Settings → Touch → Labels: icons); falls back to the label. */
  icon?: (c: TouchCtx) => string;
  show: (c: TouchCtx) => boolean;
  /** Default slot: side, column from that edge, row from the bottom. */
  slot: (c: TouchCtx) => { side: 'l' | 'r'; col: number; row: number };
  big?: boolean;
}

const R = (col: number, row: number) => ({ side: 'r' as const, col, row });
const L = (col: number, row: number) => ({ side: 'l' as const, col, row });

export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'left', actions: ['left'], label: () => '◀', show: (c) => c.scheme === 'buttons', slot: () => L(0, 0), big: true },
  { id: 'right', actions: ['right'], label: () => '▶', show: (c) => c.scheme === 'buttons', slot: () => L(1, 0), big: true },
  { id: 'gas', actions: ['up'], label: (c) => (c.riding ? 'GAS' : '▲'), icon: () => '▲', show: () => true, slot: () => R(0, 0), big: true },
  { id: 'brake', actions: ['down'], label: (c) => (c.riding ? 'BRK' : '▼'), icon: () => '▼', show: () => true, slot: (c) => (c.scheme === 'tilt' ? L(0, 0) : R(1, 0)), big: true },
  { id: 'nitro', actions: ['nitro'], label: (c) => (!c.riding ? 'RUN' : c.f1 ? 'ERS' : c.thrusters ? 'THR' : 'NOS'), icon: (c) => (c.riding ? '⚡' : '»'), show: () => true, slot: (c) => (c.scheme === 'tilt' ? R(1, 0) : R(0, 1)) },
  { id: 'trick', actions: ['trick'], label: (c) => (c.f1 ? 'DRS' : 'WHEELIE'), icon: (c) => (c.f1 ? 'DRS' : '⤴'), show: (c) => c.riding && (c.f1 || !c.car), slot: (c) => (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) },
  { id: 'drift', actions: ['drift'], label: () => 'DRIFT', icon: () => '↯', show: (c) => c.riding && !c.f1 && (c.car || c.mode === 'drift'), slot: (c) => (c.car ? (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) : R(2, 0)) },
  { id: 'jump', actions: ['jump'], label: () => 'JUMP', icon: () => '⤒', show: (c) => !c.riding, slot: (c) => (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) },
  { id: 'fire', actions: ['fire'], label: () => 'FIRE', icon: () => '✹', show: (c) => c.weapons, slot: (c) => (c.mode === 'drift' && !c.car ? R(2, 1) : R(2, 0)) },
  // drift venues put a bike's FIRE one row up (DRIFT takes its slot), so GUN moves up one more
  { id: 'weapon', actions: ['weapon'], label: () => 'GUN', icon: () => '⟳', show: (c) => c.weapons, slot: (c) => (c.mode === 'drift' && !c.car ? R(2, 2) : R(2, 1)) },
  { id: 'ride', actions: ['ride'], label: (c) => (c.riding ? 'OFF' : 'RIDE'), icon: () => '⇄', show: (c) => c.canWalk, slot: (c) => (c.scheme === 'tilt' ? L(0, 1) : R(0, 2)) },
  { id: 'hover', actions: ['hover'], label: () => 'LIFT', icon: () => '⇧', show: (c) => c.riding && c.thrusters, slot: () => R(2, 2) }, // free slot above FIRE/GUN (col 3 hits ◀ ▶ on phones)
  { id: 'kickflip', actions: ['trick'], label: () => 'FLIP', icon: () => '↻', show: (c) => c.riding && c.thrusters, slot: () => R(1, 3) },
  { id: 'upgrade', actions: ['upgrade'], label: () => '⬆', show: (c) => c.cards, slot: (c) => (c.scheme === 'tilt' ? L(1, 0) : R(1, 2)) },
];

/** One-thumb with the joystick: the stick does throttle / brake too, so GAS / BRK go. */
export const hiddenByStyle = (b: TouchButton, s: Pick<TouchSettings, 'style' | 'scheme'>) => s.style === 'onethumb' && s.scheme === 'stick' && (b.id === 'gas' || b.id === 'brake');

/** Button size in px: width and height (racing pedals are tall, racing arrows wide). */
export function buttonDims(b: TouchButton, s: Pick<TouchSettings, 'size' | 'sizes' | 'style'>) {
  const d = TOUCH.unit * s.size * (b.big ? TOUCH.big : 1) * (s.sizes[b.id] ?? 1);
  if (s.style === 'racing' && (b.id === 'gas' || b.id === 'brake')) return { w: d, h: d * TOUCH.pedal };
  if (s.style === 'racing' && (b.id === 'left' || b.id === 'right')) return { w: d * TOUCH.wide, h: d };
  return { w: d, h: d };
}

export interface Placed { x: number; y: number; w: number; h: number }

/** Default slot after the style and handedness swaps (before the short-screen 4th-row fold). */
function slotOf(b: TouchButton, c: TouchCtx, s: TouchSettings) {
  const { row } = b.slot(c);
  let { side, col } = b.slot(c);
  // one-thumb: the joystick sits on the right, so the extra buttons move to the left thumb
  if (s.style === 'onethumb' && s.scheme === 'stick') side = side === 'l' ? 'r' : 'l';
  if (s.leftHanded) {
    side = side === 'l' ? 'r' : 'l';
    if (b.id === 'left' || b.id === 'right') col = 1 - col; // ◀ stays left of ▶
  }
  return { side, col, row };
}

/** Default positions (centres, px, inside a box of w x h with the safe area already removed) of the given buttons.
 *  Each side is a grid from its bottom corner; a column is as wide as its widest button and a row as tall as its tallest,
 *  so enlarging one button pushes its neighbours out instead of overlapping them. */
export function layoutButtons(list: TouchButton[], c: TouchCtx, w: number, h: number, s: TouchSettings): Record<string, Placed> {
  const g = TOUCH.gap * s.size, m = TOUCH.margin, u = TOUCH.unit * s.size;
  // the 4th row (Roadster FLIP) moves out to a 4th column when it would reach into the top band (minimap / stats
  // panel) of a short landscape screen, at the height of its old column; landscape has the width for it
  const fit = Math.max(1, Math.floor((h - m - TOUCH.topBand) / (u + g)));
  const cells = list.map((b) => {
    const sl = slotOf(b, c, s);
    // (never down to row 0 in column 3: on a narrow phone that reaches the ◀ ▶ cluster)
    if (sl.row >= 3 && sl.row >= fit) { sl.row = Math.min(sl.col, Math.max(1, fit - 1)); sl.col = 3; }
    const d = buttonDims(b, s);
    if (h > w) d.w = Math.min(d.w, d.h); // portrait is narrow: racing arrows stay round
    const shrink = b.big ? g * 0.7 : 0; // big buttons share part of the gap (as they always did)
    return { b, ...sl, ...d, cw: d.w - shrink, ch: d.h - shrink };
  });
  const cols = { l: [] as number[], r: [] as number[] }, rows = { l: [] as number[], r: [] as number[] };
  const measure = () => {
    cols.l = []; cols.r = []; rows.l = []; rows.r = [];
    for (const k of cells) {
      cols[k.side][k.col] = Math.max(cols[k.side][k.col] ?? 0, k.cw);
      rows[k.side][k.row] = Math.max(rows[k.side][k.row] ?? 0, k.ch);
    }
  };
  measure();
  // short screens: tall racing pedals give up height before the stack reaches the system buttons
  for (const side of ['l', 'r'] as const) {
    const stack = m + rows[side].reduce((a, v) => a + (v ?? u) + g, 0) - g, over = stack - (h - TOUCH.sysBar);
    if (over > 0) for (const k of cells) if (k.side === side && k.h > k.w) { const cut = Math.min(over, k.h - k.w); k.h -= cut; k.ch -= cut; }
  }
  measure();
  // empty columns / rows keep a standard cell, so buttons do not jump when an unrelated one appears
  const offset = (sizes: number[], i: number) => {
    let o = m;
    for (let j = 0; j < i; j++) o += (sizes[j] ?? u) + g;
    return o + (sizes[i] ?? u) / 2;
  };
  const out: Record<string, Placed> = {};
  for (const k of cells) {
    const dx = offset(cols[k.side], k.col), dy = offset(rows[k.side], k.row);
    out[k.b.id] = { x: k.side === 'l' ? dx : w - dx, y: h - dy, w: k.w, h: k.h };
  }
  return out;
}

/** Visible buttons for a context (mode table + style). */
export const visibleButtons = (c: TouchCtx, s: TouchSettings) => TOUCH_BUTTONS.filter((b) => b.show(c) && !hiddenByStyle(b, s));

/** Default centre of one button among the ones the context shows (kept for callers that place a single button). */
export function defaultCentre(b: TouchButton, c: TouchCtx, w: number, h: number, s: TouchSettings) {
  const list = visibleButtons(c, s);
  const p = layoutButtons(list.includes(b) ? list : [...list, b], c, w, h, s)[b.id];
  return { x: p.x, y: p.y };
}

/** Joystick base diameter (px). */
export const stickSize = (s: Pick<TouchSettings, 'size' | 'sizes'>) => TOUCH.stick * s.size * (s.sizes.stick ?? 1);

/** Where the joystick base sits by default: bottom-left (bottom-right for one-thumb), mirrored for left-handed. */
export function stickCentre(w: number, h: number, s: TouchSettings) {
  const r = stickSize(s) / 2 + TOUCH.margin, right = (s.style === 'onethumb') !== s.leftHanded;
  return { x: right ? w - r : r, y: h - r };
}

export const orientKey = (w: number, h: number) => (w >= h ? 'land' : 'port');

// ---------------------------------------------------------------- edit-mode helpers
export interface Rect { l: number; t: number; r: number; b: number }

/** Keep a w x h element centred at (x, y) fully inside the box. */
export function keepOnScreen(x: number, y: number, bw: number, bh: number, w: number, h: number) {
  return { x: Math.min(w - bw / 2, Math.max(bw / 2, x)), y: Math.min(h - bh / 2, Math.max(bh / 2, y)) };
}

/** Push an element out of any keep-out rect (system bar, minimap, gauges) along the shortest way, staying on screen. */
export function keepOut(x: number, y: number, bw: number, bh: number, w: number, h: number, zones: Rect[]) {
  let p = keepOnScreen(x, y, bw, bh, w, h);
  for (let pass = 0; pass < 2; pass++) {
    for (const z of zones) {
      const l = p.x - bw / 2, r = p.x + bw / 2, t = p.y - bh / 2, b = p.y + bh / 2;
      if (r <= z.l || l >= z.r || b <= z.t || t >= z.b) continue;
      const moves = [
        { x: z.l - bw / 2, y: p.y, d: r - z.l }, { x: z.r + bw / 2, y: p.y, d: z.r - l },
        { x: p.x, y: z.t - bh / 2, d: b - z.t }, { x: p.x, y: z.b + bh / 2, d: z.b - t },
      ].filter((m) => m.x - bw / 2 >= 0 && m.x + bw / 2 <= w && m.y - bh / 2 >= 0 && m.y + bh / 2 <= h).sort((a, c) => a.d - c.d);
      if (moves[0]) p = { x: moves[0].x, y: moves[0].y };
    }
  }
  return p;
}

/** Snap a dragged centre to the grid, or to another button's centre line (returns the guide lines that matched). */
export function snapPoint(x: number, y: number, others: { x: number; y: number }[], grid = TOUCH.snapGrid, near = TOUCH.guide) {
  let gx: number | null = null, gy: number | null = null, bx = near, by = near;
  for (const o of others) {
    if (Math.abs(o.x - x) < bx) { bx = Math.abs(o.x - x); gx = o.x; }
    if (Math.abs(o.y - y) < by) { by = Math.abs(o.y - y); gy = o.y; }
  }
  return { x: gx ?? Math.round(x / grid) * grid, y: gy ?? Math.round(y / grid) * grid, gx, gy };
}
