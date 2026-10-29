// Timed challenges per player in open world. Completing several in a row builds a streak bonus.
import type { Player } from '../entities/Player';
import { CHALLENGES, type ChallengeDef, type ChallengeId } from '../data/challenges';

export interface ActiveChallenge { def: ChallengeDef; n: number; prog: number; t: number; done: boolean }

export class PlayerChallenges {
  active: ActiveChallenge | null = null;
  streak = 0;
  private cooldown = 6;
  private last: ChallengeId | null = null;

  constructor(private p: Player) {}

  notify(id: ChallengeId, v: number) {
    const c = this.active;
    if (!c || c.done || c.def.id !== id) return;
    c.prog = c.def.mode === 'max' ? Math.max(c.prog, v) : c.prog + v;
    if (c.prog < c.n) return;
    c.done = true;
    this.streak++;
    const p = this.p, xp = Math.round(300 * (1 + 0.25 * (this.streak - 1)));
    p.game.audio.play('challenge');
    p.hud.banner('CHALLENGE COMPLETE', `+${xp} XP · nitro refilled${this.streak > 1 ? ` · streak x${this.streak}` : ''}`, '#7cffb2');
    p.addXP(xp);
    p.s.nitro = p.stats.nitroMax;
    p.hud.flash('#7cffb2', 0.35);
    p.game.fx.burst(p.P.x, p.P.y + 2, p.P.z, { n: 80, speed: 18, life: 1.2, size: [0.6, 0.1], colors: [0x7cffb2, 0xffffff, 0x3cc8ff], gravity: 6 });
    this.cooldown = 8;
  }

  update(dt: number) {
    const c = this.active, p = this.p;
    if (c && !c.done) {
      c.t -= dt;
      if (p.riding) this.notify('speed', Math.abs(p.B.v) * 3.6);
      this.notify('nohit', p.game.time - p.s.lastHurt);
      if (c.t <= 0) {
        c.done = true;
        this.streak = 0;
        p.game.audio.play('fail');
        p.hud.banner('CHALLENGE FAILED', '', '#ff4d5e');
        this.cooldown = 8;
      }
    } else {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.start();
    }
  }

  private start() {
    const options = CHALLENGES.filter((d) => d.id !== this.last);
    const def = options[Math.floor(Math.random() * options.length)], n = def.target();
    this.last = def.id;
    this.active = { def, n, prog: 0, t: def.time, done: false };
    if (def.spawn) this.p.game.entities.spawnNear(this.p, def.spawn.type, n + def.spawn.extra, def.spawn.minD, def.spawn.maxD);
    if (def.id === 'nohit') this.p.s.lastHurt = this.p.game.time;
    this.p.game.audio.play('trick');
    this.p.hud.banner('NEW CHALLENGE', def.text(n), '#3cc8ff');
  }
}
