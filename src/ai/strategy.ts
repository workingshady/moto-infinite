// Formula 1 race strategy for the computer racers: stint plan, pit window with undercut / overcut calls, compound
// choice, DRS (only in a DRS zone and within 1 s of the car ahead at the zone's detection point) and ERS
// (deploy on straights, attack and defence, harvest under braking). Pure decisions (unit-tested); driver.ts acts on them.
import { AI, F1, type TyreCompound } from '../config';

export const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard'];

export interface StratInput {
  lap: number; // laps completed
  laps: number; // race length
  lapLen: number; // metres
  compound: TyreCompound;
  startCompound: TyreCompound;
  wear: number;
  stops: number;
  /** Personal wear threshold (pitWear ± a little). */
  pitWear: number;
  /** Seconds to the car ahead / behind on track (Infinity = none). */
  gapAhead: number;
  gapBehind: number;
  /** Has the car ahead / behind already made as many stops as we will after this one? */
  aheadPitted: boolean;
  behindJustPitted: boolean;
  wet: boolean;
}

/** Wear one lap adds on a compound (distance part only; sliding and braking add ~25 %). */
export const wearPerLap = (c: TyreCompound, lapLen: number) => (lapLen / F1.tyres[c].life) * 1.25;

/** Laps still to run, counting the one in progress. */
const lapsLeft = (s: StratInput) => Math.max(0, s.laps - s.lap);

/**
 * Pick the next compound: the softest one that lasts the remaining distance below the wear limit; in the dry the
 * rules want two different compounds, so a car that has not yet run a second compound takes a different one.
 */
export function chooseCompound(s: Pick<StratInput, 'lap' | 'laps' | 'lapLen' | 'startCompound' | 'compound' | 'wet'>): TyreCompound {
  const left = Math.max(0.5, s.laps - s.lap);
  const fits = COMPOUNDS.filter((c) => wearPerLap(c, s.lapLen) * left <= AI.f1.lastWear);
  let pick: TyreCompound = fits[0] ?? 'hard';
  if (!s.wet && pick === s.startCompound && s.compound === s.startCompound) pick = fits.find((c) => c !== s.startCompound) ?? COMPOUNDS.find((c) => c !== s.startCompound)!;
  return pick;
}

/** Should the car come in at the end of this lap (decided on approach to the pit entry)? */
export function shouldPit(s: StratInput): { pit: boolean; why: string } {
  const left = lapsLeft(s);
  if (left <= 1) return { pit: false, why: 'last lap' }; // left counts the lap now running: never pit into the flag
  const mandatory = !s.wet && s.laps >= 3 && s.stops === 0;
  const perLap = wearPerLap(s.compound, s.lapLen), wearAtFlag = s.wear + perLap * left;
  // the tyre can't make the flag: must stop before it's gone
  if (s.wear + perLap > AI.f1.lastWear) return { pit: true, why: 'worn out' };
  // mandatory stop not yet made and this is the last chance
  if (mandatory && left <= 2) return { pit: true, why: 'mandatory stop' };
  if (!mandatory && wearAtFlag <= AI.f1.lastWear) return { pit: false, why: 'tyres last' };
  const inWindow = s.wear >= s.pitWear - 0.12 || (mandatory && left <= 3);
  if (!inWindow) return { pit: false, why: 'window closed' };
  // undercut: stuck within range of the car ahead which has not stopped: fresh tyres first
  if (s.gapAhead < AI.f1.undercutGap && !s.aheadPitted) return { pit: true, why: 'undercut' };
  // overcut: the car behind just pitted and we have clean air and tyres with life left: stay out a lap
  if (s.behindJustPitted && s.gapAhead > 2 && s.wear < s.pitWear + 0.08 && left > 1) return { pit: false, why: 'overcut' };
  return s.wear >= s.pitWear ? { pit: true, why: 'window' } : { pit: false, why: 'in window' };
}

/** DRS: inside a zone, detection gap below 1 s, not braking, car allows it. */
export function drsAllowed(inZone: boolean, detectGap: number, braking: boolean, active: boolean) {
  return active && inZone && detectGap < 1 && !braking;
}

/**
 * ERS deploy decision: on a straight (at or near full throttle), not under braking, keeping a reserve for defence;
 * attacking (car ahead within 1 s) or defending spends the reserve too.
 */
export function ersDeploy(energy: number, onStraight: boolean, braking: boolean, attacking: boolean, defending: boolean, aggression: number) {
  if (braking || !onStraight || energy <= 2) return false;
  if (attacking || defending) return true;
  return energy > AI.f1.ersReserve + AI.f1.ersDeployMin * (1 - aggression * 0.5);
}
