// Keyboard, mouse, touch and gamepads are merged into per-player "controllers" holding abstract actions.
// Gameplay code only asks controller.is('fire'), never about keys, so rebinding happens here only.

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'nitro' | 'jump' | 'fire'
  | 'ride' | 'weapon' | 'respawn' | 'trick' | 'drift' | 'upgrade' | 'reroll' | 'pick1' | 'pick2' | 'pick3' | 'camera';

type Bindings = Record<Action, string[]>;

export const BINDINGS: Record<'solo' | 'p1' | 'p2', Bindings> = {
  solo: {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    nitro: ['ShiftLeft', 'ShiftRight', 'Space', 'KeyN', 'KeyB'], jump: ['Space'], fire: ['KeyF'], ride: ['KeyE'], weapon: ['KeyQ'],
    respawn: ['KeyR'], trick: ['KeyC'], drift: ['KeyX'], upgrade: ['Tab'], reroll: ['KeyT'], pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], camera: ['KeyV'],
  },
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    nitro: ['ShiftLeft', 'Space'], jump: ['Space'], fire: ['KeyF'], ride: ['KeyE'], weapon: ['KeyQ'],
    respawn: ['KeyR'], trick: ['KeyC'], drift: ['KeyX'], upgrade: ['Tab'], reroll: ['KeyT'], pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], camera: ['KeyV'],
  },
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    nitro: ['ShiftRight', 'Numpad0'], jump: ['ShiftRight', 'Numpad0'], fire: ['Slash', 'Numpad1'], ride: ['Enter', 'NumpadEnter'],
    weapon: ['Period', 'Numpad2'], respawn: ['Backspace', 'Numpad3'], trick: ['Quote', 'Numpad4'], drift: ['Semicolon', 'Numpad5'], upgrade: ['Backslash', 'NumpadAdd'], reroll: ['BracketRight', 'NumpadSubtract'], pick1: ['Digit8', 'Numpad7'], pick2: ['Digit9', 'Numpad8'], pick3: ['Digit0', 'Numpad9'], camera: ['KeyL', 'NumpadDecimal'],
  },
};

// Standard gamepad layout: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start 12-15=D-pad
// Every button is taken, so the camera cycles with the right stick pushed up (see poll).
const PAD: Record<Action, number[]> = {
  up: [0, 7, 12], down: [6, 13], left: [14], right: [15], nitro: [1, 5], jump: [1], fire: [2],
  ride: [3], weapon: [8], respawn: [], trick: [10], drift: [4], upgrade: [11], reroll: [], pick1: [14], pick2: [12], pick3: [15], camera: [],
};

export class Controller {
  readonly held = new Set<Action>();
  readonly pressed = new Set<Action>();
  readonly prev = new Set<Action>();
  bindings: Bindings;
  gamepad: number;
  lookDelta = 0;
  zoom = 1;
  /** Analog steering -1 (right) .. 1 (left) from a touch joystick or tilt; 0 = digital only. */
  steerAxis = 0;

  constructor(bindings: Bindings, gamepad: number) {
    this.bindings = bindings;
    this.gamepad = gamepad;
  }
  is(a: Action) {
    return this.held.has(a);
  }
  hit(a: Action) {
    return this.pressed.has(a);
  }
  /** Steering amount for the held left/right: the analog value when one drives it, else full lock. */
  steer(left: boolean, right: boolean) {
    const d = (left ? 1 : 0) - (right ? 1 : 0);
    return d && Math.sign(this.steerAxis) === d ? this.steerAxis : d;
  }
}

export class Input {
  readonly controllers = [new Controller(BINDINGS.solo, 0), new Controller(BINDINGS.p2, 1)];
  readonly touch = new Set<Action>();
  /** Analog steer from the touch joystick / tilt (player 1), -1..1, positive = left. */
  touchSteer = 0;
  enabled = false;
  onPause: (() => void) | null = null;
  onToggleHelp: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onUserGesture: (() => void) | null = null;

  private keys = new Set<string>();
  private tapped = new Set<string>();
  private mouseFire = false;
  private drag: number | null = null;
  private padStart = false;

  constructor() {
    addEventListener('keydown', (e) => {
      this.onUserGesture?.();
      if (isTyping(e.target)) return;
      if (e.code === 'Escape') {
        this.onPause?.();
        return;
      }
      if (!this.enabled) return;
      if (e.code === 'KeyH') this.onToggleHelp?.();
      if (e.code === 'KeyM') this.onMute?.();
      if (this.isBound(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.tapped.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = false;
    });
    addEventListener('pointerdown', () => this.onUserGesture?.());
    addEventListener('pointerup', () => {
      this.drag = null;
      this.mouseFire = false;
    });
    addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.controllers[0].lookDelta -= (e.clientX - this.drag) * 0.008;
      this.drag = e.clientX;
    });
    addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      const c = this.controllers[0];
      c.zoom = Math.max(0.5, Math.min(2.5, c.zoom * (1 + e.deltaY * 0.001)));
    }, { passive: true });
  }

  /** Mouse on the canvas: left = fire, right-drag / touch-drag = look around (player 1). */
  attachCanvas(el: HTMLElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch' || e.button !== 0) this.drag = e.clientX;
      else this.mouseFire = true;
    });
  }

  setLayout(split: boolean) {
    this.controllers[0].bindings = split ? BINDINGS.p1 : BINDINGS.solo;
    this.controllers[1].bindings = BINDINGS.p2;
  }

  private isBound(code: string) {
    return this.controllers.some((c) => Object.values(c.bindings).some((list) => list.includes(code)));
  }

  /** Call once per frame before gameplay reads controllers. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let start = false;
    this.controllers.forEach((c, i) => {
      c.prev.clear();
      c.held.forEach((a) => c.prev.add(a));
      c.held.clear();
      for (const a of Object.keys(c.bindings) as Action[]) {
        if (c.bindings[a].some((k) => this.keys.has(k) || this.tapped.has(k))) c.held.add(a);
      }
      const pad = pads[c.gamepad];
      if (pad && pad.connected) {
        for (const a of Object.keys(PAD) as Action[]) if (PAD[a].some((b) => pad.buttons[b]?.pressed)) c.held.add(a);
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
        if (ax < -0.45) c.held.add('left');
        if (ax > 0.45) c.held.add('right');
        if (ay < -0.5) c.held.add('up');
        if (ay > 0.5) c.held.add('down');
        const rx = pad.axes[2] ?? 0;
        if (Math.abs(rx) > 0.2) c.lookDelta -= rx * 0.05;
        if ((pad.axes[3] ?? 0) < -0.7) c.held.add('camera');
        if (pad.buttons[9]?.pressed) start = true;
      }
      if (i === 0) {
        if (this.mouseFire) c.held.add('fire');
        this.touch.forEach((a) => c.held.add(a));
        c.steerAxis = this.touchSteer;
        if (this.touchSteer > 0.1) c.held.add('left');
        if (this.touchSteer < -0.1) c.held.add('right');
      }
      c.pressed.clear();
      c.held.forEach((a) => {
        if (!c.prev.has(a)) c.pressed.add(a);
      });
    });
    this.tapped.clear();
    if (start && !this.padStart) this.onPause?.();
    this.padStart = start;
  }

  reset() {
    this.keys.clear();
    this.tapped.clear();
    this.touch.clear();
    this.touchSteer = 0;
    this.mouseFire = false;
    this.controllers.forEach((c) => {
      c.held.clear();
      c.pressed.clear();
      c.lookDelta = 0;
    });
  }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
