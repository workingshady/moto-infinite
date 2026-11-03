// Extra formats and world systems layered on top of a session without touching the core loop:
// Time Attack medals and Elimination for circuit races, and open-world traffic with near misses.
// Game calls createModes() once, then update(dt) every frame and dispose() at the end.
import '../styles/modes.css';
import type { Game } from '../core/Game';
import type { Standing } from '../systems/Race';
import { Circuit } from '../world/layout';
import { TimeAttack } from './TimeAttack';
import { Elimination } from './Elimination';
import { Traffic } from './Traffic';

export interface ModeFeature {
  update(dt: number): void;
  dispose(): void;
  /** Reorder / annotate the final race table. */
  results?(rows: Standing[]): Standing[];
}

export function createModes(game: Game): ModeFeature[] {
  const o = game.opts, out: ModeFeature[] = [];
  if (o.attract || !game.players.length) return out;
  const circuit = o.mode === 'race' && game.layout instanceof Circuit && game.race ? game.layout : null;
  if (circuit && o.variant === 'attack') out.push(new TimeAttack(game, circuit));
  if (circuit && o.variant === 'elim') out.push(new Elimination(game, circuit));
  if (o.mode === 'open' && !o.net && !o.tutorial && (o.traffic ?? 1) > 0) out.push(new Traffic(game, o.traffic ?? 1));
  if (out.some((m) => m.results)) {
    // results pass through every mode once (the race and a mode may both try to end it)
    const show = game.hooks.onRaceResults.bind(game.hooks);
    let sent = false;
    game.hooks.onRaceResults = (rows) => {
      if (sent) return;
      sent = true;
      for (const m of out) if (m.results) rows = m.results(rows);
      show(rows);
    };
  }
  return out;
}
