// Extra formats and world systems layered on top of a session without touching the core loop:
// Time Attack medals and Elimination for circuit races, and open-world traffic with near misses.
// Game calls createModes() once, then update(dt) every frame and dispose() at the end.
import '../styles/modes.css';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Standing } from '../systems/Race';
import { Circuit } from '../world/layout';
import type { VehicleModel } from '../entities/vehicleModels';
import type { Contacts } from '../systems/Contacts';
import { TimeAttack } from './TimeAttack';
import { Elimination } from './Elimination';
import { Traffic } from './Traffic';

export interface ModeFeature {
  update(dt: number): void;
  dispose(): void;
  /** Reorder / annotate the final race table. */
  results?(rows: Standing[]): Standing[];
  /** Extra vehicles for the replay recorder (traffic): called once per recorded frame. */
  replayActors?(visit: ReplayVisit): void;
  /** Vehicles for the contact pass (systems/Contacts): called every physics step. */
  contactBodies?(c: Contacts): void;
}

/** Records one extra vehicle (key = a stable object per vehicle; a hidden root = not on screen in that frame). */
export type ReplayVisit = (key: object, model: VehicleModel, name: string, color: number, vehicle: string) => void;

/** Mode panels sit in the HUD's top-centre zone under the race box, so they follow HUD size/opacity, the
 *  responsive zone scaling and never overlap the race panel. */
export function mountTopCentre(p: Player, el: HTMLElement) {
  const zone = p.hud.root.querySelector('.z-tc');
  if (zone) zone.insertBefore(el, zone.querySelector('.racebox')?.nextSibling ?? null);
  else p.hud.root.appendChild(el);
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
