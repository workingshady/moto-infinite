// Opens and closes the replay panel and photo mode for one game session, and shows the
// "instant replay" prompt after a crash or a big trick (I key or tap).
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { ReplayEventKind } from '../systems/Replay';
import { REPLAY } from '../config';
import { ReplayPanel } from './ReplayPanel';
import { PhotoMode } from './PhotoMode';
import '../styles/replay.css';

/** Where the studio was opened from, so closing returns there. */
export type StudioFrom = 'play' | 'pause' | 'results';

export class ReplayStudio {
  private view: ReplayPanel | PhotoMode | null = null;
  private from: StudioFrom = 'play';
  private prompt: HTMLButtonElement;
  private promptTimer = 0;

  constructor(private game: Game, private onClose: (from: StudioFrom) => void) {
    this.prompt = document.createElement('button');
    this.prompt.className = 'rp-prompt';
    this.prompt.hidden = true;
    this.prompt.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.prompt.addEventListener('click', () => this.openReplay('play'));
    document.body.appendChild(this.prompt);
    if (game.replay) game.replay.onEvent = (k, p, pts) => this.onEvent(k, p, pts);
    addEventListener('keydown', this.onKey);
  }

  get active() {
    return this.view !== null;
  }

  /** Instant replay only in local games: online rooms can't pause, so the bike would ride on uncontrolled. */
  private get canInstant() {
    return !this.view && !this.game.net && this.game.input.enabled && !this.game.paused && (this.game.replay?.count ?? 0) > REPLAY.hz;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyI' || e.repeat || !this.canInstant) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.openReplay('play');
  };

  private onEvent(kind: ReplayEventKind, p: Player | null, pts: number) {
    if (!p) return; // AI and online riders never interrupt
    const big = kind === 'crash' || (kind === 'trick' && pts >= REPLAY.promptTrickPts);
    if (!big || !this.canInstant) return;
    this.prompt.innerHTML = `▶ Instant replay <kbd>I</kbd><small>${kind === 'crash' ? 'watch that crash' : 'watch that trick'}</small>`;
    this.prompt.hidden = false;
    clearTimeout(this.promptTimer);
    this.promptTimer = window.setTimeout(() => (this.prompt.hidden = true), REPLAY.promptSecs * 1000);
  }

  /** Watch the last ~60 s. From gameplay it pauses the game itself; from menus the caller already did. */
  openReplay(from: StudioFrom) {
    const rp = this.game.replay;
    if (this.view || !rp || rp.count < 2) return false;
    this.begin(from);
    this.view = new ReplayPanel(this.game, () => this.close(), from === 'play' ? REPLAY.instantBack : REPLAY.seconds);
    this.game.view = this.view;
    this.game.career?.feat('replay');
    return true;
  }

  openPhoto(from: StudioFrom) {
    if (this.view || !this.game.players.length) return false;
    this.begin(from);
    this.view = new PhotoMode(this.game, () => this.close());
    this.game.view = this.view;
    return true;
  }

  private begin(from: StudioFrom) {
    this.from = from;
    this.prompt.hidden = true;
    if (from === 'play') this.game.setMenuPaused(true);
    this.game.input.reset();
    document.body.classList.add('studio-on');
  }

  close() {
    if (!this.view) return;
    this.view.dispose();
    this.view = null;
    this.game.view = null;
    document.body.classList.remove('studio-on');
    this.onClose(this.from);
  }

  dispose() {
    if (this.view) { this.view.dispose(); this.view = null; this.game.view = null; }
    document.body.classList.remove('studio-on');
    if (this.game.replay) this.game.replay.onEvent = null;
    clearTimeout(this.promptTimer);
    removeEventListener('keydown', this.onKey);
    this.prompt.remove();
  }
}
