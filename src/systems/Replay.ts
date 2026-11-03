// Replay recorder: a ring buffer of the last ~60 s for every vehicle on screen (local players, AI racers,
// online riders) plus key moments (crash, trick, nitro, lap, finish). Playback never touches the live
// models: it poses lightweight "puppet" copies and hides the real ones only while a replay frame renders,
// so the game resumes exactly where it was.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Remote } from '../net/RemotePlayers';
import type { AiRacer } from './AiRacers';
import { buildRider, seatRider, type RiderModel } from '../entities/models';
import { buildVehicleModel, type VehicleModel } from '../entities/vehicleModels';
import { vehicleById, type VehicleModelId } from '../data/vehicles';
import { REPLAY } from '../config';
import { lerp } from '../utils/math';

export type ReplayEventKind = 'crash' | 'trick' | 'nitro' | 'lap' | 'finish';
export const EVENT_ICON: Record<ReplayEventKind, string> = { crash: '💥', trick: '🤸', nitro: '🔥', lap: '🏁', finish: '🏆' };
const KINDS: ReplayEventKind[] = ['crash', 'trick', 'nitro', 'lap', 'finish'];

// per-frame layout of one actor: position, quaternion, wheel, steer, flags, free rider pos + yaw, speed (km/h)
const STRIDE = 15;
const F_PRESENT = 1, F_BIKE = 2, F_SEATED = 4, F_RIDER = 8, F_DRIVER = 16, F_BOOST = 32;

export interface ReplayActor {
  index: number;
  name: string;
  color: number;
  vehicle: VehicleModelId;
  local: Player | null;
  /** Background vehicle (traffic): replayed, but never a camera target. */
  extra: boolean;
  bike: VehicleModel;
  rider: RiderModel | null;
  tag: THREE.Object3D | null;
  buf: Float32Array;
  seen: number;
  lx: number; ly: number; lz: number; // last recorded position (speed)
  wasN: boolean; lap: number; finished: boolean; nitroT: number;
  puppet: { bike: VehicleModel; rider: RiderModel | null } | null;
  hidden: Uint8Array; // real objects' visibility while a replay frame renders
}

/** Interpolated pose of an actor at a replay time (written into a reused object). */
export interface ActorPose { present: boolean; x: number; y: number; z: number; q: THREE.Quaternion; speed: number; yaw: number; kind: 'bike' | 'car' }

export class Replay {
  readonly cap = Math.ceil(REPLAY.seconds * REPLAY.hz);
  readonly times: Float32Array;
  readonly actors: ReplayActor[] = [];
  /** Recorder clock (game seconds, only runs while recording). */
  clock = 0;
  private head = 0;
  count = 0;
  private acc = 0;
  private frameNo = 0;
  private keyed = new Map<object, ReplayActor>();
  // event ring
  private evT: Float32Array;
  private evKind: Uint8Array;
  private evActor: Int16Array;
  private evLabel: string[];
  private evHead = 0;
  private evCount = 0;
  /** Live notification for the instant-replay prompt. */
  onEvent: ((kind: ReplayEventKind, p: Player | null, pts: number) => void) | null = null;
  /** True while a replay is open: recording pauses so the buffer stays still. */
  frozen = false;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private fdt = 0;
  private slot = 0;
  private loc = { a: 0, b: 0, f: 0 };
  private remoteVisit = (r: Remote) => this.visit(r.bike, r, r.rider, r.tag, r.name, r.color, r.vehicle, null);
  private extraVisit = (key: object, model: VehicleModel, name: string, color: number, vehicle: string) => this.visit(model, key, null, null, name, color, vehicle, null, true);

  constructor(private game: Game) {
    this.times = new Float32Array(this.cap);
    this.evT = new Float32Array(REPLAY.maxEvents);
    this.evKind = new Uint8Array(REPLAY.maxEvents);
    this.evActor = new Int16Array(REPLAY.maxEvents);
    this.evLabel = new Array<string>(REPLAY.maxEvents).fill('');
  }

  // ---------------------------------------------------------------- recording
  /** Called once per Game.update with the scaled frame time. */
  record(dt: number) {
    if (this.frozen) return;
    this.clock += dt;
    this.acc += dt;
    const step = 1 / REPLAY.hz;
    if (this.acc < step) return;
    const fdt = this.acc;
    this.acc %= step;
    this.writeFrame(fdt);
  }

