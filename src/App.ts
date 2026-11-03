// Top-level flow: menu ⇄ game sessions ⇄ online rooms. Owns the long-lived Input/Audio singletons.
import { Game, type SessionOptions } from './core/Game';
import { Input } from './core/Input';
import { Audio } from './core/Audio';
import { Menu, type Profile, type Setup } from './ui/Menu';
import { createTouch, type TouchControls } from './ui/Touch';
import { autoQuality } from './core/device';
import { NetClient, newRoomCode } from './net/NetClient';
import { SocialUI } from './ui/Social';
import { PLAYER_COLORS, QUALITY, TRACKS, type QualityName } from './config';
import { DEFAULT_GEN, ROOM_CODE_RE, type LobbySettings } from '../shared/protocol';
import type { Standing } from './systems/Race';
import { prefs } from './core/prefs';
import { DRIFT_TRACKS } from './world/DriftTrack';
import { F1_TRACKS } from './world/F1Track';
import { vehicleById } from './data/vehicles';
import { isUnlocked } from './core/career';
import { toast } from './ui/toast';
import { driftSeed } from './ui/Preview';
import { attachLeaderboards, configureLeaderboards, type LbStart } from './ui/LeaderboardPanel';
import type { LbSession } from './systems/LbSession';
import { applySettings } from './core/settings';
import { watchPads } from './core/gamepad';
import { initMenuNav } from './ui/menuNav';
import { ReplayStudio, type StudioFrom } from './ui/ReplayStudio';
import { mergeSaved, parseJson, sameShape } from './utils/store';
import { markChanged } from './core/syncBus';
import { initCloudSave } from './net/cloudSave';

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = parseJson(localStorage.getItem('moto:' + k));
      return v !== null && sameShape(v, fallback) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem('moto:' + k, JSON.stringify(v));
    } catch {
      /* not persisted */
    }
  },
};

/** A saved quality name, or the first-run guess when it is missing / unknown. */
const validQuality = (q: string): QualityName => (q in QUALITY ? (q as QualityName) : autoQuality());

export class App {
  private input = new Input();
  private audio = new Audio();
  private menu: Menu;
  game: Game | null = null;
  private net: NetClient | null = null;
  private lastLocal: Setup | null = null;
  private touch: TouchControls | null = null;
  private quality: QualityName = validQuality(store.get<string>('quality', ''));
  private studio: ReplayStudio | null = null;
  private lastRows: Standing[] = [];
  /** Leaderboard run (daily/weekly challenge, forced vehicle, #1 ghost) and the current session's board hook-up. */
  private lbStart: LbStart | null = null;
  private lb: LbSession | null = null;

