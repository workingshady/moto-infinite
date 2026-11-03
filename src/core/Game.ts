// Owns one play session: builds the world for the chosen mode, runs the loop and renders 1 or 2 viewports.
import * as THREE from 'three';
import { Renderer } from './Renderer';
import { DynamicResolution } from './DynamicRes';
import { Events } from './Events';
import type { Audio } from './Audio';
import type { Controller, Input } from './Input';
import { activeWeathers, type FixedWeather, type GameMode, type TimeOfDay, type Weather, type WorldGen, type WorldTheme } from '../../shared/protocol';
import type { NetClient } from '../net/NetClient';
import type { ChallengeId } from '../data/challenges';
import { Noise } from '../utils/noise';
import { Circuit, GridRoads, type Pose, type RoadLayout } from '../world/layout';
import { DriftTrack, type DriftTrackId } from '../world/DriftTrack';
import { F1Track, F1_TRACKS, type F1TrackId } from '../world/F1Track';
import { AiRacers } from '../systems/AiRacers';
import type { TyreCompound } from '../config';
import { Terrain } from '../world/Terrain';
import { ChunkManager } from '../world/Chunks';
import { buildThrusterWall } from '../world/Landmarks';
import { Environment } from '../world/Environment';
import { EntityManager } from '../entities/EntityManager';
import { Player } from '../entities/Player';
import { Particles } from '../systems/Particles';
import { Effects } from '../systems/Effects';
import { Combat } from '../systems/Combat';
import { Race, type Standing } from '../systems/Race';
import { RemotePlayers } from '../net/RemotePlayers';
import { Spectator } from '../net/Spectate';
import { Tutorial } from '../systems/Tutorial';
import { CareerTracker } from '../systems/CareerTracker';
import { Replay } from '../systems/Replay';
import { GEN, LEVELING, NET, PHYS, QUALITY, TRACKS, WORLD, type QualityName } from '../config';
import { STORY } from '../data/story';
import { createModes, type ModeFeature } from '../modes';
import type { RaceVariant } from '../../shared/protocol';
import { skipFrame } from './settings';
import { feelUpdate, stopRumble } from './rumble';

export interface LocalPlayerSpec { name: string; color: number; controller: Controller; vehicle: string }

export interface SessionOptions {
  mode: GameMode;
  seed: number;
  trackId: string;
  laps: number;
  pvp: boolean;
  time: TimeOfDay;
  weather: Weather;
  /** Several weathers layered together (see activeWeathers). */
  weathers?: FixedWeather[];
  theme: WorldTheme;
  gen: WorldGen;
  /** Enemy drone amount, index into DRONE_LEVELS. */
  drones: number;
  /** Computer opponents in races (local only). */
  ai?: number;
  /** F1 session and starting tyre. */
  session?: 'race' | 'quali';
  tyre?: TyreCompound;
  /** Guided training ride for new players. */
  tutorial?: boolean;
  quality: QualityName;
  locals: LocalPlayerSpec[];
  net: NetClient | null;
  /** Menu background: world only, orbiting camera, no players. */
  attract?: boolean;
  /** Race format and open-world traffic (src/modes). */
  variant?: RaceVariant;
  traffic?: number;
  /** Ghost lap to race instead of your own best (leaderboard "race the #1 ghost"). */
  ghost?: { time: number; s: number[] };
}

/** Replay / photo mode: takes over rendering (one full-screen view) while set. */
export interface ViewOverride { render(dt: number): void }

export interface GameHooks {
  onRaceResults(rows: Standing[]): void;
  /** A recorded flying lap of the solo player (time + ghost samples), for the leaderboards. */
  onLap?(time: number, samples: number[]): void;
}

export interface GameEvents {
  progress: { player: Player; id: ChallengeId; value: number };
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly dynRes: DynamicResolution;
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
  ai: AiRacers | null = null;
  tutorial: Tutorial | null = null;
  career: CareerTracker | null = null;
  /** Extra game modes / systems from src/modes (time attack, elimination, traffic). */
  modes: ModeFeature[] = [];
  remotes: RemotePlayers | null = null;
  replay: Replay | null = null;
  view: ViewOverride | null = null;
  spectator: Spectator | null = null;
  time = 0;
  frame = 0;
  paused = false;
  private raf = 0;
  private last = 0;
  private netT = 0;
  private attractCam: THREE.PerspectiveCamera | null = null;
  private aiCount = 0;
  private offs: (() => void)[] = [];
  private onResize = () => this.resize();

