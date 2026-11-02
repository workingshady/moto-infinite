// Landing page, game setup (shared by solo, split screen and online lobby), settings, pause and results.
// Plain DOM: each screen is a template string; clicks are handled by data-attributes in one place.
import { ASSIST, DRONE_LEVELS, GEN, PLAYER_COLORS, QUALITY, THEME_DEFS, TRACKS, WEATHER_DEFS, combineWeather, type QualityName } from '../config';
import { DEFAULT_GEN, FIXED_WEATHERS, GEN_MAX, MAX_PLAYERS, THEMES, TIMES, WEATHERS, activeWeathers, type WorldGen, type GameMode, type LobbySettings, type PlayerInfo, type TimeOfDay, type Weather, type WorldTheme } from '../../shared/protocol';
import type { Standing } from '../systems/Race';
import { fmt } from '../systems/Race';
import { escapeHtml, hex } from '../utils/math';
import { STORY } from '../data/story';
import { CharacterPreview, LobbyShowcase, drawMapPreview } from './Preview';
import { VEHICLES, vehicleById, type VehicleKind } from '../data/vehicles';
import { DRIFT_TRACKS } from '../world/DriftTrack';
import { F1_TRACKS } from '../world/F1Track';
import { clamp } from '../utils/math';

const bar = (v: number) => `<i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i>`;
/** Garage card grid: bikes or cars, stat bars, the selected one highlighted. */
function garageCards(sel: string, attr: string, kind: VehicleKind) {
  return VEHICLES.filter((v) => v.kind === kind).map((v) => `
    <button class="veh ${v.id === sel ? 'on' : ''}" data-${attr}="${v.id}">
      <div class="veh-head"><b>${escapeHtml(v.name)}</b><span>${v.cls} · ${v.era}</span></div>
      <div class="stat"><span>Speed</span><div class="sbar">${bar(v.top / 46)}</div></div>
      <div class="stat"><span>Accel</span><div class="sbar">${bar(v.accel / 25)}</div></div>
      <div class="stat"><span>Handling</span><div class="sbar">${bar(v.grip / 2.3)}</div></div>
      <div class="stat"><span>Drift</span><div class="sbar drift">${bar(1 - v.traction / 13)}</div></div>
      <div class="veh-spec">${v.spec.power} · ${v.spec.weight} · ${v.spec.layout}</div>
    </button>`).join('');
}

import { prefs, savePrefs } from '../core/prefs';
import { CAM_LABEL, CAM_VIEWS, isCamView } from '../core/cameraViews';

const K = (k: string) => `<kbd class="key">${k}</kbd>`;
/** Keys shown by the Settings keyboard tester. */
const KEYTEST: [string, string][] = [
  ['ArrowUp', '↑'], ['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→'], ['Space', 'Space'], ['ShiftLeft', 'Shift'], ['ShiftRight', 'R-Shift'],
  ['KeyN', 'N'], ['KeyB', 'B'], ['KeyW', 'W'], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyC', 'C'], ['KeyX', 'X'],
];
/** Onboarding slides: what to press, and what it looks like when you get it right. */
const SLIDES: { title: string; art: string; body: string; result?: string }[] = [
  {
    title: 'Welcome to Infinita',
    art: `<div class="scene sunset"><span class="big-emoji bob">🏍️</span><span class="drone-fly">🛸</span></div>`,
    body: `${escapeHtml(STORY.intro)}<br><br>This guide takes 1 minute. Then a <b>training ride</b> checks off each skill live.`,
  },
  {
    title: 'Ride',
    art: `<div class="keys-grid"><span></span>${K('↑')}<span></span>${K('←')}${K('↓')}${K('→')}</div><div class="or">or</div><div class="keys-grid"><span></span>${K('W')}<span></span>${K('A')}${K('S')}${K('D')}</div>`,
    body: `${K('E')} gets on the bike. ${K('↑')} throttle, ${K('↓')} brake / reverse, ${K('←')}${K('→')} steer. Grey road = fast, grass and sand slow you down. Wet or snowy roads have less grip.`,
    result: '<span class="speed">93</span> km/h · Riding',
  },
  {
    title: 'Nitro: boost while steering',
    art: `<div class="combo">${K('Space')}<b>+</b>${K('←')}<span class="trail">💨💨💨</span></div>`,
    body: `Hold ${K('Space')}, ${K('Shift')} or ${K('N')} for nitro. <b>Nitro drives the bike by itself</b>, so you only need nitro + ${K('←')}/${K('→')} to steer at top speed.<br><span class="tip">💡 Some keyboards ignore 3 keys pressed at once ("ghosting"). If steering stops while boosting, drop ${K('↑')}, use WASD, or turn on <b>Nitro: tap to toggle</b> in Settings.</span>`,
    result: 'NITRO!',
  },
  {
    title: 'Jumps & landing',
    art: `<div class="scene"><span class="ramp"></span><span class="big-emoji jump">🏍️</span></div>`,
    body: `Orange striped ramps launch you (orange squares on the minimap). <b>Hands off in the air = the bike levels itself.</b> Land on both wheels, facing forward.`,
    result: 'BIG AIR 1.4s · +112 XP',
  },
  {
    title: 'Tricks & combos',
    art: `<div class="trick-row"><div>${K('↑')}${K('↓')}<small>flip</small></div><div>${K('←')}${K('→')}<small>spin</small></div><div>${K('C')}<small>style</small></div></div>`,
    body: `After takeoff <b>let go</b>, then press ${K('↑')}/${K('↓')} to flip or ${K('←')}/${K('→')} to spin. Hold ${K('C')} for a style trick: alone = No-Hander, + ${K('↑')} = Superman, + ${K('↓')} = Heel Clicker. Let go before landing. Flip + spin = CORKSCREW bonus. Chain tricks within 5 s to build a combo.`,
    result: 'BACKFLIP + 360 SPIN + CORKSCREW · +1890 XP · COMBO x3',
  },
  {
    title: 'Drift, wheelies & the garage',
    art: `<div class="trick-row"><div>${K('X')}<small>handbrake drift</small></div><div>${K('C')}<small>wheelie (ground)</small></div><div><span class="big-emoji" style="font-size:40px">🏎️</span><small>15 vehicles</small></div></div>`,
    body: `Pick from <b>5 motorcycles and 10 cars</b> in the 🏁 Garage, each with real-world-style handling. Tap ${K('X')} (handbrake) into a corner to kick the tail out, then steer <b>against</b> the slide to hold the angle. Angle × speed = points, longer chains = bigger multiplier, hitting a wall loses the chain. On a bike, hold ${K('C')} on the ground for a wheelie at any speed (even with nitro): ${K('↑')}/${K('↓')} adjust the angle without braking, release ${K('C')} to land.`,
    result: 'DRIFT 4,820 · x2.5 · 6.1s · Crane Corner',
  },
  {
    title: 'Weapons & drones',
    art: `<div class="scene night"><span class="reticle-demo"></span><span class="big-emoji">🛸</span><span class="hit-demo">✕</span></div>`,
    body: `${K('F')} or left click fires. Shots <b>auto-aim</b> at the red reticle and lead moving drones. ✕ = hit, red ✕ = kill. ${K('Q')} switches weapon. Level up to unlock Rocket, Railgun, Swarm and Mines. Scouts are fast, gunners shoot, bombers drop bombs.`,
  },
  {
    title: 'The world',
    art: `<div class="poi-row"><span style="--c:#ffb03f">🏘 Village</span><span style="--c:#5dff8a">⛽ Gas station</span><span style="--c:#ffffff">🌬 Windmill</span><span style="--c:#ff7ad9">🛹 Stunt zone</span><span style="--c:#ff3355">📡 Vex outpost</span></div>`,
    body: `Every seed builds a different world. Ride under a <b>gas station</b> canopy to refuel and repair. Clear <b>Vex outposts</b>. Grab 💎 gems and power-ups (green repair, blue shield, yellow magnet, pink double XP). Timed challenges and story chapters keep coming.`,
  },
  {
    title: 'Racing',
    art: `<div class="scene"><span class="gate"></span><span class="big-emoji">🏁</span></div>`,
    body: `Pass every blue gate in order; the checkered gate is start/finish. The minimap circles the next gate. Your best lap is saved as a <b>ghost</b> to race against. In rooms the host picks track, laps, weather and time.`,
    result: 'LAP 2 · 0:41.07 · BEST',
  },
];


