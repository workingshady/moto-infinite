// One Durable Object per room code. Relays rider snapshots/shots between players and owns the lobby state.
// Uses the WebSocket Hibernation API so idle rooms cost nothing while players stay connected.
// Robustness: dropped players keep their slot for NET_LIMITS.holdMs (resume token), the host role migrates,
// every message is validated and rate limited, and race finish times are checked against the clock.
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_GEN, DEFAULT_SETTINGS, FIXED_WEATHERS, GEN_MAX, MAX_PLAYERS, THEMES, TIMES, WEATHERS, type ChatLine, type ClientMsg, type LobbySettings, type NetState, type Phase, type PlayerInfo, type ServerMsg, type Vec3 } from '../shared/protocol';
import { Bucket, CHAT, NET_LIMITS, QUICK_CHAT, cleanChat } from '../shared/social';

interface Attachment {
  id: string; name: string; color: number; vehicle?: string; joined: number; hello: boolean; ready?: boolean;
  /** Secret that lets this player take their slot back after a dropped connection. */
  token?: string;
  ping?: number;
  /** Late joiner watching a race in progress. */
  spec?: boolean;
  /** Finish already accepted this round. */
  finished?: boolean;
  /** Said goodbye (leave / quit): don't hold the slot. */
  bye?: boolean;
  /** Kicked or replaced by a reconnect: already handled, ignore its close. */
  gone?: boolean;
}
interface Held { att: Attachment; until: number }
interface Limits { state: Bucket; fire: Bucket; boom: Bucket; chat: Bucket }

const MAX_MSG = 8 * 1024;
const LEAVE_CODE = 4100; // client closed on purpose (leave / quit)
const cleanId = (s: unknown) => String(s ?? 'street').replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'street';
const clean = (s: unknown) => [...String(s ?? '')].filter((c) => c >= ' ' && c !== '<' && c !== '>').join('').trim().slice(0, 16) || 'Rider';
const num = (v: unknown, lim = 1e7): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => num(x)) ? [v[0], v[1], v[2]] : null);
const STATE_NUMS = ['bx', 'by', 'bz', 'bh', 'bp', 'bl', 'wx', 'wy', 'wz', 'wh', 'v', 'boost', 'score', 'lap', 'prog'] as const;

/** Rider snapshot check: core fields must be finite numbers; any extra fields must be small primitives. */
function cleanState(s: unknown): NetState | null {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const o = s as Record<string, unknown>, out: Record<string, number | boolean | string> = {};
  for (const k of STATE_NUMS) if (!num(o[k])) return null;
  let n = 0;
  for (const k in o) {
    if (++n > 48) return null;
    const v = o[k];
    if (typeof v === 'boolean' || num(v) || (typeof v === 'string' && v.length <= 32)) out[k] = v;
    else if (v !== undefined && v !== null) return null;
  }
  out.riding = !!o.riding;
  out.dead = !!o.dead;
  return out as unknown as NetState;
}

