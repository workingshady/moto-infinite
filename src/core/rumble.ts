// Controller rumble (Gamepad vibrationActuator 'dual-rumble') and phone vibration, driven by what the player feels:
// camera-shake spikes (crashes, hard landings, collisions, hits), weapon fire, nitro, rev limiter and road edges.
// Reads player state once per frame, so gameplay code needs no rumble calls.
import type { Player } from '../entities/Player';
import { settings } from './settings';

interface Feel { shake: number; fireCd: number; offroad: boolean; dead: boolean }
interface Motor { weak: number; strong: number; t: number }

type Actuator = { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown>; reset?: () => Promise<unknown> };

const state = new WeakMap<Player, Feel>();
/** Short decaying pulses per gamepad index. */
const pulses = new Map<number, Motor>();
/** What was last sent to each pad (to avoid flooding playEffect). */
const sent = new Map<number, { weak: number; strong: number; at: number }>();
let lastVibrate = 0;

const actuator = (i: number): Actuator | null => {
  const p = navigator.getGamepads?.()[i];
  return p && p.connected ? ((p as unknown as { vibrationActuator?: Actuator }).vibrationActuator ?? null) : null;
};

function pulse(pad: number, weak: number, strong: number, t: number) {
  const m = pulses.get(pad);
  if (!m) pulses.set(pad, { weak, strong, t });
  else { m.weak = Math.max(m.weak, weak); m.strong = Math.max(m.strong, strong); m.t = Math.max(m.t, t); }
}

/** Phone buzz (player 1, no gamepad), rate-limited. */
function buzz(ms: number) {
  if (!settings.vibrate || !('vibrate' in navigator) || !matchMedia('(pointer: coarse)').matches) return;
  const now = performance.now();
  if (now - lastVibrate < 180) return;
  lastVibrate = now;
  try { navigator.vibrate(ms); } catch { /* not allowed */ }
}

function send(pad: number, weak: number, strong: number) {
  const a = actuator(pad), now = performance.now(), last = sent.get(pad);
  if (!a?.playEffect) return;
  const off = weak < 0.02 && strong < 0.02;
  if (off) {
    if (last && (last.weak || last.strong)) {
      sent.set(pad, { weak: 0, strong: 0, at: now });
      try { void a.reset?.()?.catch(() => undefined); } catch { /* unsupported */ }
    }
    return;
  }
  // re-send when the level changes noticeably or the previous effect is about to run out
  if (last && Math.abs(last.weak - weak) < 0.06 && Math.abs(last.strong - strong) < 0.06 && now - last.at < 80) return;
  sent.set(pad, { weak, strong, at: now });
  try {
    void a.playEffect('dual-rumble', { startDelay: 0, duration: 120, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) })?.catch(() => undefined);
  } catch { /* unsupported */ }
}

/** Once per rendered frame while playing. */
export function feelUpdate(players: Player[], dt: number) {
  const k = settings.rumble / 100;
  for (const p of players) {
    const B = p.B, s = p.s, pad = p.ctrl.gamepad, hasPad = !!actuator(pad);
    const offroad = p.riding && !p.game.terrain.onRoad(B.x, B.z);
    const f = state.get(p) ?? { shake: p.cam.shake, fireCd: s.fireCd, offroad, dead: s.dead };
    // camera shake already encodes how hard something hit (crash 0.9, landing up to 0.6, collisions 0.15-0.5)
    const rise = p.cam.shake - (f.shake - dt * 1.6);
    if (rise > 0.08) {
      pulse(pad, rise * 0.8, rise, 0.12 + rise * 0.35);
      if (p.index === 0 && !hasPad && rise > 0.18) buzz(rise > 0.6 ? 70 : 30);
    }
    if (s.dead && !f.dead) { pulse(pad, 0.6, 1, 0.5); if (p.index === 0 && !hasPad) buzz(90); }
    if (s.fireCd > f.fireCd + 0.02) pulse(pad, 0.45, 0.15, 0.07); // weapon fired (cooldown restarted)
    if (offroad !== f.offroad && Math.abs(B.v) > 8) pulse(pad, 0.5, 0.35, 0.16); // crossing the road edge / kerb
    f.shake = p.cam.shake; f.fireCd = s.fireCd; f.offroad = offroad; f.dead = s.dead;
    state.set(p, f);
    if (!hasPad || k <= 0) { pulses.delete(pad); continue; }
    // continuous: nitro, rev limiter, off-road / rumble-strip texture
    const live = p.riding && !s.dead && !B.air;
    let weak = 0, strong = 0;
    if (p.cam.boost > 0.3) weak = Math.max(weak, 0.12 + p.cam.boost * 0.12);
    if (live) {
      const d = p.dash;
      if (d.redline > 0 && d.rpm >= d.redline * 0.97) weak = Math.max(weak, 0.28);
      if (offroad) { const v = Math.min(1, Math.abs(B.v) / 25); weak = Math.max(weak, 0.15 * v); strong = Math.max(strong, (0.1 + 0.15 * Math.sin(p.game.time * 40)) * v); }
    }
    const m = pulses.get(pad);
    if (m) {
      weak = Math.max(weak, m.weak);
      strong = Math.max(strong, m.strong);
      m.t -= dt;
      if (m.t <= 0) pulses.delete(pad);
    }
    send(pad, weak * k, strong * k);
  }
}

/** Stop every motor (pause, menus, end of session). */
export function stopRumble() {
  pulses.clear();
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  for (const p of list) {
    if (!p?.connected) continue;
    sent.delete(p.index);
    const a = (p as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    try { void a?.reset?.()?.catch(() => undefined); } catch { /* unsupported */ }
  }
}

/** Short test buzz from the Settings slider. */
export function testRumble() {
  const k = settings.rumble / 100;
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  for (const p of list) if (p?.connected) send(p.index, 0.6 * k, 0.9 * k);
  setTimeout(() => stopRumble(), 300);
  if (!list.some((p) => p?.connected)) buzz(60);
}
