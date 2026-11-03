// Touch control settings (saved per device) and the button table: which buttons a mode/vehicle needs and where they sit.
import type { Action } from '../core/Input';

export type TouchScheme = 'buttons' | 'stick' | 'tilt';

export interface TouchSettings {
  scheme: TouchScheme;
  /** Button size multiplier. */
  size: number;
  /** 0.2..1 */
  opacity: number;
  /** Steering on the right thumb, throttle cluster on the left. */
  leftHanded: boolean;
  /** Tilt angle (degrees) for full steering lock. */
  tiltRange: number;
  tiltInvert: boolean;
  /** Dragged button centres as fractions of the screen, per orientation: "land:gas" -> [x, y]. */
  pos: Record<string, [number, number]>;
}

export const TOUCH = {
  unit: 62, // button diameter at size 1 (px)
  gap: 10,
  margin: 14,
  stick: 128, // joystick base diameter at size 1
  dead: 0.12, // joystick / tilt dead zone
  sizes: [0.8, 1.3] as const,
};

const KEY = 'moto:touch';

export const touchSettings: TouchSettings = (() => {
  const base: TouchSettings = { scheme: 'buttons', size: 1, opacity: 0.75, leftHanded: false, tiltRange: 22, tiltInvert: false, pos: {} };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TouchSettings>) };
  } catch {
    return base;
  }
})();

export function saveTouchSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(touchSettings));
  } catch {
    /* not persisted */
  }
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
  { id: 'gas', actions: ['up'], label: (c) => (c.riding ? 'GAS' : '▲'), show: () => true, slot: () => R(0, 0), big: true },
  { id: 'brake', actions: ['down'], label: (c) => (c.riding ? 'BRK' : '▼'), show: () => true, slot: (c) => (c.scheme === 'tilt' ? L(0, 0) : R(1, 0)), big: true },
  { id: 'nitro', actions: ['nitro'], label: (c) => (!c.riding ? 'RUN' : c.f1 ? 'ERS' : c.thrusters ? 'THR' : 'NOS'), show: () => true, slot: (c) => (c.scheme === 'tilt' ? R(1, 0) : R(0, 1)) },
  { id: 'trick', actions: ['trick'], label: (c) => (c.f1 ? 'DRS' : 'WHEELIE'), show: (c) => c.riding && (c.f1 || !c.car), slot: (c) => (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) },
  { id: 'drift', actions: ['drift'], label: () => 'DRIFT', show: (c) => c.riding && !c.f1 && (c.car || c.mode === 'drift'), slot: (c) => (c.car ? (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) : R(2, 0)) },
  { id: 'jump', actions: ['jump'], label: () => 'JUMP', show: (c) => !c.riding, slot: (c) => (c.scheme === 'tilt' ? R(0, 1) : R(1, 1)) },
  { id: 'fire', actions: ['fire'], label: () => 'FIRE', show: (c) => c.weapons, slot: (c) => (c.mode === 'drift' && !c.car ? R(2, 1) : R(2, 0)) },
  { id: 'weapon', actions: ['weapon'], label: () => 'GUN', show: (c) => c.weapons, slot: () => R(2, 1) },
  { id: 'ride', actions: ['ride'], label: (c) => (c.riding ? 'OFF' : 'RIDE'), show: (c) => c.canWalk, slot: (c) => (c.scheme === 'tilt' ? L(0, 1) : R(0, 2)) },
  { id: 'hover', actions: ['hover'], label: () => 'LIFT', show: (c) => c.riding && c.thrusters, slot: () => R(3, 0), big: true },
  { id: 'kickflip', actions: ['trick'], label: () => 'FLIP', show: (c) => c.riding && c.thrusters, slot: () => R(3, 1) },
  { id: 'upgrade', actions: ['upgrade'], label: () => '⬆', show: (c) => c.cards, slot: (c) => (c.scheme === 'tilt' ? L(1, 0) : R(1, 2)) },
];

/** Default centre of a button in px inside a box of w x h (safe area already removed), honouring left-handed mirroring. */
export function defaultCentre(b: TouchButton, c: TouchCtx, w: number, h: number, s: TouchSettings) {
  const u = TOUCH.unit * s.size, g = TOUCH.gap * s.size, m = TOUCH.margin;
  let { side, col } = b.slot(c);
  const { row } = b.slot(c);
  if (s.leftHanded) {
    side = side === 'l' ? 'r' : 'l';
    if (b.id === 'left' || b.id === 'right') col = 1 - col; // ◀ stays left of ▶
  }
  const dx = m + u / 2 + col * (u + g), dy = m + u / 2 + row * (u + g);
  return { x: side === 'l' ? dx : w - dx, y: h - dy };
}

/** Where the joystick base sits by default. */
export function stickCentre(w: number, h: number, s: TouchSettings) {
  const r = (TOUCH.stick * s.size) / 2 + TOUCH.margin;
  return { x: s.leftHanded ? w - r : r, y: h - r };
}

export const orientKey = (w: number, h: number) => (w >= h ? 'land' : 'port');
