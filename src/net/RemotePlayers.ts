// Other online riders: bike + rider models with name tags, smoothly interpolated ~120 ms behind real time.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { NetState, PlayerInfo } from '../../shared/protocol';
import { buildRider, nameTag, seatRider, type RiderModel } from '../entities/models';
import { buildVehicleModel, type VehicleModel } from '../entities/vehicleModels';
import { vehicleById } from '../data/vehicles';
import { NET } from '../config';
import { lerp, lerpAngle } from '../utils/math';

export interface Remote {
  id: string; name: string; color: number;
  bike: VehicleModel; rider: RiderModel; tag: THREE.Sprite; vehicle: string;
  buf: { t: number; s: NetState }[];
  state: NetState | null;
  seated: boolean;
  x: number; y: number; z: number; // displayed position (for minimap / hit tests)
  wheel: number;
  /** Connection dropped (slot held by the room for a while). */
  away: boolean;
  /** Quick-chat emote bubble above the name tag, built on first use. */
  bubble: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; t: number } | null;
}

const BUBBLE_TIME = 3.5;

export class RemotePlayers {
  private map = new Map<string, Remote>();

  constructor(private game: Game) {}

  sync(players: PlayerInfo[], selfId: string) {
    const ids = new Set(players.filter((p) => p.id !== selfId).map((p) => p.id));
    for (const [id, r] of this.map) if (!ids.has(id)) { this.removeModels(r); this.map.delete(id); }
    for (const p of players) {
      const old = this.map.get(p.id);
      if (old && (old.name !== p.name || old.color !== p.color || old.vehicle !== p.vehicle)) { this.removeModels(old); this.map.delete(p.id); } // renamed / recoloured
      const kept = this.map.get(p.id);
      if (kept) kept.away = !!p.away;
      if (p.id === selfId || kept) continue;
      const def = vehicleById(p.vehicle), bike = buildVehicleModel(def.id, p.color), rider = buildRider(p.color), tag = nameTag(p.name, p.color);
      seatRider(rider, bike);
      rider.root.visible = def.kind === 'bike';
      bike.root.visible = false;
      tag.visible = false; // until the first snapshot places it
      this.game.scene.add(bike.root, tag);
      this.map.set(p.id, { id: p.id, name: p.name, color: p.color, vehicle: p.vehicle, bike, rider, tag, buf: [], state: null, seated: true, x: 0, y: -999, z: 0, wheel: 0, away: !!p.away, bubble: null });
    }
  }

  push(id: string, s: NetState) {
    const r = this.map.get(id);
    if (!r) return;
    r.buf.push({ t: performance.now() / 1000, s });
    if (r.buf.length > 20) r.buf.shift();
    r.state = s;
  }

  /** Show a short emote bubble above a rider's name tag. */
  emote(id: string, text: string) {
    const r = this.map.get(id);
    if (!r) return;
    if (!r.bubble) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      sprite.scale.set(4, 1, 1);
      this.game.scene.add(sprite);
      r.bubble = { sprite, canvas, tex, t: 0 };
    }
    const b = r.bubble, g = b.canvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold 30px system-ui, sans-serif';
    const w = Math.min(248, g.measureText(text).width + 30);
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 6, w, 46, 16);
    g.fill();
    g.fillStyle = '#10131f';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 30, 230);
    b.tex.needsUpdate = true;
    b.t = BUBBLE_TIME;
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
      r.bike.root.visible = !s.dead && !r.away;
      r.bike.root.position.set(bx, by, bz);
      r.bike.root.rotation.set(lerp(a.bp, s.bp, f), lerpAngle(a.bh, s.bh, f), lerp(a.bl, s.bl, f));
      r.wheel += (s.v * dt) / r.bike.wheelRadius;
      r.bike.wheels.forEach((w) => (w.rotation.x = r.wheel));
      r.bike.flame.scale.y = s.boost > 0.1 ? 1.4 + Math.random() : 0.01;
      if (s.riding !== r.seated) {
        r.seated = s.riding;
        if (s.riding) { seatRider(r.rider, r.bike); r.rider.root.visible = r.bike.kind === 'bike'; }
        else {
          this.game.scene.add(r.rider.root);
          r.rider.root.visible = true;
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
      r.tag.visible = !s.dead && !r.away;
      if (r.bubble) {
        const bb = r.bubble;
        bb.t -= dt;
        bb.sprite.visible = bb.t > 0 && r.tag.visible;
        bb.sprite.position.set(r.x, r.y + 4.4 + Math.max(0, bb.t - BUBBLE_TIME + 0.25) * 2, r.z);
        (bb.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, bb.t / 0.5);
      }
    }
  }

  private removeModels(r: Remote) {
    this.game.scene.remove(r.bike.root, r.rider.root, r.tag);
    if (r.bubble) {
      this.game.scene.remove(r.bubble.sprite);
      r.bubble.tex.dispose();
      (r.bubble.sprite.material as THREE.SpriteMaterial).dispose();
    }
  }

  dispose() {
    this.map.forEach((r) => this.removeModels(r));
    this.map.clear();
  }
}
