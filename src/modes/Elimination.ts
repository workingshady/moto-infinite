// Elimination (knockout) race: every few seconds the rider in last place is knocked out, until one is
// left standing. Works against AI rivals and between split-screen players. The interval scales with
// the track's lap time so short and long circuits play alike.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Standing } from '../systems/Race';
import type { TrackLine } from '../world/layout';
import { RACE } from '../config';
import { clamp } from '../utils/math';
import { mountTopCentre } from './index';
import { paceProfile } from './pace';
import type { ModeFeature } from './index';

const WARN = 4; // seconds of "danger" warning before each knockout

interface Out { row: Standing; order: number }

export class Elimination implements ModeFeature {
  private interval: number;
  private timer: number;
  private out: Out[] = [];
  private outLocal = new Set<number>();
  private els: HTMLDivElement[] = [];
  private html: string[] = [];
  private frame = 0;
  private endT = -1;
  private beeped = -1;
  private total: number;

  constructor(private game: Game, track: TrackLine) {
    const def = game.players[0]?.def;
    const lap = def ? paceProfile(track, def, 0.95).lap : 60;
    this.interval = Math.round(clamp(lap * 0.55, 14, 35));
    this.timer = this.interval;
    this.total = game.players.length + (game.ai?.list.length ?? 0);
    for (const p of game.players) {
      const el = document.createElement('div');
      el.className = 'panel md-panel md-elim';
      mountTopCentre(p, el);
      this.els.push(el);
      this.html.push('');
    }
    const solo = this.total < 2;
    setTimeout(() => game.players.forEach((p) => p.storyBeat('ELIMINATION', solo ? 'Add AI rivals or a second player: knockouts need at least two riders.' : `Last place is knocked out every ${this.interval} s. Be the last rider standing.`)), 900);
  }

  private get active() {
    const g = this.game, locals = g.players.filter((p) => !this.outLocal.has(p.index) && !p.race.finished).length;
    return locals + (g.ai?.list.filter((r) => !r.finished).length ?? 0);
  }

