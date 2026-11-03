// Rebindable keys and gamepad buttons. Defaults live in Input.ts; user overrides (settings.keys / settings.pad)
// are written into those same tables in place, so controllers and gameplay pick them up without changes.
import { BINDINGS, PAD, type Action, type Controller } from './Input';
import { settings, saveSettings, type Layout } from './settings';
import { buttonName, currentPadType, padConnected } from './gamepad';

/** Every action in the order the Controls tab lists them. */
export const ACTIONS: { a: Action; label: string }[] = [
  { a: 'up', label: 'Throttle' }, { a: 'down', label: 'Brake / reverse' }, { a: 'left', label: 'Steer left' }, { a: 'right', label: 'Steer right' },
  { a: 'nitro', label: 'Nitro / ERS' }, { a: 'jump', label: 'Jump (on foot)' }, { a: 'drift', label: 'Handbrake drift' }, { a: 'trick', label: 'Wheelie · trick · DRS' },
  { a: 'fire', label: 'Fire' }, { a: 'weapon', label: 'Next weapon' }, { a: 'ride', label: 'Get on / off' }, { a: 'camera', label: 'Camera view' },
  { a: 'respawn', label: 'Respawn' }, { a: 'upgrade', label: 'Open / close cards' }, { a: 'pick1', label: 'Pick card 1' }, { a: 'pick2', label: 'Pick card 2' },
  { a: 'pick3', label: 'Pick card 3' }, { a: 'reroll', label: 'Reroll cards' },
];
export const LAYOUT_LABEL: Record<Layout, string> = { solo: 'Solo / online', p1: 'Split · P1', p2: 'Split · P2' };

/** Keys the game reserves: pause, mute, help card. */
export const RESERVED_KEYS = ['Escape', 'KeyM', 'KeyH'];
/** Start always pauses. */
export const RESERVED_PAD = [9];
/** Max keys / buttons per action. */
export const SLOTS = 3;

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const DEF_KEYS = clone(BINDINGS);
const DEF_PAD = clone(PAD);

/** Card picks only work while the level-up cards are open, and jump only on foot, so they may share keys with riding actions. */
const CARD: Action[] = ['pick1', 'pick2', 'pick3', 'reroll'];
const canShare = (a: Action, b: Action) =>
  (a === 'nitro' && b === 'jump') || (a === 'jump' && b === 'nitro') || (CARD.includes(a) !== CARD.includes(b) && a !== 'upgrade' && b !== 'upgrade');

/** Write overrides (or defaults) into the live tables. Call after loading or changing settings. */
export function applyBindings() {
  for (const l of Object.keys(BINDINGS) as Layout[]) {
    for (const a of Object.keys(BINDINGS[l]) as Action[]) BINDINGS[l][a] = [...(settings.keys[l]?.[a] ?? DEF_KEYS[l][a])];
  }
  for (const a of Object.keys(PAD) as Action[]) PAD[a] = [...(settings.pad[a] ?? DEF_PAD[a])];
}

function storeKeys(l: Layout) {
  const o: Partial<Record<Action, string[]>> = {};
  for (const a of Object.keys(BINDINGS[l]) as Action[]) if (JSON.stringify(BINDINGS[l][a]) !== JSON.stringify(DEF_KEYS[l][a])) o[a] = [...BINDINGS[l][a]];
  settings.keys[l] = o;
}
function storePad() {
  const o: Partial<Record<Action, number[]>> = {};
  for (const a of Object.keys(PAD) as Action[]) if (JSON.stringify(PAD[a]) !== JSON.stringify(DEF_PAD[a])) o[a] = [...PAD[a]];
  settings.pad = o;
}

/** Generic rebind with conflict swap. Returns a message describing what happened. */
function rebind<T>(table: Record<Action, T[]>, a: Action, slot: number, v: T, label: (v: T) => string): string {
  const list = table[a], old = list[slot];
  if (list.includes(v) && list.indexOf(v) !== slot) return `${label(v)} is already on ${actionLabel(a)}`;
  let msg = `${actionLabel(a)} → ${label(v)}`;
  for (const o of Object.keys(table) as Action[]) {
    if (o === a || canShare(a, o)) continue;
    const i = table[o].indexOf(v);
    if (i < 0) continue;
    // conflict: swap the old key onto the other action, or just take it away
    if (old !== undefined && !table[o].includes(old)) { table[o][i] = old; msg += ` · swapped: ${actionLabel(o)} → ${label(old)}`; }
    else { table[o].splice(i, 1); msg += ` · removed from ${actionLabel(o)}`; }
  }
  if (slot >= list.length) list.push(v);
  else list[slot] = v;
  return msg;
}

export function bindKey(l: Layout, a: Action, slot: number, code: string) {
  if (RESERVED_KEYS.includes(code)) return `${keyLabel(code)} is reserved (pause / mute / help)`;
  const msg = rebind(BINDINGS[l], a, slot, code, keyLabel);
  storeKeys(l);
  saveSettings();
  return msg;
}

export function bindPad(a: Action, slot: number, btn: number) {
  if (RESERVED_PAD.includes(btn)) return `${buttonName(btn)} is reserved (pause)`;
  const msg = rebind(PAD, a, slot, btn, (b) => buttonName(b));
  storePad();
  saveSettings();
  return msg;
}

export function clearSlot(l: Layout | 'pad', a: Action, slot: number) {
  if (l === 'pad') { PAD[a].splice(slot, 1); storePad(); }
  else { BINDINGS[l][a].splice(slot, 1); storeKeys(l); }
  saveSettings();
}

export function resetBindings(l: Layout | 'pad') {
  if (l === 'pad') settings.pad = {};
  else settings.keys[l] = {};
  applyBindings();
  saveSettings();
}

export const actionLabel = (a: Action) => ACTIONS.find((x) => x.a === a)?.label ?? a;

const NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', Space: 'Space',
  ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt', Backslash: '\\', BracketRight: ']', BracketLeft: '[',
  Slash: '/', Period: '.', Comma: ',', Quote: "'", Semicolon: ';', Minus: '-', Equal: '=', Backquote: '`', Enter: 'Enter', NumpadEnter: 'Num Enter',
  Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadDecimal: 'Num .', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
};

/** Friendly label for a key code (ArrowUp → ↑, KeyF → F) or a pad button written as "Pad<n>". */
export function keyLabel(code: string) {
  if (code.startsWith('Pad')) return buttonName(+code.slice(3));
  if (code.startsWith('Stick:')) return code.slice(6);
  return NAMES[code] ?? code.replace('Digit', '').replace('Numpad', 'Num ').replace('Key', '');
}

/** "↑ / W" for a layout's action, "—" when unbound. */
export const keysText = (l: Layout, a: Action, max = 3) => BINDINGS[l][a].slice(0, max).map(keyLabel).join(' / ') || '—';
/** Pad buttons for an action in the connected pad's names ("A / RT"). */
export const padText = (a: Action) => PAD[a].map((b) => buttonName(b, currentPadType())).join(' / ') || '—';

/** What to show on HUD prompts for this controller: its gamepad buttons when one is connected, else its keys. */
export function displayBindings(c: Controller): Record<Action, string[]> {
  if (!padConnected(c.gamepad)) return c.bindings;
  const o = {} as Record<Action, string[]>;
  for (const a of Object.keys(PAD) as Action[]) o[a] = PAD[a].length ? PAD[a].map((b) => 'Pad' + b) : a === 'camera' ? ['Stick:R-stick ↑'] : c.bindings[a];
  return o;
}

applyBindings();
