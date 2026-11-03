// Online social layer, alive while connected to a room: chat (ChatPanel), quick-chat + emotes, the player list
// with pings (Tab / 👥), local mutes, the "Reconnecting…" banner and the spectate bar. Keys are caught before the
// game sees them, and only when not typing, so chat never drives the bike.
import type { Game } from '../core/Game';
import type { NetClient } from '../net/NetClient';
import type { PlayerInfo } from '../../shared/protocol';
import { QUICK_CHAT } from '../../shared/social';
import { ChatPanel } from './ChatPanel';
import { mutes } from '../net/mutes';
import { career, featNow } from '../core/career';
import { toast } from './toast';
import '../styles/social.css';

export interface SocialHost {
  game(): Game | null;
  /** 'lobby' = lobby screen, 'play' = riding with no menu open, 'menu' = any other menu (pause, results, loading…). */
  view(): 'lobby' | 'play' | 'menu';
  /** Close the menu and go back to the game (used by "Spectate" on the results card). */
  resume(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pingClass = (ms?: number) => (ms === undefined ? '' : ms < 90 ? 'good' : ms < 200 ? 'ok' : 'bad');
const pingText = (ms?: number) => (ms === undefined ? '– ms' : `${ms} ms`);
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
// d-pad buttons 12 up, 13 down, 14 left, 15 right → quick-chat lines
const PAD_QUICK: Record<number, number> = { 12: 2, 15: 1, 13: 3, 14: 0 };

/** Extra bits for a lobby player row (ping, status, mute). Safe to call when offline. */
export function lobbyRowExtras(p: PlayerInfo, you: string) {
  if (!SocialUI.current) return '';
  const tags = `${p.away ? ' <span class="soc-tag away">⏳ reconnecting</span>' : ''}${p.spec ? ' <span class="soc-tag">👁 watching</span>' : ''}`;
  return `${tags} <span class="soc-ping ${pingClass(p.ping)}" data-ping="${esc(p.id)}">${pingText(p.ping)}</span>${p.id !== you ? `<button class="soc-mute" data-mute="${esc(p.id)}" title="Mute chat from this player (only for you)">${mutes.has(p.id) ? '🔇' : '🔈'}</button>` : ''}`;
}

/** "Spectate" button for the results card when other riders are still out there. */
export function resultsExtras() {
  const g = SocialUI.current?.host.game();
  let others = false;
  g?.remotes?.forEach((r) => { if (r.state && !r.away) others = true; });
  return others ? '<button class="btn" data-spectate="1">👁 Spectate</button>' : '';
}

export class SocialUI {
  /** The one live instance (rooms are joined one at a time). */
  static current: SocialUI | null = null;
  private root = document.createElement('div');
  private chat: ChatPanel;
  private badge: HTMLElement;
  private quickBox: HTMLDivElement;
  private list: HTMLDivElement;
  private banner: HTMLDivElement;
  private spec: HTMLDivElement;
  private listHeld = false;
  private listPinned = false;
  private raf = 0;
  private padPrev: boolean[] = [];
  private offs: (() => void)[] = [];
  private lastView = '';
  private specKey = '';

  constructor(private net: NetClient, readonly host: SocialHost) {
    SocialUI.current?.dispose();
    SocialUI.current = this;
    this.root.id = 'social';
    document.body.append(this.root);

    const dock = document.createElement('div');
    dock.className = 'soc-dock';
    const btn = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      dock.append(b);
      return b;
    };
    const chatBtn = btn('💬<i class="soc-badge" hidden></i>', 'Chat (Enter / T)', () => this.chat.toggle());
    this.badge = chatBtn.querySelector('i')!;
    btn('😀', `Quick chat (keys ${QUICK_CHAT.map((q) => q.key.replace('Digit', '')).join(' ')})`, () => { this.quickBox.hidden = !this.quickBox.hidden; });
    btn('👥', 'Players (hold Tab)', () => { this.listPinned = !this.listPinned; this.renderList(); }).classList.add('soc-in-game');

    this.chat = new ChatPanel(this.root, (text) => {
      net.send({ t: 'chat', text });
      this.chatFeat();
      if (this.host.view() === 'play') this.chat.close(); // back to riding after sending
    }, (i) => this.quick(i), () => this.host.game()?.input.reset());
    this.chat.onUnread = (n) => { this.badge.hidden = n === 0; this.badge.textContent = n > 9 ? '9+' : String(n); };
    this.chat.setLines(net.chat);

    this.quickBox = document.createElement('div');
    this.quickBox.className = 'soc-quick';
    this.quickBox.hidden = true;
    QUICK_CHAT.forEach((q, i) => {
      const b = document.createElement('button');
      const key = document.createElement('kbd');
      key.textContent = q.key.replace('Digit', '');
      b.append(`${q.emoji} ${q.text} `, key);
      b.addEventListener('click', () => { this.quick(i); this.quickBox.hidden = true; });
      this.quickBox.append(b);
    });

    this.list = document.createElement('div');
    this.list.className = 'soc-list';
    this.list.hidden = true;
    this.banner = document.createElement('div');
    this.banner.className = 'soc-banner';
    this.banner.hidden = true;
    this.spec = document.createElement('div');
    this.spec.className = 'soc-spec';
    this.spec.hidden = true;
    this.root.append(dock, this.quickBox, this.list, this.banner, this.spec);

    const ev = net.events;
    this.offs.push(
      ev.on('chat', (m) => {
        this.chat.add(m.line, m.line.id === net.id);
        if (m.line.q !== undefined && m.line.id !== net.id && !mutes.has(m.line.id)) this.host.game()?.remotes?.emote(m.line.id, m.line.text);
      }),
      ev.on('pong', () => this.paintPings()),
      ev.on('players', () => this.renderList()),
      ev.on('reconnecting', (m) => this.showBanner(`📡 Connection lost · reconnecting${m.attempt > 1 ? ` (try ${m.attempt})` : ''}…`)),
      ev.on('reconnected', () => {
        this.banner.hidden = true;
        this.chat.setLines(net.chat);
      }),
    );
    addEventListener('keydown', this.onKey, true);
    addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('click', this.onClick, true);
    net.onDispose(() => this.dispose());
    this.raf = requestAnimationFrame(this.tick);
  }

  private quick(i: number) {
    if (!QUICK_CHAT[i]) return;
    this.net.send({ t: 'emote', e: i });
    this.chatFeat();
  }

  /** Career "Say hi": in a session through its tracker (HUD toast), in the lobby straight away. */
  private chatFeat() {
    if (career.stats.chats > 0) { career.stats.chats++; return; } // only the first one can unlock anything (saved with the career)
    const c = this.host.game()?.career;
    if (c && this.host.view() !== 'lobby') c.feat('chat');
    else for (const a of featNow('chat')) toast(`${a.icon} Achievement: ${a.name}`);
  }

  private showBanner(text: string) {
    this.banner.replaceChildren();
    const span = document.createElement('span');
    span.textContent = text;
    const retry = document.createElement('button');
    retry.textContent = 'Retry now';
    retry.addEventListener('click', () => this.net.retryNow());
    this.banner.append(span, retry);
    this.banner.hidden = false;
  }

  // ---------------------------------------------------------------- keys / gamepad
  private onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const view = this.host.view(), g = this.host.game(), p = g?.players[0];
    if (view === 'menu') return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const cards = !!p && (p.cardsOpen || p.s.pendingLevels > 0);
    const onButton = document.activeElement instanceof HTMLButtonElement && view === 'lobby';
    if ((e.code === 'Enter' && !onButton) || (e.code === 'KeyT' && !p?.cardsOpen)) {
      stop();
      g?.input.reset(); // nothing stays held while typing
      return this.chat.open(true);
    }
    const qi = QUICK_CHAT.findIndex((q) => q.key === e.code);
    if (qi >= 0) {
      stop();
      if (!e.repeat) this.quick(qi);
      return;
    }
    if (e.code === 'Tab' && view === 'play' && !cards) {
      stop();
      this.listHeld = true;
      return this.renderList();
    }
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && view === 'play' && g?.spectator?.available) {
      stop();
      g.spectator.cycle(e.code === 'BracketRight' ? 1 : -1);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Tab' && this.listHeld) {
      this.listHeld = false;
      this.renderList();
    }
  };

  private onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-mute],[data-spectate]');
    if (!t) return;
    if (t.dataset.mute) {
      e.stopPropagation();
      const on = mutes.toggle(t.dataset.mute);
      document.querySelectorAll<HTMLElement>(`[data-mute="${CSS.escape(t.dataset.mute)}"]`).forEach((b) => (b.textContent = on ? '🔇' : '🔈'));
      this.chat.setLines(this.net.chat);
    } else if (t.dataset.spectate) {
      e.stopPropagation();
      this.host.resume();
      this.host.game()?.spectator?.cycle(1);
    }
  };

  private pollPad(view: string, g: Game | null) {
    const pad = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!pad?.connected) return;
    const down = (i: number) => !!pad.buttons[i]?.pressed;
    const hit = (i: number) => down(i) && !this.padPrev[i];
    const sp = g?.spectator, watching = !!sp?.active || this.net.spectating;
    // d-pad = quick chat while watching, or with Back/View held while riding. In the lobby and menus the d-pad
    // moves the menu focus (menuNav), so quick chat there needs Back/View held too.
    if ((view === 'play' && watching) || down(8)) for (const b in PAD_QUICK) if (hit(+b)) this.quick(PAD_QUICK[b]);
    if (view === 'play' && sp?.available && watching) {
      if (hit(4)) sp.cycle(-1);
      if (hit(5)) sp.cycle(1);
    }
    for (let i = 0; i < pad.buttons.length; i++) this.padPrev[i] = down(i);
  }

  // ---------------------------------------------------------------- per frame
  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const view = this.host.view(), g = this.host.game();
    if (view !== this.lastView) {
      this.lastView = view;
      this.root.dataset.view = view;
      if (view === 'menu') { this.listHeld = false; this.quickBox.hidden = true; }
      this.renderList();
    }
    this.pollPad(view, g);
    this.paintSpectate(view, g);
  };

  private paintSpectate(view: string, g: Game | null) {
    const sp = g?.spectator, show = view === 'play' && !!sp?.available;
    const t = show ? sp!.target : null;
    const key = !show ? '' : t ? `w:${t.id}:${t.name}` : `a:${this.net.spectating}`;
    if (key === this.specKey) return;
    this.specKey = key;
    this.spec.hidden = !show;
    if (!show) return;
    this.spec.replaceChildren();
    const b = (label: string, title: string, fn: () => void) => {
      const el = document.createElement('button');
      el.textContent = label;
      el.title = title;
      el.addEventListener('click', (e) => { e.stopPropagation(); fn(); this.specKey = ''; });
      return el;
    };
    if (t) {
      const name = document.createElement('span');
      name.textContent = `👁 Watching ${t.name}${this.net.spectating ? ' · you ride from the next start' : ''}`;
      this.spec.append(b('◀', 'Previous rider ([ / LB)', () => sp!.cycle(-1)), name, b('▶', 'Next rider (] / RB)', () => sp!.cycle(1)), b('✕', 'Back to my camera', () => sp!.stop()));
    } else this.spec.append(b('👁 Watch other riders', 'Spectate ([ / ])', () => sp!.cycle(1)));
  }

  private renderList() {
    const show = this.lastView === 'play' && (this.listHeld || this.listPinned);
    this.list.hidden = !show;
    if (!show) return;
    const n = this.net, rows = n.players.map((p) => {
      const st = p.away ? '⏳ reconnecting' : p.spec ? '👁 watching' : '';
      return `<tr><td><i style="background:#${(p.color & 0xffffff).toString(16).padStart(6, '0')}"></i>${esc(p.name)}${p.host ? ' 👑' : ''}${p.id === n.id ? ' <em>(you)</em>' : ''}</td>
        <td class="soc-st">${st}</td><td><span class="soc-ping ${pingClass(p.ping)}" data-ping="${esc(p.id)}">${pingText(p.ping)}</span></td>
        <td>${p.id !== n.id ? `<button class="soc-mute" data-mute="${esc(p.id)}" title="Mute chat (only for you)">${mutes.has(p.id) ? '🔇' : '🔈'}</button>` : ''}</td></tr>`;
    }).join('');
    this.list.innerHTML = `<div class="soc-list-head">Room ${esc(n.code)} · ${n.players.length}/${n.settings.maxPlayers} riders</div><table>${rows}</table><div class="soc-hint">Hold Tab · 🔈 mutes chat locally</div>`;
  }

  private paintPings() {
    for (const p of this.net.players) {
      document.querySelectorAll<HTMLElement>(`[data-ping="${CSS.escape(p.id)}"]`).forEach((el) => {
        el.textContent = pingText(p.ping);
        el.className = `soc-ping ${pingClass(p.ping)}`;
      });
    }
  }

  dispose() {
    if (SocialUI.current === this) SocialUI.current = null;
    cancelAnimationFrame(this.raf);
    this.offs.forEach((off) => off());
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('click', this.onClick, true);
    this.root.remove();
  }
}