export interface Profile { name: string; color: number; name2: string; color2: number; vehicle?: string; vehicle2?: string; f1car?: string }
export type Setup = LobbySettings & { split: boolean };

export interface MenuActions {
  startLocal(setup: Setup): void;
  startTraining(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateProfile(name: string, color: number, vehicle?: string): void;
  kick(id: string): void;
  setReady(ready: boolean): void;
  leaveRoom(): void;
  lobbySettings(s: LobbySettings): void;
  lobbyStart(): void;
  resume(): void;
  respawn(): void;
  quit(): void;
  raceAgain(): void;
  setQuality(q: QualityName): void;
  toggleMute(): boolean;
  hearEngine(vehicle: string): void;
  volumes(): void;
  saveProfile(p: Profile): void;
}

type Screen = 'garage' | 'onboard' | 'joinroom' | 'home' | 'mode' | 'online' | 'lobby' | 'settings' | 'howto' | 'pause' | 'results' | 'loading';
interface LobbyView { code: string; link: string; players: PlayerInfo[]; settings: LobbySettings; host: boolean; you: string }

const TIME_LABEL: Record<TimeOfDay, string> = { day: '☀️ Day', dawn: '🌅 Dawn', sunset: '🌇 Sunset', night: '🌙 Night', cycle: '🔄 Live cycle' };
/** What the picked weather (mix) does to the ride. */
function weatherHint(s: LobbySettings) {
  const ws = activeWeathers(s);
  if (!ws.length) return 'Changes every minute or two, sometimes two weathers at once. Tap several weathers to layer them yourself.';
  const d = combineWeather(ws), grip = Math.round((1 - d.grip) * 100), view = Math.round(d.fogFar * 100);
  const bits = [ws.length > 1 ? `<b>${d.label}</b> layered together.` : WEATHER_DEFS[ws[0]].blurb];
  if (grip > 0) bits.push(`Grip −${grip}%.`);
  if (view < 95) bits.push(`View ${view}%.`);
  if (d.wind > 0.6) bits.push('Crosswind gusts.');
  if (ws.length === 1) bits.push('Tap more weathers to layer them (e.g. Fog + Rain + Storm).');
  return bits.join(' ');
}
const MODE_LABEL: Record<GameMode, string> = { open: '🌄 Open world', race: '🏁 Circuit race', f1: '🏎 Formula 1', drift: '🌀 Drift' };

/** One-glance strip of what everyone is about to play (mode, place, laps, time, weather). */
function raceSummary(s: LobbySettings) {
  const place = s.mode === 'open' ? THEME_DEFS[s.theme].label
    : (s.mode === 'f1' ? F1_TRACKS : s.mode === 'drift' ? DRIFT_TRACKS : TRACKS).find((t) => t.id === s.trackId)?.name ?? '';
  const laps = s.mode === 'race' || s.mode === 'f1' ? `<span>🔁 ${s.laps} lap${s.laps === 1 ? '' : 's'}</span>` : '';
  const ws = activeWeathers(s), weather = ws.length ? ws.map((w) => `${WEATHER_DEFS[w].icon} ${WEATHER_DEFS[w].label}`).join(' + ') : '🎲 Changing';
  return `<div class="race-summary"><b>${MODE_LABEL[s.mode] ?? s.mode}</b><span>📍 ${escapeHtml(place)}</span>${laps}<span>${TIME_LABEL[s.time]}</span><span>${weather}</span></div>`;
}
const LAPS = [1, 3, 5, 10];
const newSeed = () => Math.floor(Math.random() * 1e9);

const chips = <T extends string | number>(key: string, list: readonly T[], sel: T, label: (v: T) => string) =>
  list.map((v) => `<button class="chip ${v === sel ? 'on' : ''}" data-opt="${key}" data-val="${v}">${label(v)}</button>`).join('');
const colorDots = (sel: number, attr: string) =>
  PLAYER_COLORS.map((c) => `<button class="dot ${c === sel ? 'on' : ''}" style="background:${hex(c)}" data-${attr}="${c}" aria-label="colour"></button>`).join('');

export class Menu {
  readonly root: HTMLDivElement;
  private screen: Screen = 'home';
  private back: Screen = 'home';
  private setup: Setup = { split: false, mode: 'open', trackId: 'coast', laps: 3, pvp: false, seed: newSeed(), time: 'day', weather: 'clear', theme: 'mixed', gen: { ...DEFAULT_GEN }, maxPlayers: 8, locked: false, drones: 2, ai: 5, session: 'race', tyre: 'medium' };
  private lobby: LobbyView | null = null;
  private genKey: keyof WorldGen = 'terrain';
  private slide = 0;
  /** Where onboarding returns to (home, or back into a room). */
  private obBack: Screen = 'home';
  private joinCode = '';
  private garageBack: Screen = 'home';
  private garageFor: 1 | 2 = 1;
  private garageKind: VehicleKind = 'bike';
  private preview = new CharacterPreview();
  private lineup = new LobbyShowcase();
  /** Settings → keyboard tester: shows live which game keys the browser actually receives (ghosting check). */
  private keyTest = false;
  private keysDown = new Set<string>();
  inGame = false;

  constructor(private a: MenuActions, public profile: Profile, public quality: QualityName, private muted: () => boolean) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('change', (e) => this.change(e));
    const track = (e: KeyboardEvent, down: boolean) => {
      if (down) this.keysDown.add(e.code);
      else this.keysDown.delete(e.code);
      if (!this.paintKeyTest()) return;
      if (KEYTEST.some(([c]) => c === e.code)) e.preventDefault(); // Space/arrows must not click buttons or scroll
    };
    addEventListener('keydown', (e) => track(e, true), true);
    addEventListener('keyup', (e) => track(e, false), true);
    addEventListener('blur', () => { this.keysDown.clear(); this.paintKeyTest(); });
  }

  /** Redraws the key tester if it is on screen; returns whether it is. */
  private paintKeyTest() {
    const el = this.keyTest && this.visible && this.screen === 'settings' ? this.root.querySelector<HTMLElement>('[data-keytest]') : null;
    if (!el) return false;
    el.innerHTML = KEYTEST.map(([c, l]) => `<kbd class="key${this.keysDown.has(c) ? ' on' : ''}">${l}</kbd>`).join('');
    return true;
  }

  get visible() {
    return this.root.style.display !== 'none';
  }

  get current() {
    return this.screen;
  }

  hide() {
    this.root.style.display = 'none';
  }

