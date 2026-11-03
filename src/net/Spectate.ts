// Online spectating: after finishing a race, while wrecked, or when joining a race already under way,
// player 1's camera can follow the other riders in turn. Game calls update/focus/apply; the UI calls cycle/stop.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Remote } from './RemotePlayers';
import { damp } from '../utils/math';

const CAM = { back: 9, up: 3.6, look: 1.4, follow: 4, fov: 62 };

export class Spectator {
  /** Camera is on another rider. */
  active = false;
  targetId = '';
  /** The player turned watching off: don't switch it back on by itself. */
  private dismissed = false;
  private wasFinished = false;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private snap = true;

  constructor(private game: Game) {}

  /** Watching is allowed: late joiner, finished the race, or currently wrecked. */
  get available() {
    const p = this.game.players[0], n = this.game.net;
    return !!p && !!n && (n.spectating || p.race.finished || p.s.dead);
  }

  /** Watching starts on its own for late joiners and after the finish line. */
  private get automatic() {
    const p = this.game.players[0], n = this.game.net;
    return !!p && !!n && (n.spectating || p.race.finished);
  }

  get target(): Remote | null {
    let r: Remote | null = null;
    if (this.active) this.game.remotes?.forEach((x) => { if (x.id === this.targetId) r = x; });
    return r;
  }

  private candidates() {
    const list: Remote[] = [];
    this.game.remotes?.forEach((r) => { if (r.state && !r.away) list.push(r); });
    return list;
  }

  /** Next (+1) or previous (-1) rider. */
  cycle(dir: number) {
    if (!this.available) return;
    const list = this.candidates();
    if (!list.length) { this.active = false; return; }
    const i = list.findIndex((r) => r.id === this.targetId);
    const next = list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + list.length) % list.length];
    if (next.id !== this.targetId || !this.active) this.snap = true;
    this.targetId = next.id;
    this.active = true;
    this.dismissed = false;
  }

  stop() {
    this.active = false;
    this.dismissed = true;
  }

  /** Called from Game.update. */
  update() {
    const p = this.game.players[0], n = this.game.net;
    if (!p || !n) return;
    if (n.spectating) p.controlsLocked = true; // watchers stay parked on the grid until the next start
    const finished = p.race.finished;
    if (finished && !this.wasFinished) this.dismissed = false;
    this.wasFinished = finished;
    if (!this.available) { this.active = false; return; }
    if (this.active && !this.target) this.cycle(1); // rider left: next one
    else if (!this.active && this.automatic && !this.dismissed) this.cycle(1);
  }

  /** Extra point to stream world chunks around, so the watched rider has scenery. */
  focus(): { x: number; z: number } | null {
    const t = this.target;
    return t ? { x: t.x, z: t.z } : null;
  }

  /** Called from Game.render after player 1's own camera update: chase camera behind the watched rider. */
  apply(camera: THREE.PerspectiveCamera, dt: number) {
    const t = this.target;
    if (!t) return;
    const h = t.state?.riding ? t.bike.root.rotation.y : t.rider.root.rotation.y;
    const g = this.game, x = t.x - Math.sin(h) * CAM.back, z = t.z - Math.cos(h) * CAM.back;
    this._v.set(x, Math.max(t.y + CAM.up, g.terrain.groundAt(x, z) + 1.2), z);
    this.look.set(t.x, t.y + CAM.look, t.z);
    if (this.snap) { this.pos.copy(this._v); this.snap = false; }
    else this.pos.lerp(this._v, damp(dt, CAM.follow));
    camera.position.copy(this.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); }
  }
}
