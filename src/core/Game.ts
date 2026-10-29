// Owns one play session: builds the world for the chosen mode, runs the loop and renders 1 or 2 viewports.
import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Events } from './Events';
import type { Audio } from './Audio';
import type { Controller, Input } from './Input';
import type { GameMode, TimeOfDay, Weather, WorldGen, WorldTheme } from '../../shared/protocol';
import type { NetClient } from '../net/NetClient';
import type { ChallengeId } from '../data/challenges';
import { Noise } from '../utils/noise';
import { Circuit, GridRoads, type Pose, type RoadLayout } from '../world/layout';
import { Terrain } from '../world/Terrain';
import { ChunkManager } from '../world/Chunks';
import { Environment } from '../world/Environment';
import { EntityManager } from '../entities/EntityManager';
import { Player } from '../entities/Player';
import { Particles } from '../systems/Particles';
import { Effects } from '../systems/Effects';
import { Combat } from '../systems/Combat';
import { Race, type Standing } from '../systems/Race';
import { RemotePlayers } from '../net/RemotePlayers';
import { Tutorial } from '../systems/Tutorial';
import { GEN, LEVELING, NET, PHYS, QUALITY, TRACKS, WORLD, type QualityName } from '../config';
import { STORY } from '../data/story';

export interface LocalPlayerSpec { name: string; color: number; controller: Controller }

export interface SessionOptions {
  mode: GameMode;
  seed: number;
  trackId: string;
  laps: number;
  pvp: boolean;
  time: TimeOfDay;
  weather: Weather;
  theme: WorldTheme;
  gen: WorldGen;
  /** Guided training ride for new players. */
  tutorial?: boolean;
  quality: QualityName;
  locals: LocalPlayerSpec[];
  net: NetClient | null;
  /** Menu background: world only, orbiting camera, no players. */
  attract?: boolean;
}

export interface GameHooks {
  onRaceResults(rows: Standing[]): void;
}

export interface GameEvents {
  progress: { player: Player; id: ChallengeId; value: number };
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly env: Environment;
  readonly layout: RoadLayout;
  readonly terrain: Terrain;
  readonly chunks: ChunkManager;
  readonly entities: EntityManager;
  readonly fx: Particles;
  readonly effects: Effects;
  readonly combat: Combat;
  readonly events = new Events<GameEvents>();
  readonly players: Player[] = [];
  readonly spawnPoints: Pose[];
  readonly hudLayer: HTMLDivElement;
  readonly net: NetClient | null;
  race: Race | null = null;
  tutorial: Tutorial | null = null;
  remotes: RemotePlayers | null = null;
  time = 0;
  frame = 0;
  paused = false;
  private raf = 0;
  private last = 0;
  private netT = 0;
  private attractCam: THREE.PerspectiveCamera | null = null;
  private offs: (() => void)[] = [];
  private onResize = () => this.resize();

  constructor(readonly opts: SessionOptions, readonly input: Input, readonly audio: Audio, readonly hooks: GameHooks) {
    this.net = opts.net;
    const noise = new Noise(opts.seed);
    this.layout = opts.mode === 'race' ? new Circuit(noise, opts.seed) : new GridRoads(noise, opts.seed, opts.gen.roads, GEN.poi[opts.gen.poi].chance);
    this.terrain = new Terrain(noise, this.layout, opts.theme, opts.gen);
    this.renderer = new Renderer(opts.quality, document.body);
    input.attachCanvas(this.renderer.gl.domElement);
    this.hudLayer = document.createElement('div');
    this.hudLayer.id = 'hud-layer';
    document.body.appendChild(this.hudLayer);
    this.env = new Environment(this.scene, opts.quality, opts.time, opts.weather);
    this.env.onThunder = () => audio.play('thunder');
    this.fx = new Particles(this.scene);
    this.fx.amount = QUALITY[opts.quality].particles;
    this.effects = new Effects(this.scene, this.terrain);
    this.entities = new EntityManager(this);
    this.combat = new Combat(this);
    this.chunks = new ChunkManager(this);

    const count = opts.attract ? 0 : opts.locals.length + (this.net ? this.netSlot() : 0);
    this.spawnPoints = Array.from({ length: Math.max(1, count) }, (_, i) => this.layout.spawn(i));
    this.events.on('progress', (e) => e.player.challenges?.notify(e.id, e.value));

    // build the area around the start before the first frame (hidden behind the loading screen)
    this.chunks.stream(opts.attract ? [this.spawnPoints[0]] : this.spawnPoints.slice(0, Math.max(1, opts.locals.length)), 999);

    if (opts.attract) {
      this.attractCam = new THREE.PerspectiveCamera(55, 1, 0.3, 900);
    } else {
      const first = this.net ? this.netSlot() : 0;
      opts.locals.forEach((l, i) => this.players.push(new Player(this, i, l.controller, l.name, l.color, this.spawnPoints[first + i], opts.mode === 'race' || opts.locals.length > 1 || !!this.net)));
      if (opts.mode === 'race' && this.layout instanceof Circuit) this.race = new Race(this, this.layout, opts.laps, opts.trackId);
      if (this.net) this.wireNet(this.net);
      if (opts.tutorial) this.tutorial = new Tutorial(this);
    }
    addEventListener('resize', this.onResize);
    this.resize();
  }

  /** Online: everyone spawns in their own grid slot, ordered by join order. */
  private netSlot() {
    const n = this.net!;
    return Math.max(0, n.players.findIndex((p) => p.id === n.id));
  }

