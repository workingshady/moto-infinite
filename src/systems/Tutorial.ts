// Guided training ride: a checklist of skills, each step checked off live while you ride.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';

interface Step {
  /** Only for this vehicle kind. */
  only?: 'bike' | 'car';
  title: string;
  keys: string;
  hint: string;
  done(t: Tutorial, p: Player, dt: number): boolean;
  start?(t: Tutorial, p: Player): void;
}

const counter = (id: string, n: number) => (t: Tutorial) => (t.counts[id] ?? 0) >= n;

export const STEPS: Step[] = [
  { title: 'Get on your ride', keys: 'Walk ↑↓←→ · E to ride', hint: 'Your vehicle is right next to you (blue dot on the minimap).', done: (_t, p) => p.riding },
  { title: 'Throttle to 60 km/h', keys: '↑ or W', hint: 'Watch the speed in the top-left panel.', done: (_t, p) => Math.abs(p.B.v) * 3.6 >= 60 },
  {
    title: 'Steer through the curves', keys: '← → or A D', hint: 'Steering eases in, so hold the key a moment.',
    done: (t, p, dt) => (t.acc += Math.abs(p.B.v) > 8 ? Math.abs(p.B.steer) * dt : 0) > 2,
  },
  {
    title: 'Boost AND steer', keys: 'Space / Shift / N  +  ← →', hint: 'Nitro drives the bike by itself, so you don\'t need ↑. Fewer keys = no keyboard ghosting.',
    done: (t, p, dt) => (t.acc += p.cam.boost > 0.5 && Math.abs(p.B.steer) > 0.4 ? dt : 0) > 1.2,
  },
  { only: 'bike', title: 'Pop a 1.5 s wheelie', keys: 'Hold C while riding', hint: 'Works at any speed. ↑/↓ adjust the angle (↓ does not brake), release C to land.', done: counter('wheelie', 1.5), start: (t) => (t.counts.wheelie = 0) },
  { only: 'car', title: 'Bank a handbrake drift', keys: 'X into a corner, steer against the slide', hint: 'Straighten up for a moment to bank the points.', done: counter('drift', 150), start: (t) => (t.counts.drift = 0) },
  { title: 'Get big air (0.8 s)', keys: 'Hit an orange ramp ■', hint: 'Ramps are orange squares on the minimap. Hands off in the air = the bike levels itself.', done: (_t, p) => p.B.air && p.B.airT > 0.8 },
  { only: 'bike', title: 'Land a flip', keys: 'In the air: let go, then ↑ or ↓', hint: 'Release ↑ after takeoff, press it again to rotate. Stop before landing.', done: counter('flip', 1), start: (t) => (t.counts.flip = 0) },
  { only: 'bike', title: 'Land a 360 spin', keys: 'In the air: ← or →', hint: 'Let go before you touch down. Facing forward = clean landing.', done: counter('spin', 1), start: (t) => (t.counts.spin = 0) },
  { only: 'bike', title: 'Land a style trick', keys: 'In the air: hold C (+↑ Superman, +↓ Heel Clicker)', hint: 'Let go of C before landing or you bail.', done: counter('style', 1), start: (t) => (t.counts.style = 0) },
  {
    title: 'Smash 2 crates', keys: 'F or left click', hint: 'Shots auto-aim at the red reticle and lead moving targets.',
    done: counter('crate', 2), start: (t, p) => { t.counts.crate = 0; p.game.entities.spawnNear(p, 'crate', 4, 25, 45); },
  },
  { title: 'Collect 3 gems', keys: 'Ride through 💎', hint: 'Gems give XP and nitro. Level up to unlock weapons.', done: counter('gem', 3), start: (t) => (t.counts.gem = 0) },
];

export class Tutorial {
  step = 0;
  /** Steps that apply to the player's vehicle. */
  readonly steps: Step[];
  acc = 0;
  complete = false;
  readonly counts: Record<string, number> = {};

  constructor(private game: Game) {
    const kind = game.players[0]?.def.kind ?? 'bike';
    this.steps = STEPS.filter((s) => !s.only || s.only === kind);
    game.events.on('progress', (e) => (this.counts[e.id] = e.id === 'wheelie' || e.id === 'drift' ? Math.max(this.counts[e.id] ?? 0, e.value) : (this.counts[e.id] ?? 0) + e.value));
  }

  update(dt: number) {
    const p = this.game.players[0];
    if (this.complete || !p) return;
    const s = this.steps[this.step];
    if (!s.done(this, p, dt)) return;
    this.game.audio.play('challenge');
    p.hud.banner('✓ ' + s.title.toUpperCase(), this.step + 1 < this.steps.length ? 'Next: ' + this.steps[this.step + 1].title : '', '#7cffb2');
    p.addXP(100);
    this.step++;
    this.acc = 0;
    if (this.step >= this.steps.length) {
      this.complete = true;
      setTimeout(() => p.storyBeat('TRAINING COMPLETE', 'You\'re ready. Challenges and drones are now live. The road is yours.'), 1600);
      return;
    }
    this.steps[this.step].start?.(this, p);
  }
}