  show(s: Screen, data?: unknown) {
    this.root.style.display = '';
    this.screen = s;
    this.root.className = s === 'pause' || s === 'results' ? 'overlay dim' : s === 'lobby' ? 'overlay lobby-screen' : 'overlay';
    const wide = s === 'home' || s === 'mode' || s === 'lobby' || s === 'onboard' || s === 'garage' || s === 'howto';
    this.root.innerHTML = `<div class="card-wrap ${wide ? 'wide' : ''} scr-${s}">${this.render(s, data)}</div>`;
    this.afterRender();
  }

  showLobby(v: LobbyView) {
    this.lobby = v;
    if (this.screen === 'lobby' && this.visible) this.refreshLobby();
    else this.show('lobby');
  }

  /** Re-render the lobby in place when players or settings change. */
  private refreshLobby() {
    const focused = document.activeElement as HTMLInputElement | null, keep = focused?.id === 'lname' ? focused.value : null;
    const scroll = this.root.querySelector('.lobby-main')?.scrollTop ?? 0;
    this.root.querySelector('.card-wrap')!.innerHTML = this.render('lobby');
    this.afterRender();
    const main = this.root.querySelector('.lobby-main');
    if (main) main.scrollTop = scroll;
    if (keep !== null) {
      const el = this.root.querySelector<HTMLInputElement>('#lname')!;
      el.value = keep;
      el.focus();
      el.setSelectionRange(keep.length, keep.length);
    }
  }

  /** Invite link opened: pick a name/colour before joining. */
  showJoin(code: string, error = '') {
    this.joinCode = code;
    this.show('joinroom', error);
  }

  private afterRender() {
    this.paintKeyTest();
    const host = this.root.querySelector<HTMLElement>('#charHost');
    if (host) {
      const p2 = this.screen === 'garage' && this.garageFor === 2;
      this.preview.setLook((p2 ? this.profile.vehicle2 : this.profile.vehicle) ?? 'street', p2 ? this.profile.color2 : this.profile.color);
      this.preview.mount(host);
    }
    const lineHost = this.root.querySelector<HTMLElement>('#lineupHost');
    if (lineHost && this.lobby) {
      this.lineup.setPlayers(this.lobby.players, this.lobby.you);
      this.lineup.mount(lineHost);
    }
    const map = this.root.querySelector<HTMLCanvasElement>('#mapCanvas');
    if (map) {
      const s = this.screen === 'lobby' && this.lobby ? this.lobby.settings : this.setup;
      // let the screen paint first, the map takes a few dozen ms to compute
      requestAnimationFrame(() => {
        const info = drawMapPreview(map, s);
        const el = this.root.querySelector('#mapInfo');
        if (el) el.textContent = (info.lengthKm ? `${info.lengthKm.toFixed(2)} km lap · ` : 'Endless roads · ') + `${info.climb} m climb · seed ${info.seed}`;
      });
    }
  }

  // ---------------------------------------------------------------- templates
  private optionsPanel(s: LobbySettings, editable: boolean, showPvp: boolean) {
    const dis = editable ? '' : 'disabled';
    const track = TRACKS.find((t) => t.id === s.trackId) ?? TRACKS[0];
    const customLaps = !LAPS.includes(s.laps);
    const genRow = (key: keyof WorldGen, label: string) =>
      `<div class="opt"><span>${label}</span><div class="chips">${GEN[key].map((g, i) => `<button class="chip ${s.gen[key] === i ? 'on' : ''}" data-opt="gen" data-key="${key}" data-val="${i}">${g.label}</button>`).join('')}</div></div>`;
    return `
    <div class="setup">
      <div class="setup-opts ${dis}">
        <div class="modes">
          <button class="mode ${s.mode === 'open' ? 'on' : ''}" data-opt="mode" data-val="open"><b>🌄 Open world</b><span>Endless roads, story chapters, drones, challenges, level-ups</span></button>
          <button class="mode ${s.mode === 'race' ? 'on' : ''}" data-opt="mode" data-val="race"><b>🏁 Circuit race</b><span>Closed loop, checkpoint gates, laps, positions, best-lap ghost</span></button>
          <button class="mode ${s.mode === 'f1' ? 'on' : ''}" data-opt="mode" data-val="f1"><b>🏎 Formula 1</b><span>Real circuits: Monza, Silverstone, Spa, Monaco, Suzuka, Bahrain. Downforce, DRS, tyres, pit stops, AI grid</span></button>
          <button class="mode ${s.mode === 'drift' ? 'on' : ''}" data-opt="mode" data-val="drift"><b>🌀 Drift</b><span>8 venues: port, mountain pass, skidpad, gymkhana, airfield, harbor, car park, street. Score angle × speed, chain combos</span></button>
        </div>
        ${s.mode === 'f1' ? `
        <div class="opt"><span>Circuit</span><div class="chips">${chips('trackId', F1_TRACKS.map((t) => t.id), s.trackId, (id) => { const t = F1_TRACKS.find((x) => x.id === id)!; return `${t.name}`; })}</div></div>
        <p class="hint">${escapeHtml(F1_TRACKS.find((t) => t.id === s.trackId)?.blurb ?? '')} · ${F1_TRACKS.find((t) => t.id === s.trackId)?.lengthKm ?? ''} km · real layout</p>
        <div class="opt"><span>Session</span><div class="chips">${chips('session', ['race', 'quali'] as const, s.session, (x) => (x === 'race' ? '🏁 Grand Prix' : '⏱ Time trial'))}</div></div>
        <div class="opt"><span>Laps</span><div class="chips">${chips('laps', [1, 3, 5, 10], LAPS.includes(s.laps) ? s.laps : -1, (n) => `${n}`)}</div></div>
        ${s.session === 'race' ? `<div class="opt"><span>AI grid</span><div class="chips">${chips('ai', [0, 3, 5, 9, 15], s.ai, (n) => (n ? `${n} rivals` : 'None'))}</div></div>` : ''}
        <div class="opt"><span>Tyres</span><div class="chips">${chips('tyre', ['soft', 'medium', 'hard'] as const, s.tyre, (x) => ({ soft: '🔴 Soft (fast, short)', medium: '🟡 Medium', hard: '⚪ Hard (lasts long)' })[x])}</div></div>
        <div class="opt"><span>Car</span><div class="chips">${(['f1_2026', 'f1_v10', 'f1_classic'] as const).map((id) => `<button class="chip ${(this.profile.f1car ?? 'f1_2026') === id ? 'on' : ''}" data-f1car="${id}">${vehicleById(id).name} · ${vehicleById(id).era}</button>`).join('')}</div></div>
        <p class="hint"><b>Keys:</b> C = DRS / straight mode in DRS zones · Space = ERS deploy (recharges under braking) · stop in the pit box for fresh tyres (80 km/h limiter). Five red lights, then lights out: moving early = +5 s.</p>` : ''}
        ${s.mode === 'drift' ? `
        <div class="opt"><span>Venue</span><div class="chips">${chips('trackId', DRIFT_TRACKS.map((t) => t.id), s.trackId, (id) => DRIFT_TRACKS.find((t) => t.id === id)!.name)}</div></div>
        <p class="hint">${escapeHtml(DRIFT_TRACKS.find((t) => t.id === s.trackId)?.blurb ?? '')} <b>Tip:</b> drift cars (Kitsune, Panda 86, Brute V8, Kaze 7R) slide easiest. X = handbrake.</p>` : ''}
        ${s.mode === 'drift' || s.mode === 'f1' ? '' : s.mode === 'open' ? `
        <div class="opt"><span>World</span><div class="chips">${chips('theme', THEMES, s.theme, (t) => THEME_DEFS[t].label)}</div></div>
        <p class="hint">${THEME_DEFS[s.theme].blurb}</p>
        <div class="opt"><span>Drones</span><div class="chips">${chips('drones', [0, 1, 2, 3], s.drones ?? 2, (i) => (i === 0 ? '🚫 ' : '🛸 ') + DRONE_LEVELS[i].label)}</div></div>
        <p class="hint">${(s.drones ?? 2) === 0 ? 'Peaceful ride: no drone attacks, no drone outposts guards, no drone challenges.' : 'Drones attack in the open world; further from the start = tougher types.'}</p>
        <details class="gen" open><summary>🛠 World generator</summary>
          ${genRow('terrain', 'Terrain')}${genRow('water', 'Water')}${genRow('flora', 'Nature')}${genRow('roads', 'Roads')}${genRow('poi', 'Landmarks')}
        </details>
        <div class="opt"><span>Map</span><div class="chips"><button class="chip" data-opt="seed" data-val="new">🎲 New seed</button><button class="chip hot" data-opt="surprise" data-val="1">✨ Surprise me</button></div></div>` : `
        <div class="opt"><span>Track</span><div class="chips">${chips('trackId', TRACKS.map((t) => t.id), s.trackId, (id) => TRACKS.find((t) => t.id === id)!.name)}</div></div>
        <p class="hint">${track.blurb}${s.trackId === 'random' ? ' <button class="chip" data-opt="seed" data-val="new">🎲 Reroll</button>' : ''}</p>
        <div class="opt"><span>Laps</span><div class="chips">${chips('laps', LAPS, customLaps ? -1 : s.laps, (n) => `${n}`)}
          <label class="custom ${customLaps ? 'on' : ''}">Custom <input type="number" min="1" max="50" value="${s.laps}" data-opt="lapsCustom" ${dis}></label></div></div>
        <div class="opt"><span>AI rivals</span><div class="chips">${chips('ai', [0, 3, 5, 7], s.ai, (n) => (n ? `${n}` : 'None'))}</div></div>
        ${s.trackId === 'random' ? `<details class="gen"><summary>🛠 Scenery generator</summary>${genRow('terrain', 'Terrain')}${genRow('water', 'Water')}${genRow('flora', 'Nature')}</details>` : ''}`}
        <div class="opt"><span>Time</span><div class="chips">${chips('time', TIMES, s.time, (t) => TIME_LABEL[t])}</div></div>
        <div class="opt"><span>Weather</span><div class="chips">${FIXED_WEATHERS.map((w) => `<button class="chip ${activeWeathers(s).includes(w) ? 'on' : ''}" data-opt="weather" data-val="${w}" title="${WEATHER_DEFS[w].blurb}">${WEATHER_DEFS[w].icon} ${WEATHER_DEFS[w].label}</button>`).join('')}<button class="chip ${s.weather === 'dynamic' ? 'on' : ''}" data-opt="weather" data-val="dynamic" title="Rolls through every weather, sometimes two at once">🎲 Changing</button></div></div>
        <p class="hint">${weatherHint(s)}</p>
        ${showPvp ? `<label class="check"><input type="checkbox" data-opt="pvp" ${s.pvp ? 'checked' : ''} ${dis}> Riders can shoot each other</label>` : ''}
      </div>
      <div class="setup-map">
        <canvas id="mapCanvas" width="400" height="400"></canvas>
        <div class="dim small" id="mapInfo">Drawing map…</div>
      </div>
    </div>`;
  }