  constructor(readonly opts: SessionOptions, readonly input: Input, readonly audio: Audio, readonly hooks: GameHooks) {
    this.net = opts.net;
    const noise = new Noise(opts.seed);
    this.layout = opts.mode === 'race' ? new Circuit(noise, opts.seed)
      : opts.mode === 'drift' ? new DriftTrack(noise, opts.trackId as DriftTrackId, opts.seed)
      : opts.mode === 'f1' ? new F1Track(noise, opts.trackId as F1TrackId)
      : new GridRoads(noise, opts.seed, opts.gen.roads, GEN.poi[opts.gen.poi].chance);
    this.terrain = new Terrain(noise, this.layout, opts.theme, opts.gen);
    this.renderer = new Renderer(opts.quality, document.body);
    this.dynRes = new DynamicResolution(this.renderer);
    input.attachCanvas(this.renderer.gl.domElement);
    this.hudLayer = document.createElement('div');
    this.hudLayer.id = 'hud-layer';
    document.body.appendChild(this.hudLayer);
    this.env = new Environment(this.scene, opts.quality, opts.time, activeWeathers(opts));
    this.env.onThunder = () => audio.play('thunder');
    this.fx = new Particles(this.scene);
    this.fx.amount = QUALITY[opts.quality].particles;
    this.effects = new Effects(this.scene, this.terrain);
    this.entities = new EntityManager(this);
    this.combat = new Combat(this);
    this.chunks = new ChunkManager(this);

    const aiCount = opts.attract || opts.net || opts.session === 'quali' || (opts.mode !== 'race' && opts.mode !== 'f1') ? 0 : opts.ai ?? 0;
    this.aiCount = aiCount;
    const count = opts.attract ? 0 : opts.locals.length + (this.net ? this.netSlot() : 0) + aiCount;
    this.spawnPoints = Array.from({ length: Math.max(1, count) }, (_, i) => this.layout.spawn(i));
    this.events.on('progress', (e) => e.player.challenges?.notify(e.id, e.value));

    // thruster demo wall beside the road ahead of the open-world spawn (same for every client: seed-derived pose)
    if (opts.mode === 'open' && !opts.attract && !opts.tutorial) buildThrusterWall(this, this.spawnPoints[0]);
    // build the area around the start before the first frame (hidden behind the loading screen)
    this.chunks.stream(opts.attract ? [this.spawnPoints[0]] : this.spawnPoints.slice(0, Math.max(1, opts.locals.length)), 999);

    if (opts.attract) {
      this.attractCam = new THREE.PerspectiveCamera(55, 1, 0.3, 900);
    } else {
      const first = this.net ? this.netSlot() : Math.floor(this.aiCount / 2); // start mid-grid when racing the AI
      opts.locals.forEach((l, i) => this.players.push(new Player(this, i, l.controller, l.name, l.color, this.spawnPoints[first + i], opts.mode !== 'open' || opts.locals.length > 1 || !!this.net, l.vehicle)));
      if (opts.mode === 'f1') this.players.forEach((p) => p.setTyres(opts.tyre ?? 'medium'));
      if (this.aiCount && (this.layout instanceof Circuit || this.layout instanceof F1Track)) {
        // AI take every grid slot the local players don't use
        this.ai = new AiRacers(this, this.layout, this.aiCount, opts.mode === 'f1', this.layout instanceof F1Track ? this.layout.halfWidth : 7, opts.laps, 0);
        const used = new Set(this.players.map((_, i) => first + i));
        let slot = 0;
        for (const r of this.ai.list) { while (used.has(slot)) slot++; this.ai.place(r, slot++); }
      }
      if ((opts.mode === 'race' && this.layout instanceof Circuit) || (opts.mode === 'f1' && this.layout instanceof F1Track)) this.race = new Race(this, this.layout, opts.laps, opts.trackId);
      if (this.net) this.wireNet(this.net);
      if (opts.tutorial) this.tutorial = new Tutorial(this);
      this.career = new CareerTracker(this);
      this.modes = createModes(this);
      this.replay = new Replay(this);
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
    this.spectator = new Spectator(this);
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
    const beat = this.opts.tutorial ? { title: 'TRAINING RIDE', text: 'Follow the checklist on the right. Each step teaches one skill.' }
      : this.opts.mode === 'drift' ? { title: 'DRIFT SESSION', text: 'Hold X (handbrake) into corners, steer against the slide to hold the angle. Chain drifts for a bigger multiplier.' }
      : this.opts.mode === 'f1' ? { title: `GRAND PRIX · ${(F1_TRACKS.find((t) => t.id === this.opts.trackId)?.name ?? '').toUpperCase()}`, text: this.opts.session === 'quali' ? 'Time trial: set your fastest lap, beat your ghost.' : `${this.opts.laps} laps · wait for the five red lights to go out. Pit for fresh tyres when they wear.` }
      : this.opts.mode === 'open' ? STORY.spawn : { title: `${STORY.race.title} · ${(track?.name ?? 'RANDOM').toUpperCase()}`, text: `${this.opts.laps} lap${this.opts.laps > 1 ? 's' : ''}. ${STORY.race.text}` };
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
    if (on) stopRumble();
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
    if (document.hidden) { this.last = now; return; } // background tab: no simulation, no rendering
    if (skipFrame(now, this.last)) return; // frame-rate cap (Settings)
    this.dynRes.frame(now - this.last);
    const dt = Math.min(Math.max((now - this.last) / 1000, 0.001), PHYS.maxDt);
    this.last = now;
    this.frame++;
    if (!this.opts.attract && !this.view) {
      this.input.poll();
      for (const p of this.players) p.handleInput();
    }
    for (const p of this.players) p.tickCards(dt);
    if (!this.paused) this.update(dt * this.timeScale);
    if (this.input.enabled && !this.paused) feelUpdate(this.players, dt); // controller rumble / phone vibration
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
    this.career?.update(dt);
    for (const m of this.modes) m.update(dt);
    this.remotes?.update(dt);
    this.spectator?.update();
    this.updateMusic();
    this.replay?.record(dt);
    const focus = this.players.length ? this.players.map((p) => p.P) : [this.attractFocus()];
    const watched = this.spectator?.focus();
    if (watched) focus.push(watched);
    this.chunks.stream(focus, this.opts.mode === 'f1' ? 2 : WORLD.buildsPerFrame); // F1 speeds need chunks ready sooner
    this.env.update(dt, this.time, focus[0].x, focus[0].z);
    if (this.net && this.players[0]) {
      this.netT -= dt;
      if (this.netT <= 0) {
        this.netT = 1 / NET.sendHz;
        this.net.send({ t: 'state', s: this.players[0].netState() });
      }
    }
  }

  /** Soundtrack layers follow the action: riding, fast/drifting, and fights or final laps. */
  private updateMusic() {
    const m = this.audio.music, p = this.players[0];
    if (!m || this.opts.attract || !p) return;
    const fast = Math.abs(p.B.v) * 3.6 > 110 || p.drift.on || p.cam.boost > 0.5;
    const action = this.entities.list.some((e) => e.alive && e.engaged) || (!!this.race && p.race.lap === this.race.laps && !p.race.finished);
    m.setIntensity(!p.riding ? 1 : action ? 3 : fast ? 2 : 1);
  }

  private attractFocus() {
    const s = this.spawnPoints[0];
    return { x: s.x + Math.sin(this.time * 0.02) * 60, z: s.z + this.time * 4 };
  }

  private render(dt: number) {
    const r = this.renderer;
    if (this.view) return this.view.render(dt);
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
      if (i === 0) this.spectator?.apply(p.camera, dt);
      this.env.beforeRender(p.P.x, p.P.y, p.P.z, p.camera, r.pixelHeight(vp));
      this.fx.setScale(r.pixelHeight(vp));
      r.render(this.scene, p.camera, vp, split);
      p.hud.update(dt, this.frame);
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    stopRumble();
    this.audio.music?.setIntensity(0); // back to calm menu music
    removeEventListener('resize', this.onResize);
    this.offs.forEach((off) => off());
    this.career?.dispose();
    this.players.forEach((p) => p.dispose());
    this.remotes?.dispose();
    this.ai?.dispose();
    this.modes.forEach((m) => m.dispose());
    this.events.clear();
    this.renderer.dispose();
    this.hudLayer.remove();
    this.input.enabled = false;
    this.input.reset();
  }
}