  private writeFrame(fdt: number) {
    const g = this.game, slot = this.head;
    this.frameNo++;
    this.times[slot] = this.clock;
    this.fdt = fdt;
    this.slot = slot;
    for (const p of g.players) this.visit(p.bike, p, p.rider, null, p.name, p.color, p.def.id, p);
    if (g.ai) for (const r of g.ai.list) this.visit(r.model, r, null, null, r.name, r.color, r.def.id, null);
    g.remotes?.forEach(this.remoteVisit);
    for (const m of g.modes) m.replayActors?.(this.extraVisit); // traffic (after the riders, so they always get a slot)
    for (const a of this.actors) if (a.seen !== this.frameNo) a.buf[slot * STRIDE + 9] = 0;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
  }

  private visit(bike: VehicleModel, key: Player | AiRacer | Remote | object, rider: RiderModel | null, tag: THREE.Object3D | null, name: string, color: number, vehicle: string, local: Player | null, extra = false) {
    let a = this.keyed.get(key);
    if (!a || a.bike !== bike) {
      if (this.actors.length >= REPLAY.maxActors) return;
      a = {
        index: this.actors.length, name, color, vehicle: vehicleById(vehicle).id, local, extra, bike, rider, tag, buf: new Float32Array(this.cap * STRIDE), seen: 0,
        lx: bike.root.position.x, ly: bike.root.position.y, lz: bike.root.position.z, wasN: false, lap: local?.race.lap ?? 0, finished: false, nitroT: -99, puppet: null, hidden: new Uint8Array(3),
      };
      this.keyed.set(key, a);
      this.actors.push(a);
    }
    a.seen = this.frameNo;
    const o = this.slot * STRIDE, b = a.buf, R = bike.root, p = R.position, q = R.quaternion;
    const seated = rider ? rider.root.parent === bike.seat : true;
    let flags = F_PRESENT;
    if (R.visible) flags |= F_BIKE;
    if (seated) flags |= F_SEATED;
    if (rider?.root.visible) flags |= F_RIDER;
    if (bike.driver?.visible) flags |= F_DRIVER;
    if (bike.flame.scale.y > 0.5) flags |= F_BOOST;
    b[o] = p.x; b[o + 1] = p.y; b[o + 2] = p.z;
    b[o + 3] = q.x; b[o + 4] = q.y; b[o + 5] = q.z; b[o + 6] = q.w;
    b[o + 7] = bike.wheels.length ? bike.wheels[0].rotation.x : 0;
    b[o + 8] = bike.steer.length ? bike.steer[0].rotation.y : 0;
    b[o + 9] = flags;
    if (rider && !seated) {
      b[o + 10] = rider.root.position.x; b[o + 11] = rider.root.position.y; b[o + 12] = rider.root.position.z; b[o + 13] = rider.root.rotation.y;
    } else { b[o + 10] = p.x; b[o + 11] = p.y; b[o + 12] = p.z; b[o + 13] = 0; }
    const d = Math.hypot(p.x - a.lx, p.y - a.ly, p.z - a.lz);
    b[o + 14] = d > 30 ? b[((this.slot - 1 + this.cap) % this.cap) * STRIDE + 14] : (d / Math.max(1e-3, this.fdt)) * 3.6; // respawn jumps keep the old speed
    a.lx = p.x; a.ly = p.y; a.lz = p.z;
    // key moments that need no hook in gameplay code
    if (local) {
      const n = local.B.wasN;
      if (n && !a.wasN && this.clock - a.nitroT > REPLAY.nitroGap) { a.nitroT = this.clock; this.mark(local, 'nitro', 'NITRO'); }
      a.wasN = n;
      if (local.race.lap > a.lap && local.race.lap > 1) this.mark(local, 'lap', `LAP ${local.race.lap}`);
      a.lap = local.race.lap;
      if (local.race.finished && !a.finished) this.mark(local, 'finish', 'FINISH');
      a.finished = local.race.finished;
    }
  }

