// WebSocket connection to a room (worker/Room.ts). Messages are typed by shared/protocol.ts.
// A dropped link reconnects on its own with backoff and takes the same slot back (resume token from 'welcome');
// a heartbeat measures ping and spots dead links.
import { Events } from '../core/Events';
import type { ChatLine, ClientMsg, LobbySettings, Phase, PlayerInfo, ServerMsg } from '../../shared/protocol';
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import { CHAT, NET_LIMITS } from '../../shared/social';

type ServerEvents = { [K in ServerMsg['t']]: Extract<ServerMsg, { t: K }> } & {
  closed: { reason: string };
  /** Link lost: trying again in `inMs`. */
  reconnecting: { attempt: number; inMs: number };
  /** Back in the room. `changed` = the session moved on meanwhile (new round, other phase, or the slot was lost). */
  reconnected: { resumed: boolean; changed: boolean };
};

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const LEAVE_CODE = 4100;
const RELAY = new Set<ClientMsg['t']>(['state', 'fire', 'boom', 'finish']);

const session = {
  get(k: string) {
    try { return sessionStorage.getItem(k) ?? ''; } catch { return ''; }
  },
  set(k: string, v: string | null) {
    try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* not persisted */ }
  },
};

export class NetClient {
  readonly events = new Events<ServerEvents>();
  id = '';
  players: PlayerInfo[] = [];
  settings: LobbySettings = { ...DEFAULT_SETTINGS };
  phase: Phase = 'lobby';
  /** Session counter from the room (bumps on every start). */
  round = 0;
  chat: ChatLine[] = [];
  /** Our own round-trip time in ms. */
  rtt = 0;
  status: 'connecting' | 'online' | 'reconnecting' | 'closed' = 'connecting';
  /** Joined while a race was running: we watch, nothing of ours is relayed. */
  spectating = false;
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private kicked = false;
  private token = '';
  private profile = { name: 'Rider', color: 0xffffff, vehicle: 'street' };
  private lastMsg = 0;
  private pingTimer = 0;
  private retryTimer = 0;
  private attempt = 0;
  private dropAt = 0;
  private queue: ClientMsg[] = [];
  private disposers: (() => void)[] = [];
  private onOnline = () => { if (this.status === 'reconnecting') this.retryNow(); };
  private onVisible = () => {
    if (document.visibilityState !== 'visible' || this.status !== 'online') return;
    this.lastMsg = Math.max(this.lastMsg, performance.now() - NET_LIMITS.staleMs + 3000); // timers were throttled: give a fresh ping a moment
    this.ping();
  };

  constructor(readonly code: string) {}

  get isHost() {
    return this.players.find((p) => p.id === this.id)?.host ?? false;
  }

  get link() {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  }

  /** Run `fn` when this client is closed for good (left, kicked, gave up reconnecting). */
  onDispose(fn: () => void) {
    this.disposers.push(fn);
  }

  connect(name: string, color: number, vehicle: string): Promise<void> {
    this.profile = { name, color, vehicle };
    this.token = session.get('moto:resume:' + this.code); // a page reload takes the same slot back
    addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    return new Promise((resolve, reject) => this.open(resolve, reject));
  }