  private render(s: Screen, data?: unknown): string {
    const P = this.profile;
    switch (s) {
      case 'garage': {
        const sel = (this.garageFor === 2 ? P.vehicle2 : P.vehicle) ?? 'street', v = vehicleById(sel), k = this.garageKind;
        return `
        <h2>🏁 Garage${this.garageFor === 2 ? ' · Player 2' : ''}</h2>
        <div class="garage">
          <div class="garage-show">
            <div id="charHost" class="char-host"></div>
            <h3>${escapeHtml(v.name)}</h3>
            <div class="dim small">${v.cls} · ${v.era} · ${v.spec.layout}</div>
            <p class="hint">${escapeHtml(v.desc)}</p>
            <button class="chip hot" data-go="hearEngine">▶ Hear engine</button>
            <div class="spec-grid"><span>Top speed</span><b>${Math.round(v.top * 3.6)} km/h (${Math.round(v.top * 3.6 * 1.6)} with nitro)</b><span>Power</span><b>${v.spec.power}</b><span>Weight</span><b>${v.spec.weight}</b><span>Off-road</span><b>${Math.round(v.offroad * 100)}%</b><span>Wheelies</span><b>${v.wheelie ? 'Yes (C)' : 'No'}</b></div>
          </div>
          <div class="garage-list">
            <div class="tabs"><button class="chip ${k === 'bike' ? 'on' : ''}" data-gkind="bike">🏍 Motorcycles (5)</button><button class="chip ${k === 'car' ? 'on' : ''}" data-gkind="car">🏎 Cars (10)</button></div>
            <div class="veh-grid">${garageCards(sel, 'veh', k)}</div>
          </div>
        </div>
        <div class="row-buttons"><span></span><button class="btn primary" data-go="garageDone">Ride this →</button></div>`;
      }
      case 'onboard': {
        const sl = SLIDES[this.slide], last = this.slide === SLIDES.length - 1;
        return `
        <div class="onboard">
          <div class="dots-progress">${SLIDES.map((_, i) => `<i class="${i === this.slide ? 'on' : i < this.slide ? 'seen' : ''}"></i>`).join('')}</div>
          <div class="ob-grid">
            <div class="ob-art">${sl.art}</div>
            <div class="ob-text">
              <div class="label">HOW TO PLAY · ${this.slide + 1}/${SLIDES.length}</div>
              <h2>${sl.title}</h2>
              <p>${sl.body}</p>
              ${sl.result ? `<div class="result-mock"><div class="label">WHAT IT LOOKS LIKE</div><div class="mock-banner">${sl.result}</div></div>` : ''}
            </div>
          </div>
          <div class="row-buttons">
            <button class="btn ghost" data-go="skip">${this.obBack === 'home' ? 'Skip' : '← Back to room'}</button>
            <span>${this.slide ? '<button class="btn" data-go="tprev">← Back</button>' : ''}
            ${!last ? '<button class="btn primary" data-go="tnext">Next →</button>' : this.obBack === 'home' ? '<button class="btn primary" data-go="train">🎓 Start training ride</button>' : '<button class="btn primary" data-go="skip">Got it, back to the room</button>'}</span>
          </div>
        </div>`;
      }
      case 'home':
        return `
        <div class="hero">
          <div class="hero-left">
            <div class="logo">MOTO<span>INFINITE</span></div>
            <p class="story-intro"><b>${STORY.title}.</b> ${escapeHtml(STORY.intro)}</p>
            <div class="profile">
              <label>Rider name <input id="pname" maxlength="16" value="${escapeHtml(P.name)}"></label>
              <div class="dots">${colorDots(P.color, 'color')}</div>
            </div>
            <div class="ride-line">Your ride: <b>${escapeHtml(vehicleById(P.vehicle ?? 'street').name)}</b> <span>${vehicleById(P.vehicle ?? 'street').cls}</span> <button class="chip hot" data-go="garage">🏁 Garage · 15 vehicles</button></div>
            <div class="big-buttons">
              <button class="btn primary" data-go="solo">▶ Play solo</button>
              <button class="btn" data-go="split">👥 2 players · split screen</button>
              <button class="btn" data-go="online">🌐 Online room · invite friends</button>
              <button class="btn" data-go="tutorial">🎓 Tutorial & training ride</button>
            </div>
            <div class="row-buttons"><button class="btn ghost" data-go="howto">Controls</button><button class="btn ghost" data-go="settings">Settings</button></div>
          </div>
          <div class="hero-right">
            <div id="charHost" class="char-host"></div>
            <div class="dim small center">Drag to spin · pick a colour on the left</div>
            <ul class="features"><li>🌦 11 weathers, mix them + day/night</li><li>🏁 5 circuits + random tracks</li><li>🗺 5 world themes, endless map</li><li>🔫 6 weapons, 3 drone types</li></ul>
          </div>
        </div>`;
      case 'mode': {
        const st = this.setup;
        return `
        <h2>${st.split ? '👥 2 players · split screen' : '▶ Solo'}</h2>
        ${st.split ? `<div class="profile"><label>Player 2 <input id="pname2" maxlength="16" value="${escapeHtml(P.name2)}"></label><div class="dots">${colorDots(P.color2, 'color2')}</div></div>` : ''}
        <div class="ride-line">P1 ride: <b>${escapeHtml(vehicleById(P.vehicle ?? 'street').name)}</b> <button class="chip" data-go="garage">Change</button>
          ${st.split ? ` &nbsp; P2 ride: <b>${escapeHtml(vehicleById(P.vehicle2 ?? 'street').name)}</b> <button class="chip" data-go="garage2">Change</button>` : ''}</div>
        ${this.optionsPanel(st, true, st.split)}
        ${st.split ? `<p class="hint">P1: WASD · Space/Shift nitro · F fire · E ride · Q weapon &nbsp;|&nbsp; P2: Arrows · Right Shift nitro · / fire · Enter ride · . weapon · Gamepads work too.</p>` : ''}
        <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button><button class="btn primary" data-go="start">Ride →</button></div>`;
      }
      case 'joinroom':
        return `
        <h2>🌐 Join room <span class="roomcode inline">${escapeHtml(this.joinCode)}</span></h2>
        <p class="hint">A friend invited you. Pick your rider, then join the lobby.</p>
        <div class="join-grid">
          <div>
            <div class="profile"><label>Your name <input id="jname" maxlength="16" value="${escapeHtml(P.name)}" autofocus></label></div>
            <div class="dots">${colorDots(P.color, 'color')}</div>
            <p class="err">${escapeHtml(String(data ?? ''))}</p>
          </div>
          <div id="charHost" class="char-host small"></div>
        </div>
        <div class="row-buttons"><button class="btn ghost" data-go="home">Not now</button><span><button class="btn" data-go="tutorial">🎓 How to play</button> <button class="btn primary" data-go="joinnow">Join →</button></span></div>`;
      case 'online':
        return `
        <h2>🌐 Online room</h2>
        <p class="hint">Create a room, pick the world, then send the link. Friends join from their browser, no install. Up to 8 riders.</p>
        <div class="big-buttons"><button class="btn primary" data-go="create">Create room</button></div>
        <div class="join"><input id="code" maxlength="8" placeholder="Room code" autocomplete="off" autofocus><button class="btn" data-go="join">Join</button></div>
        <p class="err">${escapeHtml(String(data ?? ''))}</p>
        <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button></div>`;
      case 'lobby': {
        const v = this.lobby!;
        return `
        <div class="lobby-grid">
          <div class="lobby-side">
            <div class="lobby-top">
              <div><div class="label">🌐 ONLINE ROOM · CODE</div><div class="roomcode">${escapeHtml(v.code)}</div></div>
              <div class="share"><input readonly value="${escapeHtml(v.link)}" id="link"><button class="btn" data-go="copy">Copy link</button>${'share' in navigator ? '<button class="btn" data-go="share">Share</button>' : ''}</div>
            </div>
            <div id="lineupHost" class="lineup-host" title="Drag to spin"><span class="lineup-hint">⟲ drag to spin</span></div>
            <div class="riders-head"><span class="label">RIDERS ${v.players.length}/${v.settings.maxPlayers}${v.settings.locked ? ' · 🔒 LOCKED' : ''}</span><span class="ready-count">${v.players.filter((p) => p.ready).length}/${v.players.length} ready</span></div>
            <ul class="players">${v.players.map((p) => `<li><i style="background:${hex(p.color)}"></i>${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.id === v.you ? ' <em>(you)</em>' : ''}${p.ready ? ' <span class="ready">✓ ready</span>' : ' <span class="notready">…</span>'}${v.host && p.id !== v.you ? `<button class="kick" data-kick="${escapeHtml(p.id)}" title="Remove from room">✕</button>` : ''}</li>`).join('')}</ul>
            <div class="me-row"><label>Your name <input id="lname" maxlength="16" value="${escapeHtml(v.players.find((p) => p.id === v.you)?.name ?? P.name)}"></label><div class="dots">${colorDots(v.players.find((p) => p.id === v.you)?.color ?? P.color, 'lcolor')}</div><div class="ride-line">Ride: <b>${escapeHtml(vehicleById(P.vehicle ?? 'street').name)}</b> <button class="chip" data-go="garage">Change</button></div></div>
          </div>
          <div class="lobby-main">
            ${raceSummary(v.settings)}
            ${this.optionsPanel(v.settings, v.host, true)}
            <div class="opt room-opts ${v.host ? '' : 'disabled'}"><span>Room</span><div class="chips">${chips('maxPlayers', Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2), v.settings.maxPlayers, (n) => `${n} max`)}</div>
              <label class="check"><input type="checkbox" data-opt="locked" ${v.settings.locked ? 'checked' : ''} ${v.host ? '' : 'disabled'}> 🔒 Lock room</label></div>
            ${v.host ? '' : '<p class="hint">Only the host 👑 can change the world and room settings.</p>'}
          </div>
        </div>
        <div class="row-buttons"><span><button class="btn ghost" data-go="leave">Leave</button> <button class="btn ghost" data-go="tutorial">🎓 How to play</button></span>${v.host
          ? `<button class="btn primary" data-go="lstart">Start for everyone · ${v.players.filter((p) => p.ready).length}/${v.players.length} ready</button>`
          : (() => { const me = v.players.find((p) => p.id === v.you); return me?.ready
            ? '<span class="wait">✓ Ready · waiting for the host…</span> <button class="btn" data-go="unready">Not ready</button>'
            : '<button class="btn primary" data-go="ready">✋ I\'m ready</button>'; })()}</div>`;
      }
      case 'settings':
        return `
        <h2>Settings</h2>
        <div class="opt"><span>Graphics</span><div class="chips">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<button class="chip ${q === this.quality ? 'on' : ''}" data-quality="${q}">${QUALITY[q].label}</button>`).join('')}</div></div>
        <p class="hint">Low turns off shadows and shortens view distance. Use it on laptops, phones and in split screen if it stutters.</p>
        <div class="opt"><span>Assist</span><div class="chips">${ASSIST.map((a, i) => `<button class="chip ${prefs.assist === i ? 'on' : ''}" data-assist="${i}">${a.label}</button>`).join('')}</div></div>
        <p class="hint">Riding assist keeps the bike on the road when you're not steering, glances you off trees instead of stopping dead, and softens crashes. Pro = no help.</p>
        <div class="opt"><span>Nitro</span><div class="chips"><button class="chip ${prefs.nitroToggle ? '' : 'on'}" data-go="nitroHold">Hold</button><button class="chip ${prefs.nitroToggle ? 'on' : ''}" data-go="nitroToggle">Tap to toggle</button></div></div>
        <p class="hint">Toggle mode helps keyboards that ignore 3 keys at once: tap nitro once, then only steer.</p>
        <div class="opt"><span>Camera</span><div class="chips">${CAM_VIEWS.map((v) => `<button class="chip ${(prefs.cams?.[0] ?? 'chase') === v ? 'on' : ''}" data-cam="${v}">${CAM_LABEL[v]}</button>`).join('')}</div></div>
        <p class="hint">Starting view for every player. Switch any time while riding with ${K('V')} (player 2: ${K('L')}, gamepad: right stick ↑). Each player keeps their own last choice.</p>
        <div class="opt"><span>Keyboard</span><div class="chips"><button class="chip ${this.keyTest ? 'on' : ''}" data-go="keytest">⌨ Test keys</button></div></div>
        ${this.keyTest ? `<div class="keytest" data-keytest></div>
        <p class="hint">Hold the keys you play with: each one lights up while the browser receives it. If ${K('←')} goes dark when you also hold ${K('Space')} + ${K('↑')}, your keyboard is <b>ghosting</b> (a hardware limit, many keyboards drop ↑ ← Space together but not ↑ → Space). Fixes: nitro drives by itself so let go of ${K('↑')}; use ${K('W')}${K('A')}${K('S')}${K('D')}; use ${K('N')} or ${K('B')} for nitro; or pick <b>Nitro: Tap to toggle</b> above. Tip: tapping Shift 5× may open Windows Sticky Keys, so prefer ${K('N')}/${K('B')} for tapping.</p>` : ''}
        <div class="opt"><span>Music</span><div class="chips">${([['Off', 0], ['Low', 0.3], ['Med', 0.6], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.music === v ? 'on' : ''}" data-music="${v}">${l}</button>`).join('')}</div></div>
        <div class="opt"><span>Effects</span><div class="chips">${([['Off', 0], ['Low', 0.4], ['Med', 0.7], ['High', 1]] as const).map(([l, v]) => `<button class="chip ${prefs.sfx === v ? 'on' : ''}" data-sfx="${v}">${l}</button>`).join('')}</div></div>
        <p class="hint">All sound is generated live: each vehicle has its own engine (cylinders, gears, turbo, exhaust crackle) and the soundtrack builds with the action.</p>
        <div class="opt"><span>Sound</span><div class="chips"><button class="chip" data-go="mute">${this.muted() ? '🔇 Off' : '🔊 On'}</button></div></div>
        <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button></div>`;
      case 'howto': {
        const row = (k: string, t: string) => `<tr><td>${k}</td><td>${t}</td></tr>`;
        return `
        <h2>How to play</h2>
        <div class="howto">
          <section><h3>🏍 Riding</h3><table class="keys">
            ${row('↑ / W', 'Throttle (walk forward on foot)')}
            ${row('↓ / S', 'Brake, then reverse')}
            ${row('← → / A D', 'Steer. Eases in, full grip at any speed. Wet or snowy roads have less grip')}
            ${row('E', 'Get on / off your bike or car')}
            ${row('R', 'Respawn on the nearest road')}
            ${row('Right-drag · wheel', 'Look around · zoom the camera')}
            ${row('V', 'Next camera view (see 🎥 Camera & HUD)')}
          </table></section>
          <section><h3>💨 Nitro</h3><table class="keys">
            ${row('Space / Shift / N / B', 'Hold for nitro. It drives the vehicle by itself, so nitro + ←/→ is enough: no need to hold ↑')}
            ${row('Settings → Nitro', '"Tap to toggle": tap once, then only steer (fixes keyboards that drop 3 keys at once)')}
            ${row('Settings → ⌨ Test keys', 'Steer works one way only while boosting? Your keyboard is ghosting (often ↑ ← Space). Let go of ↑, use WASD, or N / B for nitro')}
            ${row('Space (on foot)', 'Jump')}
          </table></section>
          <section><h3>🤸 Wheelies (motorcycles)</h3><table class="keys">
            ${row('1. Lift', 'Hold C on the ground at any speed above ~15 km/h, even flat out with nitro. The front comes up by itself and holds there')}
            ${row('2. Angle', '↑ lifts it higher, ↓ lowers it. During a wheelie ↓ does NOT brake, and the throttle stays on, so you keep your speed')}
            ${row('3. Steer', '←/→ still steer (slightly softer), so you can wheelie through high-speed runs')}
            ${row('4. Land', 'Release C: the front comes down smoothly. Over 0.8 s earns XP, time in the GREEN band = PERFECT BALANCE, averaging over 120 km/h = HIGH-SPEED WHEELIE bonus')}
            ${row('⚠ Assist', 'Normal/Easy: wheelie control stops you looping out, the needle can touch the red but gets pulled back. Pro: real balance physics, hold ↑ too long and you flip over backwards')}
            ${row('Note', 'Every bike except the Thunder Cruiser can wheelie. Cars cannot')}
          </table></section>
          <section><h3>🌀 Drifting (cars and bikes)</h3><table class="keys">
            ${row('1. Entry', 'Turn in at speed and tap X (handbrake), or flick ← then → quickly (feint), or lift off / brake mid-corner')}
            ${row('2. Hold it', 'Steer AGAINST the slide (counter-steer) to hold the angle; throttle pushes the tail out, lifting tucks it in')}
            ${row('3. Score', 'Angle × speed × zone bonus × smoothness. +25% CLOSE to walls, +50% TANDEM next to another driver')}
            ${row('4. Bank', 'Straighten up for a moment to bank the points (NICE / GREAT / INSANE). Hitting a wall loses the chain')}
            ${row('Best cars', 'Kitsune S-Spec, Panda 86, Brute V8, Kaze 7R slide easiest; GT3 and Hyper grip hard')}
            ${row('Assist', 'Settings → Assist: Normal/Easy hold your angle; Pro lets you spin out')}
          </table></section>
          <section><h3>🏎 Formula 1</h3><table class="keys">
            ${row('Start', 'Five red lights come on one per second, then a random pause. Go on LIGHTS OUT; rolling early = +5 s penalty')}
            ${row('Downforce', 'The faster you go, the more grip: fast corners are flat-out, slow hairpins need hard braking (~5 g)')}
            ${row('C · DRS', 'In DRS zones (main straights) opens the rear wing: less drag, higher top speed. Closes when you brake')}
            ${row('Space · ERS', 'Deploys electric boost. ERS recharges while braking')}
            ${row('Slipstream', 'Follow close behind another car: less drag, "SLIP" lights up. Pull out to pass')}
            ${row('Tyres', 'Soft = fastest, wears out quickly. Medium = balanced. Hard = slow but lasts. Sliding and locking up add wear; worn tyres lose grip')}
            ${row('Pit stop', 'Drive into the pit lane (80 km/h limiter), stop in the box: fresh tyres in ~2.6 s, ERS refilled')}
            ${row('Grid', 'Up to 15 AI rivals with their own racing lines; the timing tower shows positions and gaps')}
          </table></section>
          <section><h3>🛫 Air tricks</h3><table class="keys">
            ${row('Hands off', 'The bike levels itself and lands straight')}
            ${row('↑ / ↓', 'After takeoff let go, then press to flip (backflip / frontflip)')}
            ${row('← / →', 'Spin (360°). Flip + spin in one jump = CORKSCREW bonus')}
            ${row('C in the air', 'Style trick: alone = No-Hander, + ↑ = Superman, + ↓ = Heel Clicker. Let go before landing')}
            ${row('Combo', 'Land tricks within 5 s of each other to multiply the score')}
          </table></section>
          <section><h3>🔫 Combat & upgrades</h3><table class="keys">
            ${row('F / left click', 'Fire. Auto-aims at the red reticle and leads moving drones. ✕ hit, red ✕ kill')}
            ${row('Q', 'Next weapon. Rocket unlocks at Lv2, Railgun 3, Swarm 4, Mine 5')}
            ${row('Level up', 'Cards appear and time slows. 1 / 2 / 3 picks, T rerolls (2 per run)')}
            ${row('Tab', 'Put cards away / open them again later ("upgrade ready" badge)')}
          </table></section>
          <section><h3>👥 Player 2 (split screen)</h3><table class="keys">
            ${row('Arrows', 'Drive / steer')}
            ${row('Right Shift / Num0', 'Nitro · jump')}
            ${row('/ · Enter · .', 'Fire · get on/off · next weapon')}
            ${row("' · ;", 'Trick / wheelie · handbrake drift')}
            ${row('8 9 0 · \\ · ]', 'Pick cards · open/close cards · reroll')}
            ${row('Backspace', 'Respawn')}
            ${row('L / Num .', 'Next camera view')}
          </table></section>
          <section><h3>🎥 Camera & HUD</h3><table class="keys">
            ${row('V (P2: L)', 'Cycle views: Chase → Far chase → Hood → First person → Cinematic → Top-down. Your choice is remembered; set the starting view in Settings')}
            ${row('First person', 'Bikes: rider\'s helmet view, leans with the bike and follows wheelies and flips. Cars: driver\'s seat. F1: cockpit behind the halo')}
            ${row('Hood', 'Low camera on the front of the vehicle: best feel for speed and lines')}
            ${row('Cinematic', 'TV-style trackside shots that cut ahead of you; slow orbit when stopped')}
            ${row('Right-drag · wheel', 'Look around in any view · zoom (chase views)')}
            ${row('Gauges', 'Bottom right: speedometer with nitro ring, rev counter with redline and gear, NOS / AIR lights. F1 cars use the F1 dash instead')}
            ${row('On foot', 'Hood / first person switch to the chase camera until you ride again')}
          </table></section>
          <section><h3>🎮 Gamepad</h3><table class="keys">
            ${row('A / RT · LT', 'Throttle · brake')}
            ${row('Left stick / D-pad', 'Steer (and flips/spins in the air)')}
            ${row('B / RB', 'Nitro · jump')}
            ${row('X · Y', 'Fire · get on/off')}
            ${row('LB · L3', 'Handbrake drift · trick / wheelie')}
            ${row('R3 · Back · Start', 'Cards · next weapon · pause')}
            ${row('Right stick ← → · ↑', 'Look around · next camera view')}
          </table></section>
          <section><h3>🗺 Modes</h3><p class="hint">
            <b>Open world:</b> story chapters, timed challenges, drones, gas stations (refuel), villages, stunt zones.<br>
            <b>Race:</b> pass every blue gate in order; checkered gate = start/finish; beat your ghost.<br>
            <b>Drift:</b> 8 venues with zones (×1.5–2.3). Points bank when you straighten.<br>
            <b>Power-ups:</b> green repair · blue shield · yellow magnet · pink double XP.<br>
            <b>Esc / Start:</b> pause (resume, settings, controls, respawn, quit) · <b>M</b> mute · <b>H</b> show/hide the key card.
          </p></section>
        </div>
        <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button></div>`;
      }
      case 'pause':
        return `
        <h2>Paused</h2>
        <div class="big-buttons">
          <button class="btn primary" data-go="resume">Resume</button>
          <button class="btn" data-go="respawn">Respawn on road</button>
          <button class="btn" data-go="settings">Settings</button>
          <button class="btn" data-go="howto">Controls</button>
          <button class="btn ghost" data-go="quit">Quit to menu</button>
        </div>`;
      case 'results': {
        const rows = data as Standing[];
        return `
        <h2>🏁 Race results</h2>
        <table class="results">${rows.map((r, i) => `<tr><td>${['🥇', '🥈', '🥉'][i] ?? i + 1}</td><td><i style="background:${hex(r.color)}"></i>${escapeHtml(r.name)}</td><td>${r.time !== null ? fmt(r.time) : 'racing…'}</td></tr>`).join('')}</table>
        <div class="row-buttons"><button class="btn ghost" data-go="quit">Menu</button><button class="btn primary" data-go="again">Race again</button></div>`;
      }
      case 'loading':
        return `<div class="logo small">MOTO<span>INFINITE</span></div><p class="loading">${escapeHtml(String(data ?? 'Generating world…'))}</p><div class="spinner"></div>`;
    }
  }

  // ---------------------------------------------------------------- input
  private myColor() {
    return this.lobby?.players.find((p) => p.id === this.lobby!.you)?.color ?? this.profile.color;
  }

  private readNames() {
    const P = this.profile;
    const n1 = this.root.querySelector<HTMLInputElement>('#pname') ?? this.root.querySelector<HTMLInputElement>('#jname'), n2 = this.root.querySelector<HTMLInputElement>('#pname2');
    if (n1) P.name = n1.value.trim().slice(0, 16) || 'Rider';
    if (n2) P.name2 = n2.value.trim().slice(0, 16) || 'Player 2';
    this.a.saveProfile(P);
  }

  private setOpt(key: string, val: string | boolean) {
    const editingLobby = this.screen === 'lobby' && this.lobby;
    if (editingLobby && !this.lobby!.host) return;
    const s: LobbySettings = editingLobby ? { ...this.lobby!.settings } : this.setup;
    const weatherBefore = s.weather;
    switch (key) {
      case 'mode': {
        s.mode = val as GameMode;
        if (s.mode === 'drift' && !DRIFT_TRACKS.some((t) => t.id === s.trackId)) s.trackId = 'docks';
        if (s.mode === 'race' && !TRACKS.some((t) => t.id === s.trackId)) s.trackId = 'coast';
        if (s.mode === 'f1' && !F1_TRACKS.some((t) => t.id === s.trackId)) s.trackId = 'monza';
        const ft = F1_TRACKS.find((t) => t.id === s.trackId);
        if (s.mode === 'f1' && ft) { s.time = ft.time; s.weather = ft.weather; s.theme = ft.theme; s.laps = ft.laps; }
        const dt = DRIFT_TRACKS.find((t) => t.id === s.trackId);
        if (s.mode === 'drift' && dt && dt.id !== 'random') { s.time = dt.time; s.weather = dt.weather; s.theme = dt.theme; }
        break;
      }
      case 'theme': s.theme = val as WorldTheme; break;
      case 'trackId': {
        s.trackId = String(val);
        const f1t = F1_TRACKS.find((x) => x.id === s.trackId);
        if (s.mode === 'f1' && f1t) { s.time = f1t.time; s.weather = f1t.weather; s.theme = f1t.theme; s.laps = f1t.laps; break; }
        const dtr = DRIFT_TRACKS.find((x) => x.id === s.trackId);
        if (s.mode === 'drift' && dtr) {
          if (dtr.id !== 'random') { s.time = dtr.time; s.weather = dtr.weather; s.theme = dtr.theme; } else s.seed = newSeed();
          break;
        }
        const t = TRACKS.find((x) => x.id === s.trackId);
        if (t && t.id !== 'random') { s.time = t.time; s.weather = t.weather; s.theme = t.theme; }
        if (t?.id === 'random') s.seed = newSeed();
        break;
      }
      case 'laps': s.laps = +val; break;
      case 'lapsCustom': s.laps = Math.max(1, Math.min(50, Math.round(+val) || 1)); break;
      case 'time': s.time = val as TimeOfDay; break;
      case 'weather': {
        // tap to add/remove a weather; picked ones layer together. Clear and Changing stand alone.
        const w = val as Weather;
        if (w === 'dynamic' || w === 'clear') { s.weather = w; s.weathers = undefined; break; }
        const cur = activeWeathers(s).filter((x) => x !== 'clear');
        const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].slice(-4);
        s.weather = next[0] ?? 'clear';
        s.weathers = next.length > 1 ? next : undefined;
        break;
      }
      case 'pvp': s.pvp = !!val; break;
      case 'seed': s.seed = newSeed(); break;
      case 'maxPlayers': s.maxPlayers = +val; break;
      case 'drones': s.drones = +val; break;
      case 'ai': s.ai = +val; break;
      case 'session': s.session = val as 'race' | 'quali'; break;
      case 'tyre': s.tyre = val as 'soft' | 'medium' | 'hard'; break;
      case 'locked': s.locked = !!val; break;
      case 'gen': s.gen = { ...s.gen, [this.genKey]: +val }; break;
      case 'surprise': {
        const pick = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];
        s.seed = newSeed();
        s.theme = pick(THEMES);
        s.time = pick(TIMES);
        s.weather = pick(WEATHERS);
        s.weathers = Math.random() < 0.3 && s.weather !== 'dynamic' && s.weather !== 'clear' ? [s.weather, pick(FIXED_WEATHERS.filter((w) => w !== s.weather && w !== 'clear'))] : undefined;
        s.gen = { ...s.gen };
        for (const k of Object.keys(GEN_MAX) as (keyof WorldGen)[]) s.gen[k] = Math.floor(Math.random() * (GEN_MAX[k] + 1));
        if (s.gen.poi === 0) s.gen.poi = 1;
        break;
      }
    }
    if (key !== 'weather' && key !== 'surprise' && s.weather !== weatherBefore) s.weathers = undefined;
    if (editingLobby) this.a.lobbySettings(s);
    else this.show('mode');
  }

  private change(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.opt === 'lapsCustom') this.setOpt('lapsCustom', t.value);
    else if (t.dataset.opt === 'pvp' || t.dataset.opt === 'locked') this.setOpt(t.dataset.opt, t.checked);
    else if (t.id === 'lname') this.a.updateProfile(t.value.trim().slice(0, 16) || 'Rider', this.myColor(), this.profile.vehicle);
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || (t as HTMLButtonElement).disabled || t.closest('.disabled')) return;
    const d = t.dataset, P = this.profile, st = this.setup;
    if (d.opt) {
      this.genKey = (d.key as keyof WorldGen) ?? 'terrain';
      return this.setOpt(d.opt, d.val ?? '');
    }
    if (d.kick) return this.a.kick(d.kick);
    if (d.f1car) { P.f1car = d.f1car; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.gkind) { this.garageKind = d.gkind as VehicleKind; return this.show('garage'); }
    if (d.veh) {
      if (this.garageFor === 2) P.vehicle2 = d.veh;
      else P.vehicle = d.veh;
      this.a.saveProfile(P);
      return this.show('garage');
    }
    if (d.lcolor) {
      const name = this.root.querySelector<HTMLInputElement>('#lname')?.value.trim().slice(0, 16) || 'Rider';
      P.color = +d.lcolor;
      this.a.saveProfile(P);
      return this.a.updateProfile(name, P.color, P.vehicle);
    }
    if (d.color) { this.readNames(); P.color = +d.color; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.color2) { this.readNames(); P.color2 = +d.color2; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.music !== undefined) { prefs.music = +d.music; savePrefs(); this.a.volumes(); return this.show('settings'); }
    if (d.sfx !== undefined) { prefs.sfx = +d.sfx; savePrefs(); this.a.volumes(); return this.show('settings'); }
    if (d.cam && isCamView(d.cam)) { prefs.cams = [d.cam, d.cam]; savePrefs(); return this.show('settings'); }
    if (d.assist) { prefs.assist = +d.assist; savePrefs(); return this.show('settings'); }
    if (d.quality) { this.quality = d.quality as QualityName; this.a.setQuality(this.quality); return this.show('settings'); }
    switch (d.go) {
      case 'solo': this.readNames(); st.split = false; return this.show('mode');
      case 'split': this.readNames(); st.split = true; return this.show('mode');
      case 'online': this.readNames(); return this.show('online');
      case 'howto': case 'settings': this.back = this.screen === 'pause' ? 'pause' : 'home'; return this.show(d.go);
      case 'back': return this.show(this.back);
      case 'home': this.readNames(); return this.show('home');
      case 'start': this.readNames(); return this.a.startLocal({ ...st });
      case 'create': return this.a.createRoom();
      case 'join': {
        const code = this.root.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        return code ? this.a.joinRoom(code) : undefined;
      }
      case 'copy': {
        const link = this.root.querySelector<HTMLInputElement>('#link')!;
        navigator.clipboard?.writeText(link.value).then(() => (t.textContent = 'Copied!'), () => link.select());
        return;
      }
      case 'share': {
        const link = this.root.querySelector<HTMLInputElement>('#link')!.value;
        void navigator.share?.({ title: 'Moto Infinite', text: 'Ride with me in Moto Infinite!', url: link }).catch(() => undefined);
        return;
      }
      case 'tutorial': this.readNames(); this.slide = 0; this.obBack = this.screen === 'lobby' || this.screen === 'joinroom' ? this.screen : 'home'; return this.show('onboard');
      case 'ready': return this.a.setReady(true);
      case 'unready': return this.a.setReady(false);
      case 'garage': case 'garage2':
        this.readNames();
        this.garageFor = d.go === 'garage2' ? 2 : 1;
        this.garageBack = this.screen;
        this.garageKind = vehicleById((this.garageFor === 2 ? P.vehicle2 : P.vehicle) ?? 'street').kind;
        return this.show('garage');
      case 'hearEngine': return this.a.hearEngine((this.garageFor === 2 ? P.vehicle2 : P.vehicle) ?? 'street');
      case 'garageDone':
        if (this.garageBack === 'lobby' && this.lobby) {
          const me = this.lobby.players.find((p) => p.id === this.lobby!.you);
          this.a.updateProfile(me?.name ?? P.name, me?.color ?? P.color, P.vehicle);
          return this.show('lobby');
        }
        return this.show(this.garageBack);
      case 'joinnow': this.readNames(); return this.a.joinRoom(this.joinCode);
      case 'tnext': this.slide = Math.min(SLIDES.length - 1, this.slide + 1); return this.show('onboard');
      case 'tprev': this.slide = Math.max(0, this.slide - 1); return this.show('onboard');
      case 'skip':
        prefs.onboarded = true;
        savePrefs();
        if (this.obBack === 'lobby' && this.lobby) return this.show('lobby');
        return this.obBack === 'joinroom' ? this.show('joinroom') : this.show('home');
      case 'train': prefs.onboarded = true; savePrefs(); return this.a.startTraining();
      case 'nitroHold': prefs.nitroToggle = false; savePrefs(); return this.show('settings');
      case 'nitroToggle': prefs.nitroToggle = true; savePrefs(); return this.show('settings');
      case 'keytest':
        this.keyTest = !this.keyTest;
        this.show('settings');
        (document.activeElement as HTMLElement | null)?.blur(); // Space must not re-press the button
        return;
      case 'leave': return this.a.leaveRoom();
      case 'lstart': return this.a.lobbyStart();
      case 'mute': this.a.toggleMute(); return this.show('settings');
      case 'resume': return this.a.resume();
      case 'respawn': return this.a.respawn();
      case 'quit': return this.a.quit();
      case 'again': return this.a.raceAgain();
    }
  }
}
