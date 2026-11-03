// Online leaderboard hook-up for one solo session: submits flying laps (with the ghost) on races, runs a timed
// score run in drift venues, and remembers the last result for the results screen. Split screen, online rooms,
// training and the menu background never submit.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import { LB, LB_CIRCUITS, LB_DRIFT, LB_F1, type Challenge, type LbSubmitResult, type VehicleClass } from '../../shared/leaderboard';
import { submitScore } from '../net/leaderboard';
import { fmt } from './Race';
import { featNow, type Feat } from '../core/career';
import { toast } from '../ui/toast';

export interface LbBoardResult { board: string; label: string; res: LbSubmitResult | null }
export interface LbRunInfo { title: string; time: boolean; value: number; boards: LbBoardResult[]; challenge: Challenge | null }

let last: Promise<LbRunInfo> | null = null;
/** The most recent submission of the current session, resolved once the server answered (for the results screen). */
export const lastLbRun = () => last;

export const vehicleClass = (p: Player): VehicleClass => (p.def.f1 ? 'f1' : p.def.kind === 'car' ? 'car' : 'bike');
export const fmtValue = (v: number, time: boolean) => (time ? fmt(v) : Math.round(v).toLocaleString());
const boardLabel = (b: string) => (b.startsWith('daily:') ? 'Daily' : b.startsWith('weekly:') ? 'Weekly' : 'All-time');

export class LbSession {
  private boards: string[] = [];
  private bestLap = Infinity;
  private toastEl: HTMLDivElement | null = null;
  private toastT = 0;
  private timerEl: HTMLDivElement | null = null;
  private run: { start: number; total: number; done: boolean; grace: number } | null = null;
  private raf = 0;
  private off: (() => void) | null = null;
  private disposed = false;
  readonly challenge: Challenge | null;

  /** Returns null when this session can't post to any board. */
  static create(game: Game, challenge: Challenge | null, onRunEnd: (info: LbRunInfo) => void) {
    const o = game.opts;
    if (o.attract || o.tutorial || game.net || game.players.length !== 1) return null;
    const s = new LbSession(game, challenge, onRunEnd);
    return s.boards.length ? s : (s.dispose(), null);
  }

  private constructor(private game: Game, challenge: Challenge | null, private onRunEnd: (info: LbRunInfo) => void) {
    const o = game.opts, p = game.players[0], cls = vehicleClass(p);
    last = null;
    // a challenge only counts when the session really is that challenge
    this.challenge = challenge && challenge.mode === o.mode && challenge.trackId === o.trackId && challenge.vehicle === p.def.id ? challenge : null;
    if (this.challenge) this.boards.push(this.challenge.board);
    if (o.mode === 'race' && LB_CIRCUITS[o.trackId] && cls !== 'f1') this.boards.push(`track:${o.trackId}:${cls}`);
    if (o.mode === 'f1' && LB_F1[o.trackId] && cls === 'f1') this.boards.push(`track:${o.trackId}:f1`);
    if (o.mode === 'drift' && LB_DRIFT[o.trackId]) {
      this.boards.push(`drift:${o.trackId}`);
      this.startRun();
    }
  }

  get title() {
    const c = this.challenge, o = this.game.opts;
    if (c) return `${c.kind === 'daily' ? 'Daily' : 'Weekly'} challenge · ${c.trackName}`;
    return LB_CIRCUITS[o.trackId]?.name ?? LB_F1[o.trackId]?.name ?? LB_DRIFT[o.trackId] ?? o.trackId;
  }

  /** A flying lap of the local player (from Race): submit when it beats this session's best. */
  lap(time: number, samples: number[]) {
    if (time >= this.bestLap || this.run) return;
    this.bestLap = time;
    last = this.submit(time, true, samples.length >= LB.ghostStride * 10 ? samples.slice() : undefined);
  }

  private async submit(value: number, time: boolean, ghost?: number[]) {
    const p = this.game.players[0], info: LbRunInfo = { title: this.title, time, value, boards: [], challenge: this.challenge };
    const results = await Promise.all(this.boards.map((b) => submitScore(b, value, p.name, p.def.id, ghost)));
    info.boards = this.boards.map((b, i) => ({ board: b, label: boardLabel(b), res: results[i] }));
    this.careerFeats(info);
    const main = info.boards[0], r = main?.res;
    if (this.disposed) return info;
    this.toast(r?.ok ? `🏆 ${main.label} #${r.rank} of ${r.total}${r.improved ? ' · new best' : ''}` : r ? `⚠ ${r.error ?? 'Not accepted'}` : '📴 Offline: saved, will upload later');
    return info;
  }

  /** Career: a posted challenge run counts once per challenge (offline too: it is queued), best ranks feed achievements.
   *  The answer can arrive after the session ended; then the career is updated directly. */
  private careerFeats(info: LbRunInfo) {
    const feat = (f: Feat, v = 1, key = '') => {
      if (!this.disposed && this.game.career) this.game.career.feat(f, v, key);
      else for (const a of featNow(f, v, key)) toast(`${a.icon} Achievement: ${a.name}`);
    };
    if (this.challenge) feat('challenge', 1, this.challenge.board);
    for (const b of info.boards) if (b.res?.ok && b.res.rank) feat('lbRank', b.res.rank);
  }

  private toast(text: string) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'lb-toast';
      this.game.hudLayer.appendChild(this.toastEl);
    }
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl?.classList.remove('on'), 4500);
  }

  // ---------------------------------------------------------------- timed drift run
  private startRun() {
    const g = this.game, p = g.players[0];
    this.run = { start: g.time, total: 0, done: false, grace: 0 };
    this.timerEl = document.createElement('div');
    this.timerEl.className = 'lb-timer';
    g.hudLayer.appendChild(this.timerEl);
    this.off = g.events.on('progress', (e) => {
      if (e.id === 'drift' && e.player === p && this.run && !this.run.done) this.run.total += e.value;
    });
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.tickRun();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private tickRun() {
    const r = this.run, el = this.timerEl;
    if (!r || r.done || !el) return;
    const g = this.game, t = g.time - r.start, left = Math.max(0, LB.driftSeconds - t);
    el.innerHTML = `<span>${this.challenge ? (this.challenge.kind === 'daily' ? 'DAILY' : 'WEEKLY') : 'SCORE RUN'}</span><b>${fmt(left).replace(/\.\d+$/, '')}</b><em>${Math.round(r.total).toLocaleString()}</em>`;
    el.classList.toggle('low', left < 10);
    // time up: let a chain in progress bank (up to 3 s), then post the total
    if (left > 0 || (g.players[0].drift.on && t - LB.driftSeconds < 3)) return;
    r.done = true;
    cancelAnimationFrame(this.raf);
    el.innerHTML = `<span>TIME</span><b>0:00</b><em>${Math.round(r.total).toLocaleString()}</em>`;
    setTimeout(() => el.remove(), 6000);
    if (r.total < 100) {
      this.toast('Score run over: no drifts banked. Try again!');
      return;
    }
    last = this.submit(r.total, false);
    void last.then((info) => { if (!this.disposed) this.onRunEnd(info); });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastT);
    this.off?.();
    this.toastEl?.remove();
    this.timerEl?.remove();
  }
}