  private open(resolve?: () => void, reject?: (e: Error) => void) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/room/${this.code}${this.token ? `?resume=${encodeURIComponent(this.token)}` : ''}`);
    this.ws = ws;
    let welcomed = false, refused = '';
    ws.onopen = () => {
      const { name, color, vehicle } = this.profile;
      ws.send(JSON.stringify({ t: 'hello', name, color, vehicle, resume: this.token || undefined } satisfies ClientMsg));
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      this.lastMsg = performance.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        const before = { phase: this.phase, round: this.round, id: this.id };
        this.id = msg.you;
        this.players = msg.players;
        this.settings = msg.settings;
        this.phase = msg.phase;
        this.round = msg.round ?? 0;
        this.chat = msg.chat ?? [];
        this.token = msg.token ?? '';
        this.spectating = !!this.me?.spec;
        session.set('moto:resume:' + this.code, this.token);
        welcomed = true;
        this.status = 'online';
        this.attempt = 0;
        this.dropAt = 0;
        this.startPing();
        if (resolve) resolve();
        else {
          const changed = !msg.resumed || before.id !== this.id || before.phase !== this.phase || before.round !== this.round;
          this.queue.splice(0).forEach((m) => this.send(m));
          this.events.emit('players', { t: 'players', players: this.players });
          this.events.emit('reconnected', { resumed: !!msg.resumed, changed });
        }
      } else if (msg.t === 'players') { this.players = msg.players; this.spectating = !!this.me?.spec; }
      else if (msg.t === 'settings') this.settings = msg.settings;
      else if (msg.t === 'start') { this.settings = msg.settings; this.phase = 'playing'; this.round = msg.round ?? this.round + 1; this.spectating = false; }
      else if (msg.t === 'back') { this.phase = 'lobby'; this.spectating = false; }
      else if (msg.t === 'kicked') this.kicked = true;
      else if (msg.t === 'error' && !welcomed) { refused = msg.msg; reject?.(new Error(msg.msg)); }
      else if (msg.t === 'pong') {
        this.rtt = Math.max(0, Math.round(performance.now() - msg.c));
        for (const p of this.players) p.ping = p.id === this.id ? this.rtt : msg.pings[p.id] ?? p.ping;
      } else if (msg.t === 'chat') {
        this.chat.push(msg.line);
        if (this.chat.length > CHAT.history) this.chat.splice(0, this.chat.length - CHAT.history);
      }
      this.events.emit(msg.t, msg as never);
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws || this.closedByUs) return;
      this.stopPing();
      if (!welcomed && reject) return reject(new Error(refused || 'Could not reach the room server'));
      if (this.kicked) return this.end('The host removed you from the room.');
      if (refused) return this.end(refused);
      if (ev.code === 4002) return this.end('This room was opened in another tab.');
      this.retry();
    };
  }

  get me() {
    return this.players.find((p) => p.id === this.id);
  }

  // ---------------------------------------------------------------- heartbeat / reconnect
  private startPing() {
    this.stopPing();
    this.lastMsg = performance.now();
    this.pingTimer = window.setInterval(() => this.ping(), NET_LIMITS.pingMs);
    this.ping();
  }

  private stopPing() {
    clearInterval(this.pingTimer);
  }

  private ping() {
    if (this.status !== 'online') return;
    // a link that has gone quiet is dead even if the browser hasn't noticed yet (hidden tabs throttle timers, so only judge when visible)
    if (document.visibilityState === 'visible' && performance.now() - this.lastMsg > NET_LIMITS.staleMs) return this.dropLink();
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt || undefined });
  }

  /** Abandon the current socket without waiting for its close handshake. */
  private dropLink() {
    const ws = this.ws;
    this.ws = null;
    this.stopPing();
    try { ws?.close(); } catch { /* already closed */ }
    this.retry();
  }

  private retry() {
    clearTimeout(this.retryTimer);
    if (!this.dropAt) this.dropAt = performance.now();
    if (performance.now() - this.dropAt > NET_LIMITS.giveUpMs) return this.end('Lost connection to the room.');
    const b = NET_LIMITS.backoff, inMs = Math.round(b[Math.min(this.attempt, b.length - 1)] * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.status = 'reconnecting';
    this.events.emit('reconnecting', { attempt: this.attempt, inMs });
    this.retryTimer = window.setTimeout(() => this.open(), inMs);
  }

  /** Try again right away (network came back / player pressed retry). */
  retryNow() {
    if (this.status !== 'reconnecting') return;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* already closed */ }
    this.open();
  }

  private end(reason: string) {
    this.status = 'closed';
    clearTimeout(this.retryTimer);
    this.stopPing();
    session.set('moto:resume:' + this.code, null);
    this.events.emit('closed', { reason });
    this.dispose();
  }

  // ---------------------------------------------------------------- outgoing
  send(msg: ClientMsg) {
    if (this.spectating && RELAY.has(msg.t)) return; // watchers don't race
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'online') this.ws.send(JSON.stringify(msg));
    else if ((msg.t === 'chat' || msg.t === 'emote') && this.status === 'reconnecting' && this.queue.length < 5) this.queue.push(msg);
  }

  close() {
    this.closedByUs = true;
    this.status = 'closed';
    clearTimeout(this.retryTimer);
    this.stopPing();
    session.set('moto:resume:' + this.code, null);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'bye' } satisfies ClientMsg));
    try { this.ws?.close(LEAVE_CODE, 'leave'); } catch { /* already closed */ }
    this.events.clear();
    this.dispose();
  }

  private dispose() {
    removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.disposers.splice(0).forEach((fn) => fn());
  }
}
