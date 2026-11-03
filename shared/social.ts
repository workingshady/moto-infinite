// Chat, quick-chat and anti-cheat limits shared by the client (src/net, src/ui) and the room (worker/Room.ts).

/** Quick-chat lines: sent as an index, shown in chat and as an emote bubble above the rider's name tag. */
export const QUICK_CHAT: { emoji: string; text: string; key: string }[] = [
  { emoji: '🏁', text: 'GG', key: 'Digit5' },
  { emoji: '👏', text: 'Nice!', key: 'Digit6' },
  { emoji: '🚀', text: 'Go!', key: 'Digit7' },
  { emoji: '✋', text: 'Wait', key: 'Digit8' },
  { emoji: '❓', text: 'Ready?', key: 'Digit9' },
  { emoji: '😂', text: 'LOL', key: 'Digit0' },
];

export const CHAT = {
  maxLen: 140,
  history: 40,
  /** Token bucket per player: burst size and refill per second. */
  burst: 5,
  refill: 0.8,
};

export const NET_LIMITS = {
  /** How long the room keeps a dropped player's slot (ms). */
  holdMs: 30_000,
  /** Client heartbeat (ms) and how long without any message counts as a dead link. */
  pingMs: 2_000,
  staleMs: 7_000,
  /** Reconnect backoff (ms) and how long to keep trying before giving up. */
  backoff: [400, 1000, 2000, 3000, 5000],
  giveUpMs: 32_000,
  /** Messages per second allowed per player (token bucket burst = 2x). */
  stateHz: 25,
  fireHz: 20,
  boomHz: 10,
  stateBytes: 600,
  /** Fastest believable lap (s) per mode; finish times below laps x this are rejected. */
  minLap: { race: 10, f1: 20 } as Record<string, number>,
  /** Explosion bounds relayed between players. */
  boomR: 12,
  boomDmg: 500,
};

// Kept short on purpose: masks the obvious ones, the room is joined by invite link anyway.
const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'dick', 'pussy', 'asshole', 'bastard', 'wanker'];
const BAD_RE = new RegExp(`(${BAD.join('|')})`, 'gi');

/** Plain text only: no control characters, no angle brackets, collapsed whitespace, length cap, masked swearing. */
export function cleanChat(raw: unknown): string {
  const s = [...String(raw ?? '')]
    .map((c) => (c < ' ' || c === '\u007f' ? ' ' : c === '<' ? '‹' : c === '>' ? '›' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, CHAT.maxLen).join('').replace(BAD_RE, (w) => w[0] + '*'.repeat(w.length - 1));
}

/** Simple token bucket (no allocation per call). */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private cap: number) {
    this.tokens = cap;
  }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
