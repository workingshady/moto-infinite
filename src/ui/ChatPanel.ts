// Room chat: message log + input (lobby and in game), a fading feed of recent lines, and the unread count.
// Every message is rendered with textContent, never as HTML.
import type { ChatLine } from '../../shared/protocol';
import { CHAT, QUICK_CHAT } from '../../shared/social';
import { mutes } from '../net/mutes';

const FEED_MS = 8000;
const FEED_MAX = 5;
const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

function lineEl(l: ChatLine, cls: string) {
  const el = document.createElement('div');
  el.className = cls + (l.id ? '' : ' sys');
  if (l.id) {
    const n = document.createElement('b');
    n.textContent = l.name + ': ';
    n.style.color = hex(l.color);
    el.append(n);
  }
  el.append(document.createTextNode(l.text));
  return el;
}

export class ChatPanel {
  readonly panel: HTMLDivElement;
  readonly feed: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  isOpen = false;
  unread = 0;
  onUnread: (n: number) => void = () => {};

  constructor(parent: HTMLElement, private send: (text: string) => void, private quick: (i: number) => void, private closed: () => void) {
    this.panel = document.createElement('div');
    this.panel.className = 'soc-panel';
    this.panel.hidden = true;
    const head = document.createElement('div');
    head.className = 'soc-head';
    const title = document.createElement('span');
    title.textContent = '💬 Room chat';
    const x = document.createElement('button');
    x.className = 'soc-x';
    x.textContent = '✕';
    x.title = 'Close chat (Esc)';
    x.addEventListener('click', () => this.close());
    head.append(title, x);
    this.log = document.createElement('div');
    this.log.className = 'soc-log';
    const row = document.createElement('div');
    row.className = 'soc-quick-row';
    QUICK_CHAT.forEach((q, i) => {
      const b = document.createElement('button');
      b.textContent = `${q.emoji} ${q.text}`;
      b.addEventListener('click', () => this.quick(i));
      row.append(b);
    });
    const form = document.createElement('form');
    form.className = 'soc-form';
    this.input = document.createElement('input');
    Object.assign(this.input, { type: 'text', maxLength: CHAT.maxLen, placeholder: 'Say something… (Enter)', autocomplete: 'off', enterKeyHint: 'send' });
    this.input.setAttribute('aria-label', 'Chat message');
    const go = document.createElement('button');
    go.type = 'submit';
    go.textContent = 'Send';
    form.append(this.input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = '';
      if (text) this.send(text);
      else this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never reaches the game or menu shortcuts
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.panel.append(head, this.log, row, form);
    this.feed = document.createElement('div');
    this.feed.className = 'soc-feed';
    parent.append(this.panel, this.feed);
  }

  /** Replace the whole log (first join, or after (un)muting someone). */
  setLines(lines: ChatLine[]) {
    this.log.replaceChildren(...lines.filter((l) => !mutes.has(l.id)).map((l) => lineEl(l, 'soc-line')));
    this.log.scrollTop = this.log.scrollHeight;
  }

  add(l: ChatLine, mine: boolean) {
    if (l.id && mutes.has(l.id)) return;
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;
    this.log.append(lineEl(l, 'soc-line'));
    while (this.log.childElementCount > CHAT.history) this.log.firstElementChild?.remove();
    if (stick || mine) this.log.scrollTop = this.log.scrollHeight;
    if (!this.isOpen) {
      const f = lineEl(l, 'soc-feed-line');
      this.feed.append(f);
      while (this.feed.childElementCount > FEED_MAX) this.feed.firstElementChild?.remove();
      setTimeout(() => f.remove(), FEED_MS);
      if (!mine && l.id) { this.unread++; this.onUnread(this.unread); }
    }
  }

  open(focus: boolean) {
    this.isOpen = true;
    this.panel.hidden = false;
    this.feed.replaceChildren();
    this.unread = 0;
    this.onUnread(0);
    this.log.scrollTop = this.log.scrollHeight;
    if (focus) this.input.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.input.blur();
    this.closed();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open(true);
  }
}
