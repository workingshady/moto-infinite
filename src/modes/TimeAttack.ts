// Time Attack: Trackmania-style medal runs on the circuits. Every track x vehicle gets four target lap
// times computed from the track's corners and the vehicle's speed/grip (Bronze, Silver, Gold = the
// best AI pace, Ace = a near-perfect lap with nitro). A live split shows whether this lap is on pace
// for the next medal; your personal best and best medal are saved per track and vehicle.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Standing } from '../systems/Race';
import type { TrackLine } from '../world/layout';
import { markChanged } from '../core/syncBus';
import { fmt } from '../systems/Race';
import { mountTopCentre } from './index';
import { paceProfile, type PaceProfile } from './pace';
import type { ModeFeature } from './index';

export const MEDALS = [
  { name: 'Bronze', icon: '🥉', color: '#d08a4a', skill: 0.8, topMul: 1 },
  { name: 'Silver', icon: '🥈', color: '#cfd8e3', skill: 0.9, topMul: 1 },
  { name: 'Gold', icon: '🥇', color: '#ffd23f', skill: 0.97, topMul: 1 },
  { name: 'Ace', icon: '💎', color: '#5ff2ff', skill: 1, topMul: 1.1 },
] as const;

interface Best { best: number; medal: number }

interface Rider {
  p: Player;
  times: number[];
  pace: PaceProfile;
  key: string;
  rec: Best;
  /** Medal earned this session (0 = none, 1..4). */
  medal: number;
  lapsSeen: number;
  el: HTMLDivElement;
  html: string;
}

const medalOf = (t: number, times: number[]) => times.reduce((m, target, i) => (t <= target ? i + 1 : m), 0);

function load(key: string): Best {
  try {
    const v = localStorage.getItem(key);
    return v ? ({ best: 0, medal: 0, ...(JSON.parse(v) as Partial<Best>) }) : { best: 0, medal: 0 };
  } catch {
    return { best: 0, medal: 0 };
  }
}
function save(key: string, r: Best) {
  try {
    localStorage.setItem(key, JSON.stringify(r));
  } catch {
    /* not persisted */
  }
  markChanged('ta');
}

export class TimeAttack implements ModeFeature {
  private riders: Rider[] = [];
  private frame = 0;

  constructor(private game: Game, track: TrackLine) {
    const o = game.opts, where = o.trackId === 'random' ? 'r' + o.seed : o.trackId;
    for (const p of game.players) {
      const times = MEDALS.map((m) => paceProfile(track, p.def, m.skill, m.topMul).lap);
      const key = `moto:ta:${where}:${p.def.id}`, el = document.createElement('div');
      el.className = 'panel md-panel md-attack';
      mountTopCentre(p, el);
      this.riders.push({ p, times, pace: paceProfile(track, p.def, 1), key, rec: load(key), medal: 0, lapsSeen: 0, el, html: '' });
    }
    setTimeout(() => this.riders.forEach((r) => r.p.storyBeat('TIME ATTACK', `Beat the medal times: ${MEDALS.map((m, i) => `${m.icon} ${fmt(r.times[i])}`).reverse().join('  ')}. Every lap counts, your best lap wins the medal.`)), 900);
  }

  update() {
    const race = this.game.race;
    if (!race) return;
    for (const r of this.riders) {
      const pr = r.p.race, laps = pr.lap + (pr.finished ? 1 : 0);
      if (laps !== r.lapsSeen) {
        r.lapsSeen = laps;
        if (pr.lastLap > 0) this.lapDone(r, pr.lastLap);
      }
    }
    if (this.frame++ % 4 === 0) for (const r of this.riders) this.paint(r);
  }

  private lapDone(r: Rider, t: number) {
    const m = medalOf(t, r.times), g = this.game;
    if (m > r.medal) {
      r.medal = m;
      const def = MEDALS[m - 1];
      setTimeout(() => r.p.hud.banner(`${def.icon} ${def.name.toUpperCase()} MEDAL`, fmt(t), def.color), 1700); // after the lap banner
      g.audio.play('unlock');
      g.effects.ring(r.p.P.x, r.p.P.y + 0.5, r.p.P.z, 10, parseInt(def.color.slice(1), 16));
    }
    if (!r.rec.best || t < r.rec.best) {
      const before = r.rec.medal;
      r.rec.best = t;
      r.rec.medal = Math.max(r.rec.medal, m);
      save(r.key, r.rec);
      // career pays once per track x vehicle and medal step (a better medal than ever before here)
      if (r.rec.medal > before) g.career?.feat('medal', r.rec.medal);
    }
  }

  private paint(r: Rider) {
    const g = this.game, race = g.race!, pr = r.p.race;
    const best = Math.min(pr.best || 1e9, r.rec.best || 1e9), got = Math.max(r.medal, r.rec.medal);
    const next = Math.min(3, got), target = r.times[next], targetDef = MEDALS[next];
    let live = '';
    if (race.started && !pr.finished && pr.lap >= 1) {
      const cur = g.time - pr.lapStart, frac = Math.max(0, Math.min(1, pr.prog - (pr.lap - 1)));
      const i = Math.min(r.pace.cum.length - 1, Math.round(frac * (r.pace.cum.length - 1)));
      const delta = cur - target * r.pace.cum[i];
      live = `<div class="md-live"><span>${fmt(cur)}</span><b class="${delta <= 0 ? 'good' : 'bad'}">${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}</b><em>vs ${targetDef.icon}</em></div>`;
    }
    const chips = MEDALS.map((m, i) => `<span class="md-chip ${got > i ? 'won' : ''} ${i === next && got <= i ? 'next' : ''}" style="--mc:${m.color}">${m.icon} ${fmt(r.times[i])}</span>`).reverse().join('');
    const html = `<div class="label">⏱ TIME ATTACK</div><div class="md-chips">${chips}</div>${live}<div class="dim md-pb">PB ${best < 1e9 ? fmt(best) : '--'}${r.rec.medal ? ' ' + MEDALS[r.rec.medal - 1].icon : ''}</div>`;
    if (html !== r.html) r.el.innerHTML = r.html = html;
  }

  results(rows: Standing[]): Standing[] {
    return rows.map((row) => {
      const r = this.riders.find((x) => row.local && String(x.p.index) === row.id);
      if (!r) return row;
      const lap = r.p.race.best, m = MEDALS[r.medal - 1];
      return { ...row, note: `${lap ? fmt(lap) : '--'} best lap · ${m ? `${m.icon} ${m.name}` : 'no medal'}` };
    });
  }

  dispose() {
    this.riders.forEach((r) => r.el.remove());
  }
}
