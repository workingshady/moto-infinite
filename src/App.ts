// Top-level flow: menu ⇄ game sessions ⇄ online rooms. Owns the long-lived Input/Audio singletons.
import { Game, type SessionOptions } from './core/Game';
import { Input } from './core/Input';
import { Audio } from './core/Audio';
import { Menu, type Profile, type Setup } from './ui/Menu';
import { createTouch } from './ui/Touch';
import { NetClient, newRoomCode } from './net/NetClient';
import { PLAYER_COLORS, TRACKS, type QualityName } from './config';
import { DEFAULT_GEN, ROOM_CODE_RE, type LobbySettings } from '../shared/protocol';
import type { Standing } from './systems/Race';
import { prefs } from './core/prefs';

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem('moto:' + k);
      return v ? (JSON.parse(v) as T) : fallback;
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

const isMobile = matchMedia('(pointer: coarse)').matches;

export class App {
  private input = new Input();
  private audio = new Audio();
  private menu: Menu;
  game: Game | null = null;
  private net: NetClient | null = null;
  private lastLocal: Setup | null = null;
  private touch: HTMLDivElement | null = null;
  private quality: QualityName = store.get<QualityName>('quality', isMobile ? 'low' : 'medium');

  constructor() {
    const profile = store.get<Profile>('profile', { name: 'Rider', color: PLAYER_COLORS[0], name2: 'Player 2', color2: PLAYER_COLORS[1] });
    this.menu = new Menu(this.actions(), profile, this.quality, () => this.audio.muted);
    this.input.onUserGesture = () => this.audio.init();
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.audio.toggleMute();
    this.input.onToggleHelp = () => document.body.classList.toggle('nohelp');
    this.attract();
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (code && ROOM_CODE_RE.test(code)) this.menu.showJoin(code); // pick name/colour first
    else this.menu.show(prefs.onboarded ? 'home' : 'onboard');
    // ?debug exposes the app for automated browser tests (e.g. granting XP)
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __moto: App }).__moto = this;
    window.addEventListener('webglcontextlost', () => this.menu.show('loading', 'Graphics context lost: reload the page.'));
  }

  private actions() {
    return {
      startLocal: (s: Setup) => this.startLocal(s),
      startTraining: () => this.startTraining(),
      createRoom: () => void this.join(newRoomCode()),
      joinRoom: (code: string) => void this.join(code),
      updateProfile: (name: string, color: number) => {
        this.menu.profile.name = name;
        this.menu.profile.color = color;
        store.set('profile', this.menu.profile);
        this.net?.send({ t: 'profile', name, color });
      },
      kick: (id: string) => this.net?.send({ t: 'kick', id }),
      setReady: (ready: boolean) => this.net?.send({ t: 'ready', ready }),
      leaveRoom: () => this.leaveRoom(),
      lobbySettings: (s: LobbySettings) => this.net?.send({ t: 'settings', settings: s }),
      lobbyStart: () => this.net?.send({ t: 'start' }),
      resume: () => this.resume(),
      quit: () => this.quit(),
      raceAgain: () => this.raceAgain(),
      setQuality: (q: QualityName) => { this.quality = q; store.set('quality', q); this.game?.setQuality(q); },
      toggleMute: () => this.audio.toggleMute(),
      saveProfile: (p: Profile) => store.set('profile', p),
    };
  }

  // ------------------------------------------------------------------ sessions
  private replaceGame(opts: SessionOptions | null) {
    this.game?.dispose();
    this.game = null;
    this.touch?.remove();
    this.touch = null;
    if (!opts) return;
    this.game = new Game(opts, this.input, this.audio, { onRaceResults: (rows) => this.results(rows) });
    this.game.start();
  }

  private attract() {
    this.menu.inGame = false;
    const times = ['day', 'sunset', 'dawn'] as const;
    this.replaceGame({
      mode: 'open', seed: Math.floor(Math.random() * 1e9), trackId: '', laps: 0, pvp: false, quality: this.quality, locals: [], net: null, attract: true,
      time: times[Math.floor(Math.random() * times.length)], weather: 'clear', theme: 'mixed', gen: { ...DEFAULT_GEN },
    });
  }

  /** Turn menu/lobby settings into a game session (named tracks bring their own seed and scenery). */
  private session(s: LobbySettings, locals: SessionOptions['locals'], net: NetClient | null): SessionOptions {
    const track = s.mode === 'race' && s.trackId !== 'random' ? TRACKS.find((t) => t.id === s.trackId) : undefined;
    return {
      mode: s.mode, seed: track?.seed ?? s.seed, trackId: s.trackId, laps: s.laps, pvp: s.pvp,
      time: s.time, weather: s.weather, theme: track?.theme ?? s.theme, gen: track ? { ...DEFAULT_GEN } : { ...DEFAULT_GEN, ...s.gen }, quality: this.quality, locals, net,
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

  private startLocal(s: Setup) {
    this.audio.init();
    this.lastLocal = s;
    const P = this.menu.profile, C = this.input.controllers;
    this.input.setLayout(s.split);
    const locals = s.split
      ? [{ name: P.name, color: P.color, controller: C[0] }, { name: P.name2, color: P.color2 === P.color ? PLAYER_COLORS[(PLAYER_COLORS.indexOf(P.color) + 1) % PLAYER_COLORS.length] : P.color2, controller: C[1] }]
      : [{ name: P.name, color: P.color, controller: C[0] }];
    this.withLoading(() => {
      this.replaceGame(this.session(s, locals, null));
      this.enterPlay(!s.split);
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
        gen: { terrain: 0, water: 0, flora: 0, roads: 1, poi: 2 }, tutorial: true, quality: this.quality,
        locals: [{ name: P.name, color: P.color, controller: this.input.controllers[0] }], net: null,
      });
      this.enterPlay(true);
    });
  }

  private enterPlay(touch: boolean) {
    this.menu.inGame = true;
    this.input.reset();
    this.game!.setMenuPaused(false);
    if (touch) this.touch = createTouch(this.input);
  }

  // ------------------------------------------------------------------ online
  private async join(code: string) {
    this.audio.init();
    this.menu.show('loading', `Joining room ${code}…`);
    this.net?.close();
    const net = new NetClient(code);
    try {
      await net.connect(this.menu.profile.name, this.menu.profile.color);
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
      this.replaceGame(this.session(s, [{ name: P.name, color: P.color, controller: this.input.controllers[0] }], n));
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
    if (!this.game || !this.menu.inGame) return;
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
  }

  private results(rows: Standing[]) {
    this.game?.setMenuPaused(true);
    this.menu.show('results', rows);
  }

  private raceAgain() {
    if (this.net) {
      if (this.net.isHost) this.net.send({ t: 'back' });
      else { this.attract(); this.showLobby(); }
      return;
    }
    if (this.lastLocal) this.startLocal(this.lastLocal);
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
