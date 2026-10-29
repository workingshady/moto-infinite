// Landing page, game setup (shared by solo, split screen and online lobby), settings, pause and results.
// Plain DOM: each screen is a template string; clicks are handled by data-attributes in one place.
import { PLAYER_COLORS, QUALITY, THEME_DEFS, TRACKS, WEATHER_DEFS, type QualityName } from '../config';
import { THEMES, TIMES, WEATHERS, type GameMode, type LobbySettings, type PlayerInfo, type TimeOfDay, type Weather, type WorldTheme } from '../../shared/protocol';
import type { Standing } from '../systems/Race';
import { fmt } from '../systems/Race';
import { escapeHtml, hex } from '../utils/math';
import { STORY } from '../data/story';
import { CharacterPreview, drawMapPreview } from './Preview';

export interface Profile { name: string; color: number; name2: string; color2: number }
export type Setup = LobbySettings & { split: boolean };

export interface MenuActions {
  startLocal(setup: Setup): void;
  createRoom(): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  lobbySettings(s: LobbySettings): void;
  lobbyStart(): void;
  resume(): void;
  quit(): void;
  raceAgain(): void;
  setQuality(q: QualityName): void;
  toggleMute(): boolean;
  saveProfile(p: Profile): void;
}

type Screen = 'home' | 'mode' | 'online' | 'lobby' | 'settings' | 'howto' | 'pause' | 'results' | 'loading';
interface LobbyView { code: string; link: string; players: PlayerInfo[]; settings: LobbySettings; host: boolean; you: string }

