// Circuit racing: countdown, checkpoint gates, laps, live positions (local + online) and a best-lap ghost.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Circuit } from '../world/layout';
import { G, MAT, mesh } from '../entities/assets';
import { buildGhost } from '../entities/models';
import { RACE } from '../config';
import { lerp, lerpAngle } from '../utils/math';

export interface Standing { id: string; name: string; color: number; local: boolean; prog: number; time: number | null; lap: number }

interface GhostData { time: number; s: number[] } // samples: x,y,z,h,pitch per tick

export class Race {
  readonly cps: number[] = [];
  countdown = RACE.countdown + 1;
  started = false;
  startTime = 0;
  over = false;
  private resultsT = -1;
  private ghost: THREE.Group | null = null;
  private ghostData: GhostData | null = null;
  private rec: number[] = [];
  private recT = 0;
  private lastCount = -1;
  readonly remoteFinish = new Map<string, number>();

  constructor(private game: Game, private track: Circuit, readonly laps: number, private trackId: string) {
    const n = track.n;
    for (let i = 0; i < RACE.checkpoints; i++) this.cps.push(Math.round((i / RACE.checkpoints) * n) % n);
    this.cps.forEach((idx, i) => this.gate(idx, i === 0));
    if (game.players.length === 1 && !game.net && trackId !== 'random') {
      this.ghostData = load(trackId);
      this.ghost = buildGhost();
      this.ghost.visible = false;
      game.scene.add(this.ghost);
    }
    for (const p of game.players) p.controlsLocked = true;
  }

