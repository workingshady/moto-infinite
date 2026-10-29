// Landing page, mode select, online lobby, settings, pause and results screens (plain DOM, no framework).
import { PLAYER_COLORS, QUALITY, TRACKS, type QualityName } from '../config';
import type { GameMode, LobbySettings, PlayerInfo } from '../../shared/protocol';
import type { Standing } from '../systems/Race';
import { fmt } from '../systems/Race';
import { escapeHtml, hex } from '../utils/math';

export interface Profile { name: string; color: number; name2: string; color2: number }
export interface LocalSetup { split: boolean; mode: GameMode; trackId: string; laps: number; pvp: boolean }

export interface MenuActions {
  startLocal(setup: LocalSetup): void;
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

const trackOptions = (sel: string) => TRACKS.map((t) => `<button class="chip ${t.id === sel ? 'on' : ''}" data-track="${t.id}">${t.name}</button>`).join('');
const lapOptions = (sel: number) => [1, 3, 5].map((n) => `<button class="chip ${n === sel ? 'on' : ''}" data-laps="${n}">${n} lap${n > 1 ? 's' : ''}</button>`).join('');
const colorDots = (sel: number, attr: string) => PLAYER_COLORS.map((c) => `<button class="dot ${c === sel ? 'on' : ''}" style="background:${hex(c)}" data-${attr}="${c}" aria-label="colour"></button>`).join('');

export class Menu {
  readonly root: HTMLDivElement;
  private screen: Screen = 'home';
  private back: Screen = 'home';
  private setup: LocalSetup = { split: false, mode: 'open', trackId: 'coast', laps: 3, pvp: false };
  inGame = false;