  /** A key moment for the event list (crash/trick hooks live in Player). */
  mark(p: Player | null, kind: ReplayEventKind, label = '', pts = 0) {
    if (this.frozen) return;
    const i = this.evHead, a = p ? this.keyed.get(p) : undefined;
    this.evT[i] = this.clock;
    this.evKind[i] = KINDS.indexOf(kind);
    this.evActor[i] = a ? a.index : -1;
    this.evLabel[i] = label;
    this.evHead = (i + 1) % REPLAY.maxEvents;
    this.evCount = Math.min(this.evCount + 1, REPLAY.maxEvents);
    this.onEvent?.(kind, p, pts);
  }

  // ---------------------------------------------------------------- reading
  /** Oldest / newest recorded time. */
  get start() { return this.count ? this.times[(this.head - this.count + this.cap) % this.cap] : 0; }
  get end() { return this.count ? this.times[(this.head - 1 + this.cap) % this.cap] : 0; }

  /** Events inside the buffer, oldest first (allocates: call when opening the replay, not per frame). */
  events() {
    const out: { t: number; kind: ReplayEventKind; actor: number; label: string }[] = [], s = this.start;
    for (let k = 0; k < this.evCount; k++) {
      const i = (this.evHead - this.evCount + k + REPLAY.maxEvents) % REPLAY.maxEvents;
      if (this.evT[i] >= s) out.push({ t: this.evT[i], kind: KINDS[this.evKind[i]], actor: this.evActor[i], label: this.evLabel[i] });
    }
    return out;
  }