  update(dt: number) {
    const g = this.game, race = g.race;
    if (!race || this.total < 2) return;
    if (race.started && this.endT < 0) {
      this.timer -= dt;
      const c = Math.ceil(this.timer);
      if (this.timer <= WARN && c !== this.beeped && c > 0) { this.beeped = c; g.audio.play('count', 0.6); }
      if (this.timer <= 0) {
        this.timer = this.interval;
        this.beeped = -1;
        if (this.active >= 2) this.knockOut();
        this.checkEnd();
      }
      // a split-screen partner can finish on laps after the other was knocked out
      if (this.endT < 0 && this.outLocal.size && g.players.every((p) => this.outLocal.has(p.index) || p.race.finished)) this.endT = RACE.resultsDelay;
    }
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0) g.hooks.onRaceResults(race.standings());
    }
    if (this.frame++ % 4 === 0) g.players.forEach((p, i) => this.paint(p, i));
  }

  /** Last of the riders still racing (standings are sorted best-first). */
  private lastActive(): Standing | undefined {
    const g = this.game, rows = g.race!.standings();
    const activeIds = new Set([...g.players.filter((p) => !this.outLocal.has(p.index) && !p.race.finished).map((p) => String(p.index)), ...(g.ai?.list.filter((r) => !r.finished).map((r) => r.id) ?? [])]);
    for (let i = rows.length - 1; i >= 0; i--) if (activeIds.has(rows[i].id) && (rows[i].local || rows[i].id.startsWith('ai'))) return rows[i];
    return undefined;
  }

  private knockOut() {
    const g = this.game, row = this.lastActive();
    if (!row) return;
    const order = this.out.length + 1, place = this.total - this.out.length;
    this.out.push({ row: { ...row, time: null, note: `Knocked out · ${ordinal(order)} out` }, order });
    if (row.local) {
      const p = g.players[+row.id];
      this.outLocal.add(p.index);
      p.controlsLocked = true;
      p.hud.banner('ELIMINATED', `P${place} · knocked out`, '#ff4d5e');
      p.hud.flash('#ff3040', 0.35);
      p.cam.shake = 0.5;
      g.audio.play('fail');
      g.players.filter((o) => o !== p).forEach((o) => o.hud.banner(`${p.name.toUpperCase()} OUT`, `${this.active} riders left`, '#ff7a3d'));
    } else if (g.ai) {
      const idx = g.ai.list.findIndex((r) => r.id === row.id);
      if (idx < 0) return;
      const r = g.ai.list[idx];
      g.fx.burst(r.x, r.y + 1, r.z, { n: 40, speed: 8, life: 1.2, size: [1.2, 3], colors: [0x444444, 0xff5533, 0x222222], gravity: -1, drag: 1.5, smoke: true, alpha: 0.8 });
      g.effects.ring(r.x, r.y + 0.3, r.z, 8, 0xff4d5e);
      g.scene.remove(r.model.root);
      g.ai.list.splice(idx, 1);
      g.audio.play('boom', 0.4);
      g.players.forEach((p) => p.hud.banner(`${r.name.toUpperCase()} OUT`, `${this.active} riders left`, '#ff7a3d'));
    }
  }

  private checkEnd() {
    const g = this.game;
    if (this.active <= 1) {
      // last rider standing wins on the spot
      const t = g.time - g.race!.startTime;
      const p = g.players.find((x) => !this.outLocal.has(x.index) && !x.race.finished);
      if (p) {
        p.race.finished = true;
        p.race.finishTime = t;
        p.hud.banner('LAST ONE STANDING', 'you win the elimination!', '#7cffb2');
        g.audio.play('challenge');
        g.career?.feat('elimWin');
      } else {
        const r = g.ai?.list.find((x) => !x.finished);
        if (r) { r.finished = true; r.finishTime = t; }
      }
    }
    // the Race ends itself when every local player has finished; once one of them is knocked out, we do
    const localsDone = g.players.every((p) => this.outLocal.has(p.index) || p.race.finished);
    if (localsDone && this.outLocal.size && this.endT < 0) this.endT = RACE.resultsDelay;
  }

  private paint(p: Player, i: number) {
    const g = this.game, race = g.race!;
    let html: string;
    if (this.outLocal.has(p.index)) html = `<div class="label">🪓 ELIMINATION</div><b class="bad">KNOCKED OUT</b><div class="dim">${this.active} riders left</div>`;
    else if (p.race.finished) html = `<div class="label">🪓 ELIMINATION</div><b class="good">SURVIVED</b>`;
    else {
      const last = race.started && this.lastActive()?.id === String(p.index) && this.active > 1;
      const sec = race.started ? Math.max(0, Math.ceil(this.timer)) : this.interval;
      const danger = last && this.timer <= WARN;
      html = `<div class="label">🪓 ELIMINATION · ${this.active} left</div><div class="md-elim-t ${danger ? 'danger' : ''}">${sec}s</div><div class="${last ? 'bad' : 'good'}">${last ? '⚠ LAST PLACE: overtake!' : '✓ safe'}</div>`;
      this.els[i].classList.toggle('danger', danger);
    }
    if (html !== this.html[i]) this.els[i].innerHTML = this.html[i] = html;
  }

  /** Survivors by the race order first, then the knocked-out riders, last one out first. */
  results(rows: Standing[]): Standing[] {
    const outIds = new Set(this.out.map((o) => o.row.id));
    const alive = rows.filter((r) => !outIds.has(r.id)).map((r) => ({ ...r, note: r.time !== null ? undefined : 'Survived' }));
    const outRows = [...this.out].sort((a, b) => b.order - a.order).map((o) => o.row);
    return [...alive, ...outRows];
  }

  dispose() {
    this.els.forEach((e) => e.remove());
  }
}

const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
