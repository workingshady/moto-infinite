// WebSocket connection to a room (worker/Room.ts). Messages are typed by shared/protocol.ts.
import { Events } from '../core/Events';
import type { ClientMsg, LobbySettings, Phase, PlayerInfo, ServerMsg } from '../../shared/protocol';
import { DEFAULT_SETTINGS } from '../../shared/protocol';

type ServerEvents = { [K in ServerMsg['t']]: Extract<ServerMsg, { t: K }> } & { closed: { reason: string } };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class NetClient {
  readonly events = new Events<ServerEvents>();
  id = '';
  players: PlayerInfo[] = [];
  settings: LobbySettings = { ...DEFAULT_SETTINGS };
  phase: Phase = 'lobby';
  private ws: WebSocket | null = null;
  private closedByUs = false;

  constructor(readonly code: string) {}

  get isHost() {
    return this.players.find((p) => p.id === this.id)?.host ?? false;
  }

  get link() {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  }

  connect(name: string, color: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/room/${this.code}`);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => this.send({ t: 'hello', name, color });
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.id = msg.you;
          this.players = msg.players;
          this.settings = msg.settings;
          this.phase = msg.phase;
          welcomed = true;
          resolve();
        } else if (msg.t === 'players') this.players = msg.players;
        else if (msg.t === 'settings') this.settings = msg.settings;
        else if (msg.t === 'start') { this.settings = msg.settings; this.phase = 'playing'; }
        else if (msg.t === 'back') this.phase = 'lobby';
        else if (msg.t === 'error' && !welcomed) reject(new Error(msg.msg));
        this.events.emit(msg.t, msg as never);
      };
      ws.onerror = () => { if (!welcomed) reject(new Error('Could not reach the room server')); };
      ws.onclose = () => {
        if (!welcomed) reject(new Error('Connection closed'));
        if (!this.closedByUs) this.events.emit('closed', { reason: 'Disconnected from room' });
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
    this.events.clear();
  }
}
