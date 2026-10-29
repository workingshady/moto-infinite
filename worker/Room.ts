// One Durable Object per room code. Relays rider snapshots/shots between players and owns the lobby state.
// Uses the WebSocket Hibernation API so idle rooms cost nothing while players stay connected.
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_SETTINGS, MAX_PLAYERS, type ClientMsg, type LobbySettings, type Phase, type PlayerInfo, type ServerMsg } from '../shared/protocol';

interface Attachment { id: string; name: string; color: number; joined: number; hello: boolean }

const MAX_MSG = 8 * 1024;
const clean = (s: unknown) => [...String(s ?? '')].filter((c) => c >= ' ' && c !== '<' && c !== '>').join('').trim().slice(0, 16) || 'Rider';

export class Room extends DurableObject<Env> {
  private settings: LobbySettings = { ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 1e9) };
  private phase: Phase = 'lobby';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.settings = (await ctx.storage.get<LobbySettings>('settings')) ?? this.settings;
      this.phase = (await ctx.storage.get<Phase>('phase')) ?? 'lobby';
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const full = this.sockets().length > MAX_PLAYERS;
    if (full) {
      server.send(JSON.stringify({ t: 'error', msg: 'Room is full' } satisfies ServerMsg));
      server.close(4000, 'Room is full');
    } else {
      server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: 'Rider', color: 0xffffff, joined: Date.now(), hello: false } satisfies Attachment);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private att(ws: WebSocket) {
    return ws.deserializeAttachment() as Attachment | null;
  }

  private players(): PlayerInfo[] {
    const list = this.sockets().map((ws) => this.att(ws)).filter((a): a is Attachment => !!a?.hello).sort((a, b) => a.joined - b.joined);
    return list.map((a, i) => ({ id: a.id, name: a.name, color: a.color, host: i === 0 }));
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
      if (ws === except || !this.att(ws)?.hello) continue;
      try {
        ws.send(data);
      } catch {
        /* socket closing */
      }
    }
  }

  private isHost(ws: WebSocket) {
    return this.players()[0]?.id === this.att(ws)?.id;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    const a = this.att(ws);
    if (!a) return;
    switch (msg.t) {
      case 'hello': {
        a.name = clean(msg.name);
        a.color = Number(msg.color) & 0xffffff;
        a.hello = true;
        ws.serializeAttachment(a);
        this.send(ws, { t: 'welcome', you: a.id, players: this.players(), settings: this.settings, phase: this.phase });
        this.broadcast({ t: 'players', players: this.players() }, ws);
        return;
      }
      case 'settings': {
        if (!this.isHost(ws)) return;
        const s = msg.settings;
        this.settings = {
          mode: s.mode === 'race' ? 'race' : 'open',
          trackId: clean(s.trackId).toLowerCase(),
          laps: Math.max(1, Math.min(10, Math.round(Number(s.laps) || 3))),
          pvp: !!s.pvp,
          seed: Math.floor(Number(s.seed) || 1),
        };
        await this.ctx.storage.put('settings', this.settings);
        this.broadcast({ t: 'settings', settings: this.settings });
        return;
      }
      case 'start': {
        if (!this.isHost(ws)) return;
        this.phase = 'playing';
        await this.ctx.storage.put('phase', this.phase);
        this.broadcast({ t: 'start', settings: this.settings });
        return;
      }
      case 'back': {
        if (!this.isHost(ws)) return;
        this.phase = 'lobby';
        await this.ctx.storage.put('phase', this.phase);
        this.broadcast({ t: 'back' });
        return;
      }
      case 'state':
        return this.broadcast({ t: 'state', id: a.id, s: msg.s }, ws);
      case 'fire':
        return this.broadcast({ t: 'fire', id: a.id, w: msg.w, o: msg.o, d: msg.d }, ws);
      case 'boom':
        return this.broadcast({ t: 'boom', id: a.id, p: msg.p, r: msg.r, dmg: msg.dmg }, ws);
      case 'finish':
        return this.broadcast({ t: 'finish', id: a.id, time: Number(msg.time) || 0 }, ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    await this.left();
  }

  async webSocketError() {
    await this.left();
  }

  private async left() {
    const players = this.players();
    this.broadcast({ t: 'players', players });
    if (!players.length && this.phase !== 'lobby') {
      this.phase = 'lobby';
      await this.ctx.storage.put('phase', this.phase);
    }
  }
}