const TIME_LABEL: Record<TimeOfDay, string> = { day: '☀️ Day', dawn: '🌅 Dawn', sunset: '🌇 Sunset', night: '🌙 Night', cycle: '🔄 Live cycle' };
const WEATHER_ICON: Record<Weather, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', fog: '🌫️', snow: '❄️', storm: '⛈️', dynamic: '🎲' };
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
  private setup: Setup = { split: false, mode: 'open', trackId: 'coast', laps: 3, pvp: false, seed: newSeed(), time: 'day', weather: 'clear', theme: 'mixed' };
  private lobby: LobbyView | null = null;
  private preview = new CharacterPreview();
  inGame = false;

  constructor(private a: MenuActions, public profile: Profile, public quality: QualityName, private muted: () => boolean) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('change', (e) => this.change(e));
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
    this.root.className = s === 'pause' || s === 'results' ? 'overlay dim' : 'overlay';
    const wide = s === 'home' || s === 'mode' || s === 'lobby';
    this.root.innerHTML = `<div class="card-wrap ${wide ? 'wide' : ''}">${this.render(s, data)}</div>`;
    this.afterRender();
  }

  showLobby(v: LobbyView) {
    this.lobby = v;
    if (this.screen === 'lobby' && this.visible) this.refreshLobby();
    else this.show('lobby');
  }

  /** Re-render the lobby in place when players or settings change. */
  private refreshLobby() {
    this.root.querySelector('.card-wrap')!.innerHTML = this.render('lobby');
    this.afterRender();
  }

  private afterRender() {
    const host = this.root.querySelector<HTMLElement>('#charHost');
    if (host) {
      this.preview.setColor(this.profile.color);
      this.preview.mount(host);
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
    return `
    <div class="setup">
      <div class="setup-opts ${dis}">
        <div class="modes">
          <button class="mode ${s.mode === 'open' ? 'on' : ''}" data-opt="mode" data-val="open"><b>🌄 Open world</b><span>Endless roads, story chapters, drones, challenges, level-ups</span></button>
          <button class="mode ${s.mode === 'race' ? 'on' : ''}" data-opt="mode" data-val="race"><b>🏁 Circuit race</b><span>Closed loop, checkpoint gates, laps, positions, best-lap ghost</span></button>
        </div>
        ${s.mode === 'open' ? `
        <div class="opt"><span>World</span><div class="chips">${chips('theme', THEMES, s.theme, (t) => THEME_DEFS[t].label)}</div></div>
        <p class="hint">${THEME_DEFS[s.theme].blurb}</p>
        <div class="opt"><span>Map</span><div class="chips"><button class="chip" data-opt="seed" data-val="new">🎲 New random world</button></div></div>` : `
        <div class="opt"><span>Track</span><div class="chips">${chips('trackId', TRACKS.map((t) => t.id), s.trackId, (id) => TRACKS.find((t) => t.id === id)!.name)}</div></div>
        <p class="hint">${track.blurb}${s.trackId === 'random' ? ' <button class="chip" data-opt="seed" data-val="new">🎲 Reroll</button>' : ''}</p>
        <div class="opt"><span>Laps</span><div class="chips">${chips('laps', LAPS, customLaps ? -1 : s.laps, (n) => `${n}`)}
          <label class="custom ${customLaps ? 'on' : ''}">Custom <input type="number" min="1" max="50" value="${s.laps}" data-opt="lapsCustom" ${dis}></label></div></div>`}
        <div class="opt"><span>Time</span><div class="chips">${chips('time', TIMES, s.time, (t) => TIME_LABEL[t])}</div></div>
        <div class="opt"><span>Weather</span><div class="chips">${chips('weather', WEATHERS, s.weather, (w) => `${WEATHER_ICON[w]} ${w === 'dynamic' ? 'Changing' : WEATHER_DEFS[w].label}`)}</div></div>
        ${showPvp ? `<label class="check"><input type="checkbox" data-opt="pvp" ${s.pvp ? 'checked' : ''} ${dis}> Riders can shoot each other</label>` : ''}
      </div>
      <div class="setup-map">
        <canvas id="mapCanvas" width="280" height="280"></canvas>
        <div class="dim small" id="mapInfo">Drawing map…</div>
      </div>
    </div>`;
  }

  private render(s: Screen, data?: unknown): string {
    const P = this.profile;
    switch (s) {
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
            <div class="big-buttons">
              <button class="btn primary" data-go="solo">▶ Play solo</button>
              <button class="btn" data-go="split">👥 2 players · split screen</button>
              <button class="btn" data-go="online">🌐 Online room · invite friends</button>
            </div>
            <div class="row-buttons"><button class="btn ghost" data-go="howto">How to play</button><button class="btn ghost" data-go="settings">Settings</button></div>
          </div>
          <div class="hero-right">
            <div id="charHost" class="char-host"></div>
            <div class="dim small center">Drag to spin · pick a colour on the left</div>
            <ul class="features"><li>🌦 Live weather & day/night</li><li>🏁 5 circuits + random tracks</li><li>🗺 5 world themes, endless map</li><li>🔫 6 weapons, 3 drone types</li></ul>
          </div>
        </div>`;
      case 'mode': {
        const st = this.setup;
        return `
        <h2>${st.split ? '👥 2 players · split screen' : '▶ Solo'}</h2>
        ${st.split ? `<div class="profile"><label>Player 2 <input id="pname2" maxlength="16" value="${escapeHtml(P.name2)}"></label><div class="dots">${colorDots(P.color2, 'color2')}</div></div>` : ''}
        ${this.optionsPanel(st, true, st.split)}
        ${st.split ? `<p class="hint">P1: WASD · Space/Shift nitro · F fire · E ride · Q weapon &nbsp;|&nbsp; P2: Arrows · Right Shift nitro · / fire · Enter ride · . weapon · Gamepads work too.</p>` : ''}
        <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button><button class="btn primary" data-go="start">Ride →</button></div>`;
      }
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
        <div class="lobby-head">
          <div><h2>Lobby</h2><div class="dim small">Room code</div><div class="roomcode">${escapeHtml(v.code)}</div></div>
          <ul class="players">${v.players.map((p) => `<li><i style="background:${hex(p.color)}"></i>${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.id === v.you ? ' <em>(you)</em>' : ''}</li>`).join('')}</ul>
        </div>
        <div class="share"><input readonly value="${escapeHtml(v.link)}" id="link"><button class="btn" data-go="copy">Copy link</button>${'share' in navigator ? '<button class="btn" data-go="share">Share</button>' : ''}</div>
        ${this.optionsPanel(v.settings, v.host, true)}
        <div class="row-buttons"><button class="btn ghost" data-go="leave">Leave</button>${v.host ? `<button class="btn primary" data-go="lstart">Start for everyone (${v.players.length})</button>` : '<span class="wait">⏳ Waiting for the host to start…</span>'}</div>`;
      }
      case 'settings':
        return `
        <h2>Settings</h2>
        <div class="opt"><span>Graphics</span><div class="chips">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<button class="chip ${q === this.quality ? 'on' : ''}" data-quality="${q}">${QUALITY[q].label}</button>`).join('')}</div></div>
        <p class="hint">Low turns off shadows and shortens view distance. Use it on laptops, phones and in split screen if it stutters.</p>
        <div class="opt"><span>Sound</span><div class="chips"><button class="chip" data-go="mute">${this.muted() ? '🔇 Off' : '🔊 On'}</button></div></div>
        <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button></div>`;
      case 'howto':
        return `
        <h2>How to play</h2>
        <table class="keys">
          <tr><td>↑ ↓ / W S</td><td>Throttle · brake/reverse · walk</td></tr>
          <tr><td>← → / A D</td><td>Steer (wet and snowy roads have less grip)</td></tr>
          <tr><td>Shift / Space</td><td>Nitro (riding) · Space = jump (walking)</td></tr>
          <tr><td>F / left click</td><td>Fire. Auto-aims and leads moving targets; ✕ = hit, red ✕ = kill</td></tr>
          <tr><td>Q / 1-3</td><td>Next weapon / pick a level-up card</td></tr>
          <tr><td>E</td><td>Get on / off the bike</td></tr>
          <tr><td>In the air</td><td>Release, then ↑↓ to flip and ←→ to spin. Hands off = bike levels itself</td></tr>
          <tr><td>R</td><td>Respawn on the nearest road</td></tr>
          <tr><td>Right drag · wheel</td><td>Look around · zoom</td></tr>
          <tr><td>Esc / Start</td><td>Pause menu</td></tr>
          <tr><td>M · H</td><td>Mute · hide help</td></tr>
        </table>
        <p class="hint"><b>Open world:</b> ride anywhere, follow the story chapters, finish timed challenges, level up and unlock weapons (Rocket 2, Railgun 3, Swarm 4, Mine 5). Scouts are fast, gunners shoot, bombers drop bombs.<br>
        <b>Race:</b> pass every blue gate in order, the yellow gate is start/finish. Your best lap is saved as a ghost.<br>
        <b>Power-ups:</b> green repair · blue shield · yellow magnet · pink double XP.</p>
        <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button></div>`;
      case 'pause':
        return `
        <h2>Paused</h2>
        <div class="big-buttons">
          <button class="btn primary" data-go="resume">Resume</button>
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
  private readNames() {
    const P = this.profile;
    const n1 = this.root.querySelector<HTMLInputElement>('#pname'), n2 = this.root.querySelector<HTMLInputElement>('#pname2');
    if (n1) P.name = n1.value.trim().slice(0, 16) || 'Rider';
    if (n2) P.name2 = n2.value.trim().slice(0, 16) || 'Player 2';
    this.a.saveProfile(P);
  }

  private setOpt(key: string, val: string | boolean) {
    const editingLobby = this.screen === 'lobby' && this.lobby;
    if (editingLobby && !this.lobby!.host) return;
    const s: LobbySettings = editingLobby ? { ...this.lobby!.settings } : this.setup;
    switch (key) {
      case 'mode': s.mode = val as GameMode; break;
      case 'theme': s.theme = val as WorldTheme; break;
      case 'trackId': {
        s.trackId = String(val);
        const t = TRACKS.find((x) => x.id === s.trackId);
        if (t && t.id !== 'random') { s.time = t.time; s.weather = t.weather; s.theme = t.theme; }
        if (t?.id === 'random') s.seed = newSeed();
        break;
      }
      case 'laps': s.laps = +val; break;
      case 'lapsCustom': s.laps = Math.max(1, Math.min(50, Math.round(+val) || 1)); break;
      case 'time': s.time = val as TimeOfDay; break;
      case 'weather': s.weather = val as Weather; break;
      case 'pvp': s.pvp = !!val; break;
      case 'seed': s.seed = newSeed(); break;
    }
    if (editingLobby) this.a.lobbySettings(s);
    else this.show('mode');
  }

  private change(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.opt === 'lapsCustom') this.setOpt('lapsCustom', t.value);
    else if (t.dataset.opt === 'pvp') this.setOpt('pvp', t.checked);
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || (t as HTMLButtonElement).disabled || t.closest('.disabled')) return;
    const d = t.dataset, P = this.profile, st = this.setup;
    if (d.opt) return this.setOpt(d.opt, d.val ?? '');
    if (d.color) { this.readNames(); P.color = +d.color; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.color2) { this.readNames(); P.color2 = +d.color2; this.a.saveProfile(P); return this.show(this.screen); }
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
      case 'leave': return this.a.leaveRoom();
      case 'lstart': return this.a.lobbyStart();
      case 'mute': this.a.toggleMute(); return this.show('settings');
      case 'resume': return this.a.resume();
      case 'quit': return this.a.quit();
      case 'again': return this.a.raceAgain();
    }
  }
}
