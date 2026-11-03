// Gamepad feel: dead zone, steering curve, analog triggers, invert options, controller type (button glyphs) and hot-plug toasts.
import type { Action, Controller } from './Input';
import { settings } from './settings';
import { toast } from '../ui/toast';

export type PadType = 'xbox' | 'ps' | 'generic';

/** Standard-mapping button names per controller family (index = button). */
const NAMES: Record<PadType, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Xbox'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS'],
  generic: ['B1', 'B2', 'B3', 'B4', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'Home'],
};
const FAMILY: Record<PadType, string> = { xbox: 'Xbox', ps: 'PlayStation', generic: 'Generic' };

export function padType(id: string): PadType {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense|wireless controller|ps[345]/.test(s)) return 'ps';
  if (/045e|xbox|xinput|x-box/.test(s)) return 'xbox';
  return 'generic';
}

const pads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);

/** Type of the given (or first connected) pad; Xbox names when none is connected. */
export function currentPadType(index?: number): PadType {
  const list = pads(), p = index !== undefined ? list[index] : list.find((g) => g?.connected);
  return p && p.connected ? padType(p.id) : 'xbox';
}

export const padConnected = (index: number) => !!pads()[index]?.connected;
export const anyPadConnected = () => pads().some((p) => p?.connected);
export const padFamily = (t: PadType) => FAMILY[t];

/** Button name for the pad family, e.g. 0 → "A" (Xbox) / "✕" (PlayStation). */
export const buttonName = (b: number, type: PadType = currentPadType()) => NAMES[type][b] ?? `B${b}`;

/** Dead zone + response curve + sensitivity: raw stick value (−1..1) → steering (−1..1). */
export function shapeAxis(v: number) {
  const dz = settings.deadzone, a = Math.abs(v);
  if (a <= dz) return 0;
  const n = Math.min(1, (a - dz) / (1 - dz));
  return Math.sign(v) * Math.min(1, Math.pow(n, settings.curve) * settings.sensitivity);
}

/** Merge one gamepad into a controller: buttons via the (rebindable) map, sticks and triggers as analog amounts. */
export function readPad(c: Controller, pad: Gamepad, map: Record<Action, number[]>) {
  const B = pad.buttons;
  const kbSteer = c.held.has('left') || c.held.has('right'), kbUp = c.held.has('up'), kbDown = c.held.has('down');
  let throttle = 0, brake = 0;
  for (const a of Object.keys(map) as Action[]) {
    let v = 0;
    for (const b of map[a]) v = Math.max(v, B[b]?.value ?? 0, B[b]?.pressed ? 1 : 0);
    if (v > 0.08) c.held.add(a);
    if (a === 'up') throttle = v;
    if (a === 'down') brake = v;
  }
  const dpadSteer = (map.left.some((b) => B[b]?.pressed)) || (map.right.some((b) => B[b]?.pressed));
  const ax = pad.axes[0] ?? 0, ay = (pad.axes[1] ?? 0) * (settings.invertY ? -1 : 1);
  const steer = shapeAxis(ax);
  if (steer < -0.02) c.held.add('left');
  if (steer > 0.02) c.held.add('right');
  if (ay < -0.5) { c.held.add('up'); throttle = Math.max(throttle, 1); }
  if (ay > 0.5) { c.held.add('down'); brake = Math.max(brake, 1); }
  if (!kbSteer && !dpadSteer && steer) c.steerMag = Math.abs(steer);
  const curve = (v: number) => (settings.analogTriggers ? Math.min(1, Math.max(0.15, (v - 0.05) / 0.9)) : 1);
  if (!kbUp && throttle > 0.08) c.throttle = curve(throttle);
  if (!kbDown && brake > 0.08) c.brake = curve(brake);
  const rx = shapeAxis(pad.axes[2] ?? 0) * (settings.invertLook ? -1 : 1);
  if (rx) c.lookDelta -= rx * 0.05;
  if ((pad.axes[3] ?? 0) < -0.7) c.held.add('camera');
}

/** Hot-plug toasts: "🎮 PlayStation controller connected · P1". */
export function watchPads() {
  addEventListener('gamepadconnected', (e) => {
    const p = (e as GamepadEvent).gamepad;
    toast(`🎮 ${FAMILY[padType(p.id)]} controller connected · P${p.index + 1}`);
  });
  addEventListener('gamepaddisconnected', (e) => {
    const p = (e as GamepadEvent).gamepad;
    toast(`🎮 Controller P${p.index + 1} disconnected`, true);
  });
}