  /** Ring slot and blend factor for time t (binary search over the ring in time order). */
  private locate(t: number, out: { a: number; b: number; f: number }) {
    const n = this.count, base = (this.head - n + this.cap) % this.cap;
    let lo = 0, hi = n - 1;
    if (t <= this.times[base]) { out.a = out.b = base; out.f = 0; return; }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[(base + mid) % this.cap] <= t) lo = mid; else hi = mid;
    }
    const a = (base + lo) % this.cap, b = (base + hi) % this.cap, ta = this.times[a], tb = this.times[b];
    out.a = a; out.b = b; out.f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
  }

  /** Interpolated pose of one actor (no allocation). */
  pose(actor: ReplayActor, t: number, out: ActorPose) {
    out.present = false;
    if (!this.count) return out;
    this.locate(t, this.loc);
    const { a, b, f } = this.loc, B = actor.buf, oa = a * STRIDE, ob = b * STRIDE;
    const fa = B[oa + 9], fb = B[ob + 9];
    if (!(fa & F_PRESENT)) return out;
    const blend = fb & F_PRESENT && Math.hypot(B[ob] - B[oa], B[ob + 2] - B[oa + 2]) < 30 ? f : 0;
    out.present = true;
    out.x = lerp(B[oa], B[ob], blend); out.y = lerp(B[oa + 1], B[ob + 1], blend); out.z = lerp(B[oa + 2], B[ob + 2], blend);
    this.qa.set(B[oa + 3], B[oa + 4], B[oa + 5], B[oa + 6]);
    this.qb.set(B[ob + 3], B[ob + 4], B[ob + 5], B[ob + 6]);
    out.q.copy(this.qa).slerp(this.qb, blend);
    out.speed = lerp(B[oa + 14], B[ob + 14], blend);
    out.kind = actor.bike.kind === 'car' ? 'car' : 'bike';
    // heading from the quaternion's forward (+Z) vector
    const qx = out.q.x, qy = out.q.y, qz = out.q.z, qw = out.q.w;
    out.yaw = Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));
    // when walking, the camera follows the rider instead of the parked vehicle
    if (!(fa & F_SEATED) && actor.rider) { out.x = lerp(B[oa + 10], B[ob + 10], blend); out.y = lerp(B[oa + 11], B[ob + 11], blend); out.z = lerp(B[oa + 12], B[ob + 12], blend); out.yaw = B[oa + 13]; }
    return out;
  }

  // ---------------------------------------------------------------- playback
  /** Build puppets once (first replay) and add them to the scene, hidden. */
  open() {
    this.frozen = true;
    for (const a of this.actors) {
      if (!a.puppet) {
        const bike = buildVehicleModel(a.vehicle, a.color);
        if (a.extra) { // traffic: body lights only, like the live cars (a dozen spotlights would blow the light budget)
          bike.headlight.parent?.remove(bike.headlight);
          bike.headlight.target.parent?.remove(bike.headlight.target);
        }
        let rider: RiderModel | null = null;
        if (a.rider) { rider = buildRider(a.color); seatRider(rider, bike); }
        bike.root.visible = false;
        a.puppet = { bike, rider };
      }
      this.game.scene.add(a.puppet.bike.root);
    }
  }

  close() {
    for (const a of this.actors) {
      if (!a.puppet) continue;
      this.game.scene.remove(a.puppet.bike.root);
      if (a.puppet.rider) this.game.scene.remove(a.puppet.rider.root);
    }
    this.frozen = false;
  }

  /** Pose every puppet at time t and hide the live models; call unpose() right after rendering. */
  apply(t: number) {
    if (!this.count) return;
    this.locate(t, this.loc);
    const { a, b, f } = this.loc, g = this.game;
    for (const act of this.actors) {
      for (let k = 0; k < 3; k++) { const o = liveObj(act, k); act.hidden[k] = o?.visible ? 1 : 0; if (o) o.visible = false; }
      const pp = act.puppet;
      if (!pp) continue;
      const B = act.buf, oa = a * STRIDE, ob = b * STRIDE, fa = B[oa + 9], fb = B[ob + 9], M = pp.bike;
      if (!(fa & F_PRESENT)) { M.root.visible = false; if (pp.rider) pp.rider.root.visible = false; continue; }
      const blend = fb & F_PRESENT && Math.hypot(B[ob] - B[oa], B[ob + 2] - B[oa + 2]) < 30 ? f : 0;
      M.root.visible = !!(fa & F_BIKE);
      M.root.position.set(lerp(B[oa], B[ob], blend), lerp(B[oa + 1], B[ob + 1], blend), lerp(B[oa + 2], B[ob + 2], blend));
      this.qa.set(B[oa + 3], B[oa + 4], B[oa + 5], B[oa + 6]);
      this.qb.set(B[ob + 3], B[ob + 4], B[ob + 5], B[ob + 6]);
      M.root.quaternion.copy(this.qa).slerp(this.qb, blend);
      const wheel = lerp(B[oa + 7], B[ob + 7], blend), steer = lerp(B[oa + 8], B[ob + 8], blend);
      for (const w of M.wheels) w.rotation.x = wheel;
      for (const w of M.steer) w.rotation.y = steer;
      M.flame.scale.y = fa & F_BOOST ? 1.6 + Math.random() * 0.8 : 0.01;
      M.headlight.intensity = g.env.night * 2.4;
      if (M.driver) M.driver.visible = !!(fa & F_DRIVER);
      const r = pp.rider;
      if (r) {
        const seated = !!(fa & F_SEATED);
        if (seated && r.root.parent !== M.seat) seatRider(r, M);
        else if (!seated) {
          if (r.root.parent !== g.scene) {
            g.scene.add(r.root);
            r.helmet.visible = false;
            r.hair.visible = true;
            r.torso.rotation.x = 0;
            r.legL.rotation.set(0, 0, 0); r.legR.rotation.set(0, 0, 0); r.armL.rotation.set(0, 0, 0); r.armR.rotation.set(0, 0, 0);
          }
          r.root.position.set(lerp(B[oa + 10], B[ob + 10], blend), lerp(B[oa + 11], B[ob + 11], blend), lerp(B[oa + 12], B[ob + 12], blend));
          r.root.rotation.set(0, B[oa + 13], 0);
        }
        r.root.visible = !!(fa & F_RIDER);
      }
    }
  }

  /** Give the live models their visibility back (after the replay frame rendered). */
  unpose() {
    for (const act of this.actors) {
      for (let k = 0; k < 3; k++) { const o = liveObj(act, k); if (o) o.visible = act.hidden[k] === 1; }
      if (act.puppet) { act.puppet.bike.root.visible = false; if (act.puppet.rider) act.puppet.rider.root.visible = false; }
    }
  }
}

/** The live objects a replay frame hides: vehicle, rider, name tag. */
const liveObj = (a: ReplayActor, k: number): THREE.Object3D | null | undefined => (k === 0 ? a.bike.root : k === 1 ? a.rider?.root : a.tag);
