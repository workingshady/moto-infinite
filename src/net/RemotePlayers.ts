// Other online riders: bike + rider models with name tags, smoothly interpolated ~120 ms behind real time.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { NetState, PlayerInfo } from '../../shared/protocol';
import { buildBike, buildRider, nameTag, seatRider, type BikeModel, type RiderModel } from '../entities/models';
import { NET } from '../config';
import { lerp, lerpAngle } from '../utils/math';

export interface Remote {
  id: string; name: string; color: number;
  bike: BikeModel; rider: RiderModel; tag: THREE.Sprite;
  buf: { t: number; s: NetState }[];
  state: NetState | null;
  seated: boolean;
  x: number; y: number; z: number; // displayed position (for minimap / hit tests)
  wheel: number;
}

export class RemotePlayers {
  private map = new Map<string, Remote>();

  constructor(private game: Game) {}

  sync(players: PlayerInfo[], selfId: string) {
    const ids = new Set(players.filter((p) => p.id !== selfId).map((p) => p.id));
    for (const [id, r] of this.map) if (!ids.has(id)) { this.removeModels(r); this.map.delete(id); }
    for (const p of players) {
      if (p.id === selfId || this.map.has(p.id)) continue;
      const bike = buildBike(p.color), rider = buildRider(p.color), tag = nameTag(p.name, p.color);
      seatRider(rider, bike);
      bike.root.visible = false;
      this.game.scene.add(bike.root, tag);
      this.map.set(p.id, { id: p.id, name: p.name, color: p.color, bike, rider, tag, buf: [], state: null, seated: true, x: 0, y: -999, z: 0, wheel: 0 });
    }
  }

  push(id: string, s: NetState) {
    const r = this.map.get(id);
    if (!r) return;
    r.buf.push({ t: performance.now() / 1000, s });
    if (r.buf.length > 20) r.buf.shift();
    r.state = s;
  }

  forEach(fn: (r: Remote) => void) {
    this.map.forEach(fn);
  }

  update(dt: number) {
    const now = performance.now() / 1000 - NET.interpDelay;
    for (const r of this.map.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > now) i--;
      const A = b[Math.max(0, i - 1)], Bs = b[i];
      const f = Bs.t === A.t ? 1 : Math.max(0, Math.min(1, (now - A.t) / (Bs.t - A.t)));
      const a = A.s, s = Bs.s;
      const bx = lerp(a.bx, s.bx, f), by = lerp(a.by, s.by, f), bz = lerp(a.bz, s.bz, f);
      r.bike.root.visible = !s.dead;
      r.bike.root.position.set(bx, by, bz);
      r.bike.root.rotation.set(lerp(a.bp, s.bp, f), lerpAngle(a.bh, s.bh, f), lerp(a.bl, s.bl, f));
      r.wheel += (s.v * dt) / 0.62;
      r.bike.wheels.forEach((w) => (w.rotation.x = r.wheel));
      r.bike.flame.scale.y = s.boost > 0.1 ? 1.4 + Math.random() : 0.01;
      if (s.riding !== r.seated) {
        r.seated = s.riding;
        if (s.riding) seatRider(r.rider, r.bike);
        else {
          this.game.scene.add(r.rider.root);
          r.rider.helmet.visible = false;
          r.rider.hair.visible = true;
          r.rider.torso.rotation.x = 0;
          [r.rider.legL, r.rider.legR, r.rider.armL, r.rider.armR].forEach((l) => l.rotation.set(0, 0, 0));
        }
      }
      if (!s.riding) {
        r.rider.root.position.set(lerp(a.wx, s.wx, f), lerp(a.wy, s.wy, f), lerp(a.wz, s.wz, f));
        r.rider.root.rotation.set(0, lerpAngle(a.wh, s.wh, f), 0);
        r.x = r.rider.root.position.x; r.y = r.rider.root.position.y; r.z = r.rider.root.position.z;
      } else { r.x = bx; r.y = by; r.z = bz; }
      r.tag.position.set(r.x, r.y + 3.4, r.z);
      r.tag.visible = !s.dead;
    }
  }

  private removeModels(r: Remote) {
    this.game.scene.remove(r.bike.root, r.rider.root, r.tag);
  }

  dispose() {
    this.map.forEach((r) => this.removeModels(r));
    this.map.clear();
  }
}