export class Room extends DurableObject<Env> {
  private settings: LobbySettings = { ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 1e9) };
  private phase: Phase = 'lobby';
  private held: Record<string, Held> = {};
  private hostId = '';
  private round = 0;
  private startedAt = 0;
  private chat: ChatLine[] = [];
  private limits = new WeakMap<WebSocket, Limits>();
  private closed = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.settings = { ...this.settings, ...(await ctx.storage.get<LobbySettings>('settings')) };
      this.phase = (await ctx.storage.get<Phase>('phase')) ?? 'lobby';
      this.held = (await ctx.storage.get<Record<string, Held>>('held')) ?? {};
      this.hostId = (await ctx.storage.get<string>('host')) ?? '';
      this.round = (await ctx.storage.get<number>('round')) ?? 0;
      this.startedAt = (await ctx.storage.get<number>('startedAt')) ?? 0;
      this.chat = (await ctx.storage.get<ChatLine[]>('chat')) ?? [];
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const resume = new URL(req.url).searchParams.get('resume') ?? '';
    const refuse = this.canResume(resume) ? '' : this.refusal();
    if (refuse) {
      server.send(JSON.stringify({ t: 'error', msg: refuse } satisfies ServerMsg));
      server.close(4000, 'Refused');
    } else {
      server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: 'Rider', color: 0xffffff, joined: Date.now(), hello: false, token: crypto.randomUUID() } satisfies Attachment);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private refusal(except?: WebSocket) {
    const joined = this.players(except).length, max = Math.min(MAX_PLAYERS, this.settings.maxPlayers ?? MAX_PLAYERS);
    return joined >= max ? `Room is full (${joined}/${max})` : this.settings.locked && joined > 0 ? 'The host locked this room' : '';
  }

  private canResume(token: string) {
    return !!token && (!!this.held[token] || this.sockets().some((w) => this.att(w)?.token === token));
  }

  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private att(ws: WebSocket) {
    return ws.deserializeAttachment() as Attachment | null;
  }

  /** Connected players who said hello. */
  private live(except?: WebSocket) {
    return this.sockets().filter((w) => w !== except).map((w) => this.att(w)).filter((a): a is Attachment => !!a?.hello && !a.gone);
  }

  private players(except?: WebSocket): PlayerInfo[] {
    const list = [...this.live(except).map((a) => ({ a, away: false })), ...Object.values(this.held).map((h) => ({ a: h.att, away: true }))].sort((x, y) => x.a.joined - y.a.joined);
    return list.map(({ a, away }) => ({
      id: a.id, name: a.name, color: a.color, vehicle: a.vehicle ?? 'street', host: a.id === this.hostId, ready: a.id === this.hostId || !!a.ready,
      ping: a.ping, away: away || undefined, spec: a.spec || undefined,
    }));
  }

  /** The host role stays put until the host is gone (left or dropped); then the longest-standing connected player takes it. */
  private async syncHost() {
    const live = this.live().sort((a, b) => a.joined - b.joined);
    if (live.some((a) => a.id === this.hostId)) return;
    const old = this.hostId, next = live[0];
    this.hostId = next?.id ?? '';
    await this.ctx.storage.put('host', this.hostId);
    if (old && next) await this.notice(`${next.name} is now the host 👑`);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets()) {
      const a = this.att(ws);
      if (ws === except || !a?.hello || a.gone) continue;
      try {
        ws.send(data);
      } catch {
        /* socket closing */
      }
    }
  }

  private async addChat(line: ChatLine) {
    this.chat.push(line);
    if (this.chat.length > CHAT.history) this.chat.splice(0, this.chat.length - CHAT.history);
    await this.ctx.storage.put('chat', this.chat);
    this.broadcast({ t: 'chat', line });
  }

  private notice(text: string) {
    return this.addChat({ id: '', name: '', color: 0, text, at: Date.now() });
  }

  /** Trim the name and add a number if someone else in the room already uses it. */
  private uniqueName(raw: unknown, self: WebSocket, selfId: string) {
    const base = clean(raw), taken = new Set([...this.live(self), ...Object.values(this.held).map((h) => h.att)].filter((a) => a.id !== selfId).map((a) => a.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const n = `${base.slice(0, 13)} ${i}`;
      if (!taken.has(n)) return n;
    }
  }

  private isHost(ws: WebSocket) {
    return this.hostId !== '' && this.hostId === this.att(ws)?.id;
  }

  private lim(ws: WebSocket) {
    let l = this.limits.get(ws);
    if (!l) {
      l = {
        state: new Bucket(NET_LIMITS.stateHz, NET_LIMITS.stateHz * 2), fire: new Bucket(NET_LIMITS.fireHz, NET_LIMITS.fireHz * 2),
        boom: new Bucket(NET_LIMITS.boomHz, NET_LIMITS.boomHz * 2), chat: new Bucket(CHAT.refill, CHAT.burst),
      };
      this.limits.set(ws, l);
    }
    return l;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const a = this.att(ws);
    if (!a || a.gone || (!a.hello && msg.t !== 'hello')) return;
    try {
      await this.handle(ws, a, msg, raw.length);
    } catch {
      /* malformed message: ignore it */
    }
  }

  private async handle(ws: WebSocket, a: Attachment, msg: ClientMsg, size: number) {
    switch (msg.t) {
      case 'hello': {
        if (a.hello) return;
        const resume = typeof msg.resume === 'string' ? msg.resume : '';
        let resumed = false;
        if (resume && this.held[resume]) {
          Object.assign(a, this.held[resume].att, { gone: false, bye: false });
          delete this.held[resume];
          await this.ctx.storage.put('held', this.held);
          resumed = true;
        } else if (resume) {
          // the old socket is still half-open: take its place
          const old = this.sockets().find((w) => w !== ws && this.att(w)?.token === resume && this.att(w)?.hello);
          const oa = old && this.att(old);
          if (old && oa) {
            Object.assign(a, oa, { gone: false, bye: false });
            old.serializeAttachment({ ...oa, gone: true });
            try { old.close(4002, 'Replaced'); } catch { /* already closing */ }
            resumed = true;
          }
        }
        if (!resumed) {
          const refuse = this.refusal(ws);
          if (refuse) {
            this.send(ws, { t: 'error', msg: refuse });
            try { ws.close(4000, 'Refused'); } catch { /* already closing */ }
            return;
          }
          const race = this.settings.mode === 'race' || this.settings.mode === 'f1';
          a.spec = this.phase === 'playing' && race;
          a.ready = false;
          a.finished = false;
        }
        a.name = this.uniqueName(msg.name, ws, a.id);
        a.color = Number(msg.color) & 0xffffff;
        a.vehicle = cleanId(msg.vehicle);
        a.hello = true;
        ws.serializeAttachment(a);
        await this.syncHost();
        this.send(ws, { t: 'welcome', you: a.id, players: this.players(), settings: this.settings, phase: this.phase, token: a.token, resumed, round: this.round, chat: this.chat });
        this.broadcast({ t: 'players', players: this.players() }, ws);
        if (!resumed) await this.notice(`${a.name} joined${a.spec ? ' (watching until the next start)' : ''}`);
        return;
      }
      case 'ping': {
        if (num(msg.rtt, 60_000)) a.ping = Math.round(msg.rtt);
        ws.serializeAttachment(a);
        const pings: Record<string, number> = {};
        for (const p of this.live()) if (p.ping !== undefined) pings[p.id] = p.ping;
        this.send(ws, { t: 'pong', c: num(msg.c) ? msg.c : 0, pings });
        return;
      }
      case 'bye': {
        a.bye = true;
        ws.serializeAttachment(a);
        return;
      }
      case 'chat': {
        if (!this.lim(ws).chat.take()) return this.send(ws, { t: 'chat', line: { id: '', name: '', color: 0, text: 'Slow down: too many messages.', at: Date.now() } });
        const text = cleanChat(msg.text);
        if (!text) return;
        return this.addChat({ id: a.id, name: a.name, color: a.color, text, at: Date.now() });
      }
      case 'emote': {
        const e = Number(msg.e);
        if (!Number.isInteger(e) || e < 0 || e >= QUICK_CHAT.length || !this.lim(ws).chat.take()) return;
        return this.addChat({ id: a.id, name: a.name, color: a.color, text: `${QUICK_CHAT[e].emoji} ${QUICK_CHAT[e].text}`, at: Date.now(), q: e });
      }
      case 'profile': {
        a.name = this.uniqueName(msg.name, ws, a.id);
        a.color = Number(msg.color) & 0xffffff;
        a.vehicle = cleanId(msg.vehicle);
        ws.serializeAttachment(a);
        this.broadcast({ t: 'players', players: this.players() });
        return;
      }
      case 'ready': {
        a.ready = !!msg.ready;
        ws.serializeAttachment(a);
        this.broadcast({ t: 'players', players: this.players() });
        return;
      }
      case 'kick': {
        if (!this.isHost(ws) || typeof msg.id !== 'string' || msg.id === a.id) return;
        // a dropped player can be removed too: just forget the held slot
        const name = this.players().find((p) => p.id === msg.id)?.name;
        for (const [k, h] of Object.entries(this.held)) if (h.att.id === msg.id) delete this.held[k];
        await this.ctx.storage.put('held', this.held);
        const target = this.sockets().find((w) => this.att(w)?.id === msg.id);
        if (target) {
          const ta = this.att(target)!;
          target.serializeAttachment({ ...ta, gone: true });
          this.send(target, { t: 'kicked' });
          try { target.close(4001, 'Kicked'); } catch { /* already closing */ }
        }
        this.broadcast({ t: 'players', players: this.players().filter((p) => p.id !== msg.id) });
        if (name) await this.notice(`${name} was removed by the host`);
        return;
      }
      case 'settings': {
        if (!this.isHost(ws)) return;
        const s = msg.settings;
        if (!s || typeof s !== 'object') return;
        this.settings = {
          mode: s.mode === 'race' || s.mode === 'drift' || s.mode === 'f1' ? s.mode : 'open',
          trackId: clean(s.trackId).toLowerCase(),
          laps: Math.max(1, Math.min(50, Math.round(Number(s.laps) || 3))),
          pvp: !!s.pvp,
          seed: Math.floor(Number(s.seed) || 1),
          time: TIMES.includes(s.time) ? s.time : 'day',
          weather: WEATHERS.includes(s.weather) ? s.weather : 'clear',
          weathers: Array.isArray(s.weathers) ? [...new Set(s.weathers.filter((w) => FIXED_WEATHERS.includes(w)))].slice(0, 4) : undefined,
          theme: THEMES.includes(s.theme) ? s.theme : 'mixed',
          gen: { ...DEFAULT_GEN },
          maxPlayers: Math.max(2, Math.min(MAX_PLAYERS, Math.round(Number(s.maxPlayers) || MAX_PLAYERS))),
          locked: !!s.locked,
          drones: Math.max(0, Math.min(3, Math.round(Number(s.drones ?? 2)))),
          ai: 0, // computer opponents are local-only (not synced)
          session: s.session === 'quali' ? 'quali' : 'race',
          tyre: s.tyre === 'soft' || s.tyre === 'hard' ? s.tyre : 'medium',
        };
        for (const k of Object.keys(GEN_MAX) as (keyof typeof GEN_MAX)[])
          this.settings.gen[k] = Math.max(0, Math.min(GEN_MAX[k], Math.round(Number(s.gen?.[k] ?? DEFAULT_GEN[k]))));
        await this.ctx.storage.put('settings', this.settings);
        this.broadcast({ t: 'settings', settings: this.settings });
        return;
      }
      case 'start': {
        if (!this.isHost(ws)) return;
        this.phase = 'playing';
        this.round++;
        this.startedAt = Date.now();
        await this.ctx.storage.put({ phase: this.phase, round: this.round, startedAt: this.startedAt });
        // everyone must ready up again next time they're back in the lobby; watchers now race too
        for (const w of this.sockets()) {
          const at = this.att(w);
          if (at && (at.ready || at.spec || at.finished)) { at.ready = false; at.spec = false; at.finished = false; w.serializeAttachment(at); }
        }
        for (const h of Object.values(this.held)) { h.att.ready = false; h.att.spec = false; h.att.finished = false; }
        await this.ctx.storage.put('held', this.held);
        this.broadcast({ t: 'start', settings: this.settings, round: this.round });
        return;
      }
      case 'back': {
        if (!this.isHost(ws)) return;
        this.phase = 'lobby';
        await this.ctx.storage.put('phase', this.phase);
        for (const w of this.sockets()) {
          const at = this.att(w);
          if (at?.spec) { at.spec = false; w.serializeAttachment(at); }
        }
        for (const h of Object.values(this.held)) h.att.spec = false;
        this.broadcast({ t: 'back' });
        this.broadcast({ t: 'players', players: this.players() });
        return;
      }
      case 'state': {
        if (a.spec || size > NET_LIMITS.stateBytes || !this.lim(ws).state.take()) return;
        const s = cleanState(msg.s);
        if (s) this.broadcast({ t: 'state', id: a.id, s }, ws);
        return;
      }
      case 'fire': {
        if (a.spec || !this.lim(ws).fire.take()) return;
        const o = vec3(msg.o), w = Number(msg.w);
        if (!o || !Number.isInteger(w) || w < 0 || w > 15 || !Array.isArray(msg.d) || !msg.d.length || msg.d.length > 16) return;
        const d = msg.d.map(vec3);
        if (d.some((v) => !v)) return;
        return this.broadcast({ t: 'fire', id: a.id, w, o, d: d as Vec3[] }, ws);
      }
      case 'boom': {
        if (a.spec || !this.lim(ws).boom.take()) return;
        const p = vec3(msg.p), r = Number(msg.r), dmg = Number(msg.dmg);
        if (!p || !num(r) || !num(dmg) || r <= 0 || r > NET_LIMITS.boomR || dmg < 0 || dmg > NET_LIMITS.boomDmg) return;
        return this.broadcast({ t: 'boom', id: a.id, p, r: Math.min(r, 10), dmg: Math.min(dmg, 80) }, ws);
      }
      case 'finish': {
        const minLap = NET_LIMITS.minLap[this.settings.mode];
        if (!minLap || a.spec || a.finished || this.phase !== 'playing') return;
        const time = Number(msg.time), elapsed = (Date.now() - this.startedAt) / 1000, least = this.settings.laps * minLap;
        // faster than the fastest believable laps, sooner than the race could have run, or longer than it has been running (+ penalties)
        if (!num(time) || time < least || elapsed < least || time > elapsed + 120) {
          this.send(ws, { t: 'chat', line: { id: '', name: '', color: 0, text: 'Finish time rejected by the room.', at: Date.now() } });
          return;
        }
        a.finished = true;
        ws.serializeAttachment(a);
        return this.broadcast({ t: 'finish', id: a.id, time }, ws);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    await this.dropped(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropped(ws, 1006);
  }

  /** A socket went away: hold the slot for a while unless the player left on purpose. */
  private async dropped(ws: WebSocket, code: number) {
    if (this.closed.has(ws)) return;
    this.closed.add(ws);
    const a = this.att(ws);
    if (a?.hello && !a.gone) {
      if (code !== LEAVE_CODE && !a.bye && a.token) {
        this.held[a.token] = { att: { ...a, ping: undefined }, until: Date.now() + NET_LIMITS.holdMs };
        await this.ctx.storage.put('held', this.held);
        await this.scheduleAlarm();
      } else await this.notice(`${a.name} left`);
    }
    await this.left();
  }

  private async scheduleAlarm() {
    const next = Math.min(...Object.values(this.held).map((h) => h.until));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }

  /** Held slots that were not taken back in time are released. */
  async alarm() {
    const now = Date.now();
    let changed = false;
    for (const [k, h] of Object.entries(this.held)) {
      if (h.until > now) continue;
      delete this.held[k];
      changed = true;
      await this.notice(`${h.att.name} lost connection`);
    }
    if (changed) {
      await this.ctx.storage.put('held', this.held);
      await this.left();
    }
    await this.scheduleAlarm();
  }

  private async left() {
    await this.syncHost();
    const players = this.players();
    this.broadcast({ t: 'players', players });
    if (!players.length && this.phase !== 'lobby') {
      this.phase = 'lobby';
      await this.ctx.storage.put('phase', this.phase);
    }
  }
}