  constructor() {
    const base: Profile = { name: 'Rider', color: PLAYER_COLORS[0], name2: 'Player 2', color2: PLAYER_COLORS[1], vehicle: 'street', vehicle2: 'street', f1car: 'f1_2026' };
    const profile = mergeSaved(base, store.get<unknown>('profile', {})); // damaged saves keep the defaults for the bad fields
    this.menu = new Menu(this.actions(), profile, this.quality, () => this.audio.muted);
    this.input.onUserGesture = () => this.audio.init();
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.audio.toggleMute();
    this.input.onToggleHelp = () => document.body.classList.toggle('nohelp');
    configureLeaderboards({ play: (r) => this.startLocal(r.setup, r), again: () => this.raceAgain(), quit: () => this.quit(), profile: () => this.menu.profile, replay: () => this.instantReplay() });
    applySettings(); // HUD scale/opacity, colourblind palette, reduced motion
    watchPads(); // controller hot-plug toasts
    initMenuNav(this.menu.root); // keyboard / gamepad menu navigation
    initCloudSave({
      get: () => ({ ...this.menu.profile }),
      set: (d) => { Object.assign(this.menu.profile, mergeSaved(this.menu.profile, d)); store.set('profile', this.menu.profile); },
      applied: () => this.refreshMenu(),
    });
    this.attract();
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (code && ROOM_CODE_RE.test(code)) this.menu.showJoin(code); // pick name/colour first
    else this.menu.show(prefs.onboarded ? 'home' : 'onboard');
    // ?debug exposes the app for automated browser tests (e.g. granting XP)
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __moto: App }).__moto = this;
    // leaving the tab / locking the phone pauses the game (rendering stops in Game's loop)
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.game && this.menu.inGame && !this.menu.visible) this.togglePause(); });
    window.addEventListener('webglcontextlost', () => this.menu.show('loading', 'Graphics context lost: reload the page.'));
  }

  private actions() {
    return {
      startLocal: (s: Setup) => this.startLocal(s),
      startTraining: () => this.startTraining(),
      createRoom: () => void this.join(newRoomCode()),
      joinRoom: (code: string) => void this.join(code),
      updateProfile: (name: string, color: number, vehicle?: string) => {
        this.menu.profile.name = name;
        this.menu.profile.color = color;
        if (vehicle) this.menu.profile.vehicle = vehicle;
        this.saveProfile();
        this.net?.send({ t: 'profile', name, color, vehicle: this.menu.profile.vehicle ?? 'street' });
      },
      kick: (id: string) => this.net?.send({ t: 'kick', id }),
      setReady: (ready: boolean) => this.net?.send({ t: 'ready', ready }),
      leaveRoom: () => this.leaveRoom(),
      lobbySettings: (s: LobbySettings) => this.net?.send({ t: 'settings', settings: s }),
      lobbyStart: () => this.net?.send({ t: 'start' }),
      resume: () => this.resume(),
      respawn: () => { this.game?.players.forEach((p) => p.respawn()); this.resume(); },
      quit: () => this.quit(),
      replay: () => this.openStudio('replay'),
      photo: () => this.openStudio('photo'),
      raceAgain: () => this.raceAgain(),
      setQuality: (q: QualityName) => { this.quality = q; store.set('quality', q); this.game?.setQuality(q); },
      toggleMute: () => this.audio.toggleMute(),
      volumes: () => this.audio.applyVolumes(),
      hearEngine: (id: string) => void this.audio.previewEngine(vehicleById(id).engine),
      saveProfile: () => this.saveProfile(),
    };
  }

  /** Redraw the menu after cloud data or the admin mode changed what it shows (never mid-ride). */
  refreshMenu() {
    const s = this.menu.current;
    if (this.menu.visible && (s === 'home' || s === 'career' || s === 'garage' || s === 'settings')) this.menu.show(s);
  }

  private saveProfile() {
    store.set('profile', this.menu.profile);
    markChanged('profile');
  }

  // ------------------------------------------------------------------ sessions
  private replaceGame(opts: SessionOptions | null) {
    this.lb?.dispose();
    this.lb = null;
    this.studio?.dispose();
    this.studio = null;
    this.game?.dispose();
    this.game = null;
    this.touch?.remove();
    this.touch = null;
    if (!opts) return;
    this.game = new Game(opts, this.input, this.audio, { onRaceResults: (rows) => this.results(rows), onLap: (t, s) => this.lb?.lap(t, s) });
    this.lb = attachLeaderboards(this.game, this.lbStart?.challenge ?? null);
    this.game.start();
    if (!opts.attract) this.studio = new ReplayStudio(this.game, (from) => this.closeStudio(from));
  }

  private attract() {
    this.menu.inGame = false;
    const times = ['day', 'sunset', 'dawn'] as const;
    this.replaceGame({
      mode: 'open', seed: Math.floor(Math.random() * 1e9), trackId: '', laps: 0, pvp: false, quality: this.quality, locals: [], net: null, attract: true,
      time: times[Math.floor(Math.random() * times.length)], weather: 'clear', theme: 'mixed', gen: { ...DEFAULT_GEN }, drones: 2, ai: 0,
    });
  }

  /** Turn menu/lobby settings into a game session (named tracks bring their own seed and scenery). */
  private session(s: LobbySettings, locals: SessionOptions['locals'], net: NetClient | null): SessionOptions {
    const track = s.mode === 'race' && s.trackId !== 'random' ? TRACKS.find((t) => t.id === s.trackId) : undefined;
    const dtrack = s.mode === 'drift' ? DRIFT_TRACKS.find((t) => t.id === s.trackId) : undefined;
    return {
      mode: s.mode, seed: s.mode === 'drift' ? driftSeed(s.trackId, s.seed) : track?.seed ?? s.seed, trackId: s.trackId, laps: s.laps, pvp: s.pvp,
      time: s.time, weather: s.weather, weathers: s.weathers, theme: track?.theme ?? (dtrack && dtrack.id !== 'random' ? dtrack.theme : s.mode === 'f1' ? (F1_TRACKS.find((t) => t.id === s.trackId)?.theme ?? s.theme) : s.theme), gen: track ? { ...DEFAULT_GEN } : { ...DEFAULT_GEN, ...s.gen }, drones: s.drones ?? 2, ai: s.ai ?? 0, session: s.session ?? 'race', tyre: s.tyre ?? 'medium',
      variant: s.mode === 'race' && !net ? s.variant : undefined, traffic: net ? 0 : s.traffic, // src/modes: local-only formats
      aiLevel: s.aiLevel ?? 'adaptive',
      quality: this.quality, locals: s.mode === 'f1' ? locals.map((l) => ({ ...l, vehicle: vehicleById(l.vehicle).f1 ? l.vehicle : this.menu.profile.f1car ?? 'f1_2026' })) : locals, net,
    };
  }

  /** Show the loading card for a frame, then do the heavy world build. */
  private withLoading(fn: () => void) {
    this.menu.show('loading');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fn();
      this.menu.hide();
    }));
  }

  private startLocal(s: Setup, lb: LbStart | null = null) {
    this.audio.init();
    this.lastLocal = s;
    this.lbStart = lb;
    const P = this.menu.profile, C = this.input.controllers;
    this.input.setLayout(s.split);
    const locals = s.split
      ? [{ name: P.name, color: P.color, controller: C[0], vehicle: P.vehicle ?? 'street' }, { name: P.name2, color: P.color2 === P.color ? PLAYER_COLORS[(PLAYER_COLORS.indexOf(P.color) + 1) % PLAYER_COLORS.length] : P.color2, controller: C[1], vehicle: P.vehicle2 ?? 'street' }]
      : [{ name: P.name, color: P.color, controller: C[0], vehicle: lb?.vehicle ?? P.vehicle ?? 'street' }];
    this.withLoading(() => {
      this.replaceGame({ ...this.session(s, locals, null), ghost: lb?.ghost ?? undefined });
      this.enterPlay(!s.split);
      // challenge / ghost runs bring their own vehicle: a locked one is lent for this run only (no unlock)
      if (lb && !isUnlocked(lb.vehicle)) toast(`🔑 Loaner: ${vehicleById(lb.vehicle).name} for this run only. Unlock it in the garage to keep it.`);
    });
  }

  /** Guided training ride: flat, dry, quiet world, starting on foot next to the bike. */
  private startTraining() {
    this.audio.init();
    this.lastLocal = null;
    this.input.setLayout(false);
    const P = this.menu.profile;
    this.withLoading(() => {
      this.replaceGame({
        mode: 'open', seed: Math.floor(Math.random() * 1e9), trackId: '', laps: 0, pvp: false, time: 'day', weather: 'clear', theme: 'mixed',
        gen: { terrain: 0, water: 0, flora: 0, roads: 1, poi: 2 }, drones: 2, tutorial: true, quality: this.quality,
        locals: [{ name: P.name, color: P.color, controller: this.input.controllers[0], vehicle: P.vehicle ?? 'street' }], net: null,
      });
      this.enterPlay(true);
    });
  }

  private enterPlay(touch: boolean) {
    this.menu.inGame = true;
    this.input.reset();
    this.game!.setMenuPaused(false);
    if (touch) this.touch = createTouch(this.input, this.game!, { canResume: () => !this.menu.visible && !this.studio?.active, replay: () => this.instantReplay() });
  }

  // ------------------------------------------------------------------ online
  private async join(code: string) {
    this.audio.init();
    this.menu.show('loading', `Joining room ${code}…`);
    this.net?.close();
    const net = new NetClient(code);
    try {
      await net.connect(this.menu.profile.name, this.menu.profile.color, this.menu.profile.vehicle ?? 'street');
    } catch (e) {
      if (new URLSearchParams(location.search).get('room')) this.menu.showJoin(code, (e as Error).message);
      else this.menu.show('online', (e as Error).message);
      return;
    }
    this.net = net;
    history.replaceState(null, '', `?room=${code}`);
    const ev = net.events, lobby = () => this.menu.current === 'lobby' && this.showLobby();
    ev.on('players', lobby);
    ev.on('settings', lobby);
    ev.on('start', () => this.startOnline());
    ev.on('back', () => { this.attract(); this.showLobby(); });
    ev.on('closed', (m) => { this.net = null; this.attract(); this.menu.show('online', m.reason); });
    // back after a dropped link: carry on, or catch up if the session moved on meanwhile
    ev.on('reconnected', (m) => { if (!m.changed) return; if (net.phase === 'playing') this.startOnline(); else { this.attract(); this.showLobby(); } });
    // replay / photo mode own the keyboard while open (Tab, [ ], Enter, digits): the social layer counts them as a menu
    new SocialUI(net, { game: () => this.game, view: () => (this.menu.visible ? (this.menu.current === 'lobby' ? 'lobby' : 'menu') : this.menu.inGame && !this.studio?.active ? 'play' : 'menu'), resume: () => this.resume() });
    if (net.isHost) net.send({ t: 'settings', settings: { ...net.settings, seed: Math.floor(Math.random() * 1e9) } });
    if (net.phase === 'playing') this.startOnline();
    else this.showLobby();
  }

  private showLobby() {
    const n = this.net;
    if (!n) return;
    this.menu.showLobby({ code: n.code, link: n.link, players: n.players, settings: n.settings, host: n.isHost, you: n.id });
  }

  private startOnline() {
    const n = this.net!, s = n.settings, P = this.menu.profile;
    this.input.setLayout(false);
    this.withLoading(() => {
      this.replaceGame(this.session(s, [{ name: P.name, color: P.color, controller: this.input.controllers[0], vehicle: P.vehicle ?? 'street' }], n));
      this.enterPlay(true);
    });
  }

  private leaveRoom() {
    this.net?.close();
    this.net = null;
    history.replaceState(null, '', location.pathname);
    this.menu.show('home');
  }

  // ------------------------------------------------------------------ pause / results
  private togglePause() {
    if (!this.game || !this.menu.inGame || this.studio?.active) return;
    if (this.menu.visible && (this.menu.current === 'pause' || this.menu.current === 'settings' || this.menu.current === 'howto')) this.resume();
    else if (!this.menu.visible) {
      this.game.setMenuPaused(true);
      this.menu.show('pause');
    }
  }

  private resume() {
    this.menu.hide();
    this.input.reset();
    this.game?.setMenuPaused(false);
    this.touch?.afterResume(); // still in portrait / touch sheet open: stay held
  }

  /** Instant replay from play (touch 🎬, leaderboard run card); closing it resumes riding. */
  private instantReplay() {
    if (!this.studio || this.menu.visible) return false;
    return this.studio.openReplay('play');
  }

  private results(rows: Standing[]) {
    this.lastRows = rows;
    this.game?.setMenuPaused(true);
    this.menu.show('results', rows);
  }

  /** Replay / photo mode from the pause or results screen; closing goes back there. */
  private openStudio(kind: 'replay' | 'photo') {
    const from: StudioFrom = this.menu.current === 'results' ? 'results' : 'pause';
    this.menu.hide();
    if (!(kind === 'replay' ? this.studio?.openReplay(from) : this.studio?.openPhoto(from))) this.closeStudio(from);
  }

  private closeStudio(from: StudioFrom) {
    if (from === 'play') this.resume();
    else if (from === 'results') this.menu.show('results', this.lastRows);
    else this.menu.show('pause');
  }

  private raceAgain() {
    if (this.net) {
      if (this.net.isHost) this.net.send({ t: 'back' });
      else { this.attract(); this.showLobby(); }
      return;
    }
    if (this.lastLocal) this.startLocal(this.lastLocal, this.lbStart);
  }

  private quit() {
    if (this.net) {
      this.net.close();
      this.net = null;
      history.replaceState(null, '', location.pathname);
    }
    this.attract();
    this.menu.show('home');
  }
}