  constructor(private a: MenuActions, public profile: Profile, public quality: QualityName, private muted: () => boolean) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.click(e));
  }

  get visible() {
    return this.root.style.display !== 'none';
  }

  hide() {
    this.root.style.display = 'none';
  }

  show(s: Screen, data?: unknown) {
    this.root.style.display = '';
    this.screen = s;
    this.root.className = s === 'pause' || s === 'results' ? 'overlay dim' : 'overlay';
    this.root.innerHTML = `<div class="card-wrap">${this.render(s, data)}</div>`;
    this.root.querySelector<HTMLInputElement>('input[autofocus]')?.focus();
  }

  private render(s: Screen, data?: unknown): string {
    const P = this.profile;
    switch (s) {
      case 'home':
        return `
        <div class="logo">MOTO<span>INFINITE</span></div>
        <p class="tag">Endless open world · stunts · weapons · races · split screen · online rooms</p>
        <div class="profile">
          <label>Rider name <input id="pname" maxlength="16" value="${escapeHtml(P.name)}"></label>
          <div class="dots">${colorDots(P.color, 'color')}</div>
        </div>
        <div class="big-buttons">
          <button class="btn primary" data-go="solo">▶ Play solo</button>
          <button class="btn" data-go="split">👥 2 players · split screen</button>
          <button class="btn" data-go="online">🌐 Online room</button>
        </div>
        <div class="row-buttons">
          <button class="btn ghost" data-go="howto">How to play</button>
          <button class="btn ghost" data-go="settings">Settings</button>
        </div>`;
      case 'mode': {
        const st = this.setup;
        return `
        <h2>${st.split ? '2 players · split screen' : 'Solo'}</h2>
        ${st.split ? `<div class="profile"><label>Player 2 <input id="pname2" maxlength="16" value="${escapeHtml(P.name2)}"></label><div class="dots">${colorDots(P.color2, 'color2')}</div></div>` : ''}
        <div class="modes">
          <button class="mode ${st.mode === 'open' ? 'on' : ''}" data-mode="open"><b>🌄 Open world</b><span>Endless roads, ramps, drones, challenges and level-ups</span></button>
          <button class="mode ${st.mode === 'race' ? 'on' : ''}" data-mode="race"><b>🏁 Circuit race</b><span>Closed loop, checkpoints, laps, best-lap ghost</span></button>
        </div>
        ${st.mode === 'race' ? `<div class="opt"><span>Track</span><div class="chips">${trackOptions(st.trackId)}</div></div><div class="opt"><span>Laps</span><div class="chips">${lapOptions(st.laps)}</div></div>` : ''}
        ${st.split ? `<label class="check"><input type="checkbox" id="pvp" ${st.pvp ? 'checked' : ''}> Players can shoot each other</label>` : ''}
        ${st.split ? `<p class="hint">P1: WASD · Space/Shift nitro · F fire · E ride · Q weapon<br>P2: Arrows · Right Shift nitro · / fire · Enter ride · . weapon<br>Gamepads work too (one per player).</p>` : ''}
        <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button><button class="btn primary" data-go="start">Start</button></div>`;
      }
      case 'online':
        return `
        <h2>Online room</h2>
        <p class="hint">Create a room and send the link to friends. Up to 8 riders.</p>
        <div class="big-buttons"><button class="btn primary" data-go="create">Create room</button></div>
        <div class="join"><input id="code" maxlength="8" placeholder="Room code" autocomplete="off" autofocus><button class="btn" data-go="join">Join</button></div>
        <p class="err">${escapeHtml(String(data ?? ''))}</p>
        <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button></div>`;
      case 'lobby': {
        const { code, link, players, settings, host, you } = data as { code: string; link: string; players: PlayerInfo[]; settings: LobbySettings; host: boolean; you: string };
        const dis = host ? '' : 'disabled';
        return `
        <h2>Lobby</h2>
        <div class="roomcode">${escapeHtml(code)}</div>
        <div class="share"><input readonly value="${escapeHtml(link)}" id="link"><button class="btn" data-go="copy">Copy link</button>${'share' in navigator ? '<button class="btn" data-go="share">Share</button>' : ''}</div>
        <ul class="players">${players.map((p) => `<li><i style="background:${hex(p.color)}"></i>${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.id === you ? ' <em>(you)</em>' : ''}</li>`).join('')}</ul>
        <div class="modes small">
          <button class="mode ${settings.mode === 'open' ? 'on' : ''}" data-lmode="open" ${dis}><b>🌄 Open world</b></button>
          <button class="mode ${settings.mode === 'race' ? 'on' : ''}" data-lmode="race" ${dis}><b>🏁 Circuit race</b></button>
        </div>
        ${settings.mode === 'race' ? `<div class="opt"><span>Track</span><div class="chips ${dis}">${trackOptions(settings.trackId)}</div></div><div class="opt"><span>Laps</span><div class="chips ${dis}">${lapOptions(settings.laps)}</div></div>` : ''}
        <label class="check"><input type="checkbox" id="lpvp" ${settings.pvp ? 'checked' : ''} ${dis}> Players can shoot each other</label>
        <div class="row-buttons"><button class="btn ghost" data-go="leave">Leave</button>${host ? `<button class="btn primary" data-go="lstart">Start (${players.length})</button>` : '<span class="wait">Waiting for the host to start…</span>'}</div>`;
      }
      case 'settings':
        return `
        <h2>Settings</h2>
        <div class="opt"><span>Graphics</span><div class="chips">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<button class="chip ${q === this.quality ? 'on' : ''}" data-quality="${q}">${QUALITY[q].label}</button>`).join('')}</div></div>
        <p class="hint">Low turns off shadows and shortens view distance: use it on laptops and phones or in split screen if it stutters.</p>
        <div class="opt"><span>Sound</span><div class="chips"><button class="chip" data-go="mute">${this.muted() ? '🔇 Off' : '🔊 On'}</button></div></div>
        <div class="row-buttons"><button class="btn ghost" data-go="back">← Back</button></div>`;
      case 'howto':
        return `
        <h2>How to play</h2>
        <table class="keys">
          <tr><td>↑ ↓ / W S</td><td>Throttle · brake/reverse · walk</td></tr>
          <tr><td>← → / A D</td><td>Steer</td></tr>
          <tr><td>Shift / Space</td><td>Nitro (riding) · Space = jump (walking)</td></tr>
          <tr><td>F / left click</td><td>Fire (auto-aims at drones, crates, barrels)</td></tr>
          <tr><td>Q / 1-3</td><td>Next weapon / pick level-up card</td></tr>
          <tr><td>E</td><td>Get on / off the bike</td></tr>
          <tr><td>In the air</td><td>Let go, then press ↑↓ to flip and ←→ to spin. With no keys the bike levels itself.</td></tr>
          <tr><td>R</td><td>Respawn on the nearest road</td></tr>
          <tr><td>Right drag · wheel</td><td>Look around · zoom</td></tr>
          <tr><td>Esc / Start</td><td>Pause menu</td></tr>
          <tr><td>M · H</td><td>Mute · hide help</td></tr>
        </table>
        <p class="hint">Weapons unlock as you level: Rocket (2), Railgun (3), Swarm (4), Mine (5). Power-ups: green repair, blue shield, yellow magnet, pink double XP.</p>
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
        <h2>Race results</h2>
        <table class="results">${rows.map((r, i) => `<tr><td>${i + 1}</td><td><i style="background:${hex(r.color)}"></i>${escapeHtml(r.name)}</td><td>${r.time !== null ? fmt(r.time) : 'racing…'}</td></tr>`).join('')}</table>
        <div class="row-buttons"><button class="btn ghost" data-go="quit">Menu</button><button class="btn primary" data-go="again">Race again</button></div>`;
      }
      case 'loading':
        return `<div class="logo small">MOTO<span>INFINITE</span></div><p class="loading">${escapeHtml(String(data ?? 'Generating world…'))}</p>`;
    }
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button, input[type=checkbox]');
    if (!t || (t as HTMLButtonElement).disabled || t.closest('.chips.disabled')) return;
    const d = t.dataset, P = this.profile, st = this.setup;
    const readNames = () => {
      const n1 = this.root.querySelector<HTMLInputElement>('#pname'), n2 = this.root.querySelector<HTMLInputElement>('#pname2');
      if (n1) P.name = n1.value.trim().slice(0, 16) || 'Rider';
      if (n2) P.name2 = n2.value.trim().slice(0, 16) || 'Player 2';
      this.a.saveProfile(P);
    };
    if (d.color) { readNames(); P.color = +d.color; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.color2) { readNames(); P.color2 = +d.color2; this.a.saveProfile(P); return this.show(this.screen); }
    if (d.mode) { readNames(); st.mode = d.mode as GameMode; return this.show('mode'); }
    if (d.track && this.screen === 'mode') { st.trackId = d.track; return this.show('mode'); }
    if (d.laps && this.screen === 'mode') { st.laps = +d.laps; return this.show('mode'); }
    if (d.quality) { this.quality = d.quality as QualityName; this.a.setQuality(this.quality); return this.show('settings'); }
    if (t.id === 'pvp') { st.pvp = (t as HTMLInputElement).checked; return; }
    if (this.screen === 'lobby' && (d.lmode || d.track || d.laps || t.id === 'lpvp')) return this.lobbyChange(d, t);
    switch (d.go) {
      case 'solo': readNames(); st.split = false; return this.show('mode');
      case 'split': readNames(); st.split = true; return this.show('mode');
      case 'online': readNames(); return this.show('online');
      case 'howto': case 'settings': this.back = this.screen === 'pause' ? 'pause' : 'home'; return this.show(d.go);
      case 'back': return this.show(this.back);
      case 'home': readNames(); return this.show('home');
      case 'start': readNames(); return this.a.startLocal({ ...st });
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

  private lobbyData: { settings: LobbySettings } | null = null;
  showLobby(data: { code: string; link: string; players: PlayerInfo[]; settings: LobbySettings; host: boolean; you: string }) {
    this.lobbyData = data;
    this.show('lobby', data);
  }

  private lobbyChange(d: DOMStringMap, t: HTMLElement) {
    if (!this.lobbyData) return;
    const s = { ...this.lobbyData.settings };
    if (d.lmode) s.mode = d.lmode as GameMode;
    if (d.track) s.trackId = d.track;
    if (d.laps) s.laps = +d.laps;
    if (t.id === 'lpvp') s.pvp = (t as HTMLInputElement).checked;
    this.a.lobbySettings(s);
  }

  get current() {
    return this.screen;
  }
}