  private wireNet(n: NetClient) {
    this.remotes = new RemotePlayers(this);
    this.remotes.sync(n.players, n.id);
    const ev = n.events;
    this.offs.push(
      ev.on('players', (m) => this.remotes?.sync(m.players, n.id)),
      ev.on('state', (m) => this.remotes?.push(m.id, m.s)),
      ev.on('fire', (m) => this.combat.fireRemote(m.id, m.w, m.o, m.d)),
      ev.on('boom', (m) => this.combat.explode(m.p[0], m.p[1], m.p[2], Math.min(m.r, 10), Math.min(m.dmg, 80), null, m.id, 0.8, null, false)),
      ev.on('finish', (m) => this.race?.remoteFinish.set(m.id, m.time)),
    );
  }

  start() {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    if (this.opts.attract) return;
    const track = TRACKS.find((t) => t.id === this.opts.trackId);
    const beat = this.opts.tutorial ? { title: 'TRAINING RIDE', text: 'Follow the checklist on the right. Each step teaches one skill.' } : this.opts.mode === 'open' ? STORY.spawn : { title: `${STORY.race.title} · ${(track?.name ?? 'RANDOM').toUpperCase()}`, text: `${this.opts.laps} lap${this.opts.laps > 1 ? 's' : ''}. ${STORY.race.text}` };
    setTimeout(() => this.players.forEach((p) => p.storyBeat(beat.title, beat.text)), 700);
  }

  /** Time multiplier: solo games go slow-motion while level-up cards are open (never a hard freeze). */
  timeScale = 1;
  onCardsChanged() {
    const solo = this.players.length === 1 && !this.net;
    this.timeScale = solo && this.players[0].cardsOpen ? LEVELING.slowmo : 1;
  }

  setMenuPaused(on: boolean) {
    this.input.enabled = !on && !this.opts.attract;
    if (this.net) return; // online games keep running behind the menu
    this.paused = on;
  }

  nearestPlayer(x: number, z: number, aliveOnly = false): Player | null {
    let best: Player | null = null, bd = 1e18;
    for (const p of this.players) {
      if (aliveOnly && p.s.dead) continue;
      const d = (p.P.x - x) ** 2 + (p.P.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  setQuality(q: QualityName) {
    this.renderer.apply(q);
    this.env.setQuality(q);
    this.chunks.view = QUALITY[q].view;
    this.fx.amount = QUALITY[q].particles;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    this.resize();
  }

  private resize() {
    this.renderer.resize(Math.max(1, this.players.length));
    const split = this.players.length > 1;
    this.players.forEach((p, i) => p.hud.setRect(this.renderer.viewports[i], split));
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(Math.max((now - this.last) / 1000, 0.001), PHYS.maxDt);
    this.last = now;
    this.frame++;
    if (!this.opts.attract) {
      this.input.poll();
      for (const p of this.players) p.handleInput();
    }
    for (const p of this.players) p.tickCards(dt);
    if (!this.paused) this.update(dt * this.timeScale);
    this.render(dt);
  };

  private update(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / PHYS.maxSubstep)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.time += h;
      for (const p of this.players) p.update(h);
      this.entities.update(h);
      this.combat.update(h);
    }
    for (const pd of this.terrain.pads) pd.cd -= dt;
    this.chunks.animate(dt);
    for (const p of this.players) p.checkZones(this.chunks.zones, dt);
    this.fx.update(dt);
    this.effects.update(dt);
    if (!this.tutorial || this.tutorial.complete) for (const p of this.players) p.challenges?.update(dt);
    this.tutorial?.update(dt);
    this.race?.update(dt);
    this.remotes?.update(dt);
    const focus = this.players.length ? this.players.map((p) => p.P) : [this.attractFocus()];
    this.chunks.stream(focus, WORLD.buildsPerFrame);
    this.env.update(dt, this.time, focus[0].x, focus[0].z);
    if (this.net && this.players[0]) {
      this.netT -= dt;
      if (this.netT <= 0) {
        this.netT = 1 / NET.sendHz;
        this.net.send({ t: 'state', s: this.players[0].netState() });
      }
    }
  }

  private attractFocus() {
    const s = this.spawnPoints[0];
    return { x: s.x + Math.sin(this.time * 0.02) * 60, z: s.z + this.time * 4 };
  }

  private render(dt: number) {
    const r = this.renderer;
    if (this.attractCam) {
      const f = this.attractFocus(), a = this.time * 0.08, cam = this.attractCam, vp = r.viewports[0];
      const gy = this.terrain.groundAt(f.x, f.z);
      cam.position.set(f.x + Math.sin(a) * 45, Math.max(gy, 6) + 22, f.z + Math.cos(a) * 45);
      cam.lookAt(f.x, gy + 4, f.z);
      cam.aspect = vp.w / vp.h;
      cam.updateProjectionMatrix();
      this.env.beforeRender(f.x, gy, f.z, cam, r.pixelHeight(vp));
      this.fx.setScale(r.pixelHeight(vp));
      r.render(this.scene, cam, vp, false);
      return;
    }
    const split = this.players.length > 1;
    this.players.forEach((p, i) => {
      const vp = r.viewports[i];
      p.updateCamera(dt, vp.w / vp.h);
      this.env.beforeRender(p.P.x, p.P.y, p.P.z, p.camera, r.pixelHeight(vp));
      this.fx.setScale(r.pixelHeight(vp));
      r.render(this.scene, p.camera, vp, split);
      p.hud.update(dt, this.frame);
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.offs.forEach((off) => off());
    this.players.forEach((p) => p.dispose());
    this.remotes?.dispose();
    this.events.clear();
    this.renderer.dispose();
    this.hudLayer.remove();
    this.input.enabled = false;
    this.input.reset();
  }
}