  private gate(idx: number, start: boolean) {
    const t = this.track, g = this.game, x = t.px[idx], z = t.pz[idx], tx = t.tx[idx], tz = t.tz[idx];
    const y = g.terrain.heightAt(x, z), root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = Math.atan2(tx, tz);
    root.add(mesh(G.post, MAT.gate, -7, 3, 0), mesh(G.post, MAT.gate, 7, 3, 0));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.6, start ? 1.6 : 1), start ? MAT.checker : MAT.cpBanner);
    banner.position.y = 6;
    root.add(banner);
    if (start) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.2).rotateX(-Math.PI / 2), MAT.checker);
      line.position.y = 0.09;
      root.add(line);
    }
    g.scene.add(root);
  }

  /** Online: everyone starts when the room says so. Locally: right away. */
  update(dt: number) {
    const g = this.game;
    if (!this.started) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c <= RACE.countdown) {
        this.lastCount = c;
        if (c > 0) { g.audio.play('count'); g.players.forEach((p) => p.hud.countdown(String(c))); }
      }
      if (this.countdown <= 0) {
        this.started = true;
        this.startTime = g.time;
        g.audio.play('go');
        for (const p of g.players) {
          p.controlsLocked = false;
          p.hud.countdown('GO!');
          p.race.lapStart = g.time;
        }
      }
      return;
    }
    for (const p of g.players) this.track1(p);
    if (this.ghost && g.players[0]) this.record(g.players[0], dt);
    this.updateGhost();
    const places = this.standings();
    for (const p of g.players) p.race.place = places.findIndex((s) => s.local && s.id === String(p.index)) + 1;
    if (!this.over && g.players.every((p) => p.race.finished)) {
      this.over = true;
      this.resultsT = RACE.resultsDelay;
    }
    if (this.resultsT > 0) {
      this.resultsT -= dt;
      if (this.resultsT <= 0) g.hooks.onRaceResults(this.standings());
    }
  }

  private track1(p: Player) {
    const r = p.race, t = this.track, g = this.game;
    if (r.finished) return;
    const near = t.nearest(p.P.x, p.P.z, true), n = t.n, C = this.cps.length;
    const target = this.cps[r.nextCp], win = Math.round(30 / t.spacing);
    if (near.d < 20 && (near.i - target + n) % n <= win) {
      if (r.nextCp === 0) {
        if (r.lap > 0) {
          const lapTime = g.time - r.lapStart;
          r.lastLap = lapTime;
          const best = !r.best || lapTime < r.best;
          if (best) r.best = lapTime;
          if (p.index === 0) this.lapDone(lapTime);
          if (r.lap >= this.laps) {
            r.finished = true;
            r.finishTime = g.time - this.startTime;
            p.controlsLocked = false;
            g.audio.play('challenge');
            p.hud.banner('FINISHED!', `${fmt(r.finishTime)} · P${r.place}`, '#7cffb2');
            g.net?.send({ t: 'finish', time: r.finishTime });
            return;
          }
          g.audio.play('lap');
          p.hud.banner(r.lap + 1 === this.laps ? 'FINAL LAP' : `LAP ${r.lap + 1}`, `${fmt(lapTime)}${best ? ' · BEST' : ''}`, best ? '#7cffb2' : '#ffd23f');
        }
        r.lap++;
        r.lapStart = g.time;
        if (p.index === 0) { this.rec = []; this.recT = 0; }
      } else g.audio.play('select');
      r.nextCp = (r.nextCp + 1) % C;
    }
    // continuous progress = completed laps + fraction, clamped to the current checkpoint segment
    const last = (r.nextCp - 1 + C) % C, segStart = this.cps[last];
    const segLen = ((this.cps[r.nextCp] - segStart + n) % n) || n;
    const frac = (segStart + Math.min((near.i - segStart + n) % n, segLen)) / n; // segments never pass the start line
    r.prog = r.lap === 0 ? frac - 1 : r.lap - 1 + frac;
  }

  /** Position of the next gate, for the minimap arrow. */
  nextGate(p: Player) {
    const i = this.cps[p.race.nextCp];
    return { x: this.track.px[i], z: this.track.pz[i] };
  }

  standings(): Standing[] {
    const g = this.game, rows: Standing[] = g.players.map((p) => ({
      id: String(p.index), name: p.name, color: p.color, local: true, prog: p.race.prog, lap: p.race.lap,
      time: p.race.finished ? p.race.finishTime : null,
    }));
    g.remotes?.forEach((r) => rows.push({ id: r.id, name: r.name, color: r.color, local: false, prog: r.state?.prog ?? -1, lap: r.state?.lap ?? 0, time: this.remoteFinish.get(r.id) ?? null }));
    return rows.sort((a, b) => (a.time !== null || b.time !== null ? (a.time ?? 1e9) - (b.time ?? 1e9) : b.prog - a.prog));
  }

  private record(p: Player, dt: number) {
    if (p.race.lap < 1 || p.race.finished) return;
    this.recT -= dt;
    if (this.recT > 0) return;
    this.recT = 1 / RACE.ghostHz;
    this.rec.push(p.B.x, p.B.y, p.B.z, p.B.h, p.B.pitch);
  }

  private lapDone(time: number) {
    if (!this.ghost || this.trackId === 'random') return;
    if (!this.ghostData || time < this.ghostData.time) {
      this.ghostData = { time, s: this.rec.slice() };
      save(this.trackId, this.ghostData);
    }
  }

  private updateGhost() {
    const gh = this.ghost, d = this.ghostData, p = this.game.players[0];
    if (!gh || !d || !p || p.race.lap < 1 || p.race.finished) { if (gh) gh.visible = false; return; }
    const t = (this.game.time - p.race.lapStart) * RACE.ghostHz, i = Math.floor(t), f = t - i, N = d.s.length / 5;
    if (i + 1 >= N) { gh.visible = false; return; }
    const a = i * 5, b = a + 5, s = d.s;
    gh.visible = true;
    gh.position.set(lerp(s[a], s[b], f), lerp(s[a + 1], s[b + 1], f), lerp(s[a + 2], s[b + 2], f));
    gh.rotation.set(lerp(s[a + 4], s[b + 4], f), lerpAngle(s[a + 3], s[b + 3], f), 0, 'YXZ');
  }

  bestLap() {
    return this.ghostData?.time ?? 0;
  }
}

export const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};

function load(id: string): GhostData | null {
  try {
    const raw = localStorage.getItem('moto:ghost:' + id);
    return raw ? (JSON.parse(raw) as GhostData) : null;
  } catch {
    return null;
  }
}
function save(id: string, d: GhostData) {
  try {
    localStorage.setItem('moto:ghost:' + id, JSON.stringify({ time: d.time, s: d.s.map((v) => Math.round(v * 100) / 100) }));
  } catch {
    /* storage full or blocked: ghost just isn't kept */
  }
}
