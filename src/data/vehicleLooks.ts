// Shape specs for the expansion vehicles (vehiclesExtra.ts). Pure data: src/entities/vehicleBuilders.ts turns
// each spec into a low-poly model with a handful of parametric builders (car body, formula car, bike).
// Units are metres, forward = +z, ground = y 0. Defaults live in the builders; only what differs is listed.
import type { ExtraVehicleId } from './vehiclesExtra';

export type RimStyle = 'dish' | 'spoke' | 'five' | 'lock' | 'bbs' | 'mag' | 'gravel' | 'beadlock' | 'wire';
/** Cabin/greenhouse family; the body profile itself comes from the numbers. */
export type CarShape = 'coupe' | 'fastback' | 'saloon' | 'wagon' | 'hatch' | 'wedge' | 'roadster' | 'proto' | 'pickup' | 'suv' | 'buggy';
export type CarExtra =
  | 'cage' | 'scoop' | 'blower' | 'roofscoop' | 'lightpod' | 'snorkel' | 'spare' | 'bullbar' | 'roofrack' | 'fin'
  | 'louvres' | 'mudflaps' | 'lightbar' | 'straps' | 'tailfins' | 'splitter' | 'diffuser' | 'sidepods' | 'fan' | 'bed'
  | 'rollbar' | 'engine' | 'grille7' | 'shocks' | 'chrome' | 'nosecone' | 'canards' | 'hoodvents' | 'whitewall' | 'roofline';

export interface CarLook {
  kind: 'car';
  shape: CarShape;
  /** Half length, body width, beltline (top of the sides at the cowl), sill (bottom of the body). */
  L: number; W: number; belt: number; sill: number;
  /** Bonnet drop at the very front (wedges ~0.3) and tail-deck rise (+ duck tail). */
  nose?: number; deck?: number;
  /** Roof height (0 = open top) and cabin foot z: [windscreen base, rear-glass base]. */
  roof?: number; cab: [number, number];
  /** Windscreen / rear-glass rake (z run), greenhouse width as a fraction of W. */
  ws?: number; bl?: number; cabW?: number;
  wheel: number; rearWheel?: number; tyre?: number; rearTyre?: number; track?: number; fz?: number; rz?: number;
  rim: RimStyle;
  lights: 'round' | 'quad' | 'square' | 'slim' | 'popup' | 'bar' | 'none';
  tail: 'bar' | 'round' | 'block' | 'fins';
  arches?: 'flare' | 'round' | 'box' | 'none';
  bumpers?: 'chrome' | 'dark';
  /** Rear wing: height above the deck, chord, span (fraction of W), endplates, body-coloured. */
  wing?: { h: number; c: number; w?: number; plates?: boolean; paint?: boolean; z?: number };
  exhaust: 'single' | 'twin' | 'quad' | 'center' | 'side' | 'stack' | 'none';
  stripe?: 'twin' | 'side' | 'livery' | 'twotone' | 'rocker';
  number?: string;
  extras?: CarExtra[];
  /** Driver hips [x, y, z]; computed from the cabin when omitted. 0 x = central seat. */
  seat?: [number, number, number];
}

export interface FormulaLook {
  kind: 'formula';
  /** front-engined 50s, 60s cigar, 80s turbo, 90s active, 2030s concept. */
  era: 'front' | 'cigar' | 'turbo' | 'active' | 'concept';
  rf: number; rr: number; wf: number; wr: number; track: [number, number]; fz: number; rz: number;
  number: string; spokes: number; rimFrac: number; grooved?: boolean; wire?: boolean;
}

export interface BikeLook {
  kind: 'bike';
  style: 'board' | 'gp' | 'motard' | 'adv' | 'electric';
  rim: ['cast' | 'wire' | 'knobby', 'cast' | 'wire' | 'knobby'];
  tube: [number, number];
  disc: [number, number];
  fz?: number; rz?: number;
  number?: string;
}

export type VehicleLook = CarLook | FormulaLook | BikeLook;

export const LOOKS: Record<ExtraVehicleId, VehicleLook> = {
  // ---- motorcycles ----
  board_track: { kind: 'bike', style: 'board', rim: ['wire', 'wire'], tube: [0.07, 0.07], disc: [0, 0], fz: 1.15, rz: -1.05, number: '9' },
  gp250: { kind: 'bike', style: 'gp', rim: ['cast', 'cast'], tube: [0.12, 0.15], disc: [0.26, 0.18], fz: 1.0, rz: -0.95, number: '74' },
  supermoto: { kind: 'bike', style: 'motard', rim: ['wire', 'wire'], tube: [0.14, 0.17], disc: [0.3, 0.2], number: '11' },
  adventure: { kind: 'bike', style: 'adv', rim: ['wire', 'wire'], tube: [0.13, 0.17], disc: [0.26, 0.22], fz: 1.15, rz: -1.05 },
  e_superbike: { kind: 'bike', style: 'electric', rim: ['cast', 'cast'], tube: [0.15, 0.19], disc: [0.27, 0.2] },

  // ---- Drift ----
  drift_wagon: { kind: 'car', shape: 'wagon', L: 2.35, W: 1.72, belt: 0.82, sill: 0.24, nose: 0.12, roof: 1.36, cab: [0.85, -2.2], ws: 0.75, bl: 0.12,
    wheel: 0.33, rim: 'dish', lights: 'square', tail: 'block', arches: 'flare', exhaust: 'single', fz: 1.45, rz: -1.42, extras: ['cage', 'roofline', 'splitter'] },
  drift_kei: { kind: 'car', shape: 'roadster', L: 1.65, W: 1.4, belt: 0.72, sill: 0.2, nose: 0.1, roof: 0, cab: [0.25, -0.75],
    wheel: 0.28, tyre: 0.2, track: 0.62, fz: 1.0, rz: -0.95, rim: 'five', lights: 'round', tail: 'round', arches: 'round', exhaust: 'center', extras: ['rollbar'], seat: [0.25, 0.25, -0.35] },
  drift_kreis: { kind: 'car', shape: 'saloon', L: 2.15, W: 1.64, belt: 0.8, sill: 0.24, nose: 0.02, roof: 1.32, cab: [0.75, -1.25], ws: 0.55, bl: 0.4,
    wheel: 0.32, rim: 'bbs', lights: 'quad', tail: 'block', arches: 'box', bumpers: 'dark', exhaust: 'twin', stripe: 'rocker', extras: ['splitter', 'cage'] },
  drift_swap: { kind: 'car', shape: 'coupe', L: 2.25, W: 1.9, belt: 0.74, sill: 0.16, nose: 0.2, roof: 1.18, cab: [0.6, -1.15], ws: 0.75, bl: 0.75,
    wheel: 0.34, tyre: 0.28, rearTyre: 0.32, track: 0.84, rim: 'lock', lights: 'slim', tail: 'bar', arches: 'box', exhaust: 'side',
    wing: { h: 0.45, c: 0.42, w: 1.05, plates: true }, stripe: 'livery', number: '777', extras: ['cage', 'splitter', 'canards', 'hoodvents', 'diffuser'] },
  drift_ev: { kind: 'car', shape: 'fastback', L: 2.3, W: 1.86, belt: 0.72, sill: 0.18, nose: 0.22, roof: 1.12, cab: [0.7, -0.9], ws: 0.85, bl: 1.0, cabW: 0.78,
    wheel: 0.35, tyre: 0.28, track: 0.82, rim: 'spoke', lights: 'bar', tail: 'bar', arches: 'flare', exhaust: 'none', stripe: 'side', extras: ['splitter', 'diffuser', 'canards'] },

  // ---- Race ----
  race_spyder: { kind: 'car', shape: 'roadster', L: 1.9, W: 1.5, belt: 0.72, sill: 0.2, nose: 0.25, deck: 0.04, roof: 0, cab: [0.2, -0.7],
    wheel: 0.3, tyre: 0.18, track: 0.66, fz: 1.08, rz: -1.02, rim: 'dish', lights: 'round', tail: 'round', arches: 'round', exhaust: 'center', stripe: 'livery', number: '130', extras: ['rollbar', 'louvres'] },
  race_canam: { kind: 'car', shape: 'roadster', L: 2.2, W: 1.9, belt: 0.66, sill: 0.14, nose: 0.38, deck: 0.1, roof: 0, cab: [0.45, -0.45],
    wheel: 0.34, rearWheel: 0.38, tyre: 0.3, rearTyre: 0.42, track: 0.82, rim: 'mag', lights: 'none', tail: 'round', arches: 'round', exhaust: 'stack',
    wing: { h: 0.75, c: 0.45, w: 0.95, plates: true, paint: true, z: -1.85 }, stripe: 'livery', number: '4', extras: ['rollbar', 'engine', 'splitter'] },
  race_groupc: { kind: 'car', shape: 'proto', L: 2.4, W: 1.95, belt: 0.72, sill: 0.12, nose: 0.36, deck: 0.1, roof: 1.08, cab: [0.75, -0.55], ws: 0.75, bl: 0.6, cabW: 0.62,
    wheel: 0.34, tyre: 0.28, rearTyre: 0.34, track: 0.8, rim: 'lock', lights: 'slim', tail: 'block', arches: 'none', exhaust: 'center',
    wing: { h: 0.12, c: 0.4, w: 1.0, plates: true, paint: true }, stripe: 'livery', number: '17', extras: ['sidepods', 'diffuser', 'roofscoop'] },
  race_stock: { kind: 'car', shape: 'coupe', L: 2.5, W: 1.9, belt: 0.8, sill: 0.16, nose: 0.15, roof: 1.3, cab: [0.85, -1.15], ws: 0.75, bl: 0.95,
    wheel: 0.36, tyre: 0.3, track: 0.84, rim: 'mag', lights: 'none', tail: 'block', arches: 'flare', exhaust: 'side',
    wing: { h: 0.05, c: 0.18, w: 0.95 }, stripe: 'livery', number: '48', extras: ['cage', 'splitter', 'roofline'] },
  race_lmh: { kind: 'car', shape: 'proto', L: 2.45, W: 1.95, belt: 0.66, sill: 0.12, nose: 0.34, deck: 0.18, roof: 1.06, cab: [0.85, -0.25], ws: 0.75, bl: 0.4, cabW: 0.55,
    wheel: 0.36, tyre: 0.32, track: 0.82, rim: 'lock', lights: 'slim', tail: 'bar', arches: 'flare', exhaust: 'center',
    wing: { h: 0.22, c: 0.38, w: 1.0, plates: true }, stripe: 'livery', number: '8', extras: ['fin', 'splitter', 'diffuser', 'sidepods'] },

  // ---- Muscle ----
  muscle_pony: { kind: 'car', shape: 'fastback', L: 2.25, W: 1.7, belt: 0.82, sill: 0.26, nose: 0.04, roof: 1.27, cab: [0.6, -1.65], ws: 0.65, bl: 1.15,
    wheel: 0.34, rim: 'mag', lights: 'round', tail: 'block', arches: 'none', bumpers: 'chrome', exhaust: 'twin', stripe: 'twin', extras: ['scoop', 'louvres'] },
  muscle_aero: { kind: 'car', shape: 'coupe', L: 2.65, W: 1.8, belt: 0.84, sill: 0.26, nose: 0.42, roof: 1.3, cab: [0.55, -1.25], ws: 0.75, bl: 0.6,
    wheel: 0.35, rim: 'dish', lights: 'popup', tail: 'block', arches: 'none', bumpers: 'chrome', exhaust: 'twin',
    wing: { h: 0.62, c: 0.3, w: 1.0, plates: false, paint: true, z: -2.35 }, stripe: 'side', number: '43', extras: ['nosecone', 'scoop'] },
  muscle_widow: { kind: 'car', shape: 'coupe', L: 2.4, W: 1.76, belt: 0.82, sill: 0.24, nose: 0.06, roof: 1.3, cab: [0.5, -1.3], ws: 0.65, bl: 0.45,
    wheel: 0.34, rim: 'mag', lights: 'square', tail: 'bar', arches: 'none', bumpers: 'dark', exhaust: 'twin', stripe: 'rocker', extras: ['hoodvents'] },
  muscle_ute: { kind: 'car', shape: 'pickup', L: 2.5, W: 1.84, belt: 0.86, sill: 0.24, nose: 0.12, roof: 1.36, cab: [0.85, -0.55], ws: 0.75, bl: 0.12,
    wheel: 0.36, tyre: 0.27, track: 0.8, rim: 'five', lights: 'slim', tail: 'block', arches: 'flare', exhaust: 'twin', stripe: 'twin', extras: ['bed', 'hoodvents'] },
  muscle_hell: { kind: 'car', shape: 'coupe', L: 2.5, W: 1.92, belt: 0.86, sill: 0.2, nose: 0.06, roof: 1.3, cab: [0.45, -1.4], ws: 0.75, bl: 0.7,
    wheel: 0.37, tyre: 0.28, rearTyre: 0.34, track: 0.84, rim: 'spoke', lights: 'slim', tail: 'bar', arches: 'flare', exhaust: 'quad',
    wing: { h: 0.02, c: 0.16, w: 0.95, paint: true }, stripe: 'twin', extras: ['scoop', 'splitter'] },

  // ---- Rally ----
  rally_berlin: { kind: 'car', shape: 'fastback', L: 1.95, W: 1.55, belt: 0.72, sill: 0.28, nose: 0.12, roof: 1.13, cab: [0.45, -1.4], ws: 0.55, bl: 0.75,
    wheel: 0.3, tyre: 0.2, track: 0.68, fz: 1.12, rz: -1.05, rim: 'gravel', lights: 'quad', tail: 'round', arches: 'round', exhaust: 'twin', number: '18', extras: ['lightpod', 'mudflaps'] },
  rally_wedge: { kind: 'car', shape: 'wedge', L: 1.85, W: 1.75, belt: 0.82, sill: 0.28, nose: 0.36, roof: 1.18, cab: [0.85, -0.45], ws: 1.0, bl: 0.25, cabW: 0.86,
    wheel: 0.34, tyre: 0.28, track: 0.78, fz: 1.1, rz: -1.05, rim: 'gravel', lights: 'popup', tail: 'round', arches: 'flare', exhaust: 'quad',
    wing: { h: 0.06, c: 0.22, w: 0.95, paint: true }, stripe: 'livery', number: '1', extras: ['lightpod', 'mudflaps', 'louvres'] },
  rally_groupb: { kind: 'car', shape: 'hatch', L: 1.95, W: 1.8, belt: 0.86, sill: 0.3, nose: 0.06, roof: 1.38, cab: [0.75, -1.6], ws: 0.65, bl: 0.3,
    wheel: 0.34, tyre: 0.28, track: 0.8, fz: 1.25, rz: -1.15, rim: 'gravel', lights: 'square', tail: 'bar', arches: 'box', exhaust: 'twin',
    wing: { h: 0.0, c: 0.3, w: 0.9, plates: true, paint: true }, stripe: 'livery', number: '2', extras: ['lightpod', 'mudflaps', 'roofscoop', 'sidepods'] },
  rally_rx: { kind: 'car', shape: 'hatch', L: 2.0, W: 1.86, belt: 0.82, sill: 0.26, nose: 0.1, roof: 1.36, cab: [0.7, -1.65], ws: 0.75, bl: 0.25,
    wheel: 0.34, tyre: 0.28, track: 0.82, fz: 1.3, rz: -1.2, rim: 'lock', lights: 'slim', tail: 'block', arches: 'box', exhaust: 'center',
    wing: { h: 0.18, c: 0.32, w: 0.95, plates: true }, stripe: 'livery', number: '13', extras: ['mudflaps', 'splitter', 'roofscoop', 'cage'] },
  rally_r1: { kind: 'car', shape: 'hatch', L: 2.1, W: 1.88, belt: 0.84, sill: 0.3, nose: 0.12, roof: 1.38, cab: [0.75, -1.7], ws: 0.75, bl: 0.3,
    wheel: 0.35, tyre: 0.27, track: 0.82, rim: 'gravel', lights: 'slim', tail: 'bar', arches: 'box', exhaust: 'twin',
    wing: { h: 0.12, c: 0.42, w: 1.0, plates: true }, stripe: 'livery', number: '69', extras: ['mudflaps', 'splitter', 'roofscoop', 'canards', 'diffuser'] },

  // ---- Hypercar ----
  hyper_wedge: { kind: 'car', shape: 'wedge', L: 2.2, W: 1.94, belt: 0.74, sill: 0.16, nose: 0.34, deck: 0.04, roof: 1.12, cab: [0.7, -0.4], ws: 0.75, bl: 0.2, cabW: 0.72,
    wheel: 0.34, rearWheel: 0.35, tyre: 0.26, rearTyre: 0.33, track: 0.84, rim: 'five', lights: 'popup', tail: 'round', arches: 'none', exhaust: 'center',
    wing: { h: 0.06, c: 0.38, w: 1.0, plates: true, paint: true }, extras: ['louvres', 'sidepods', 'hoodvents'] },
  hyper_v12: { kind: 'car', shape: 'proto', L: 2.15, W: 1.82, belt: 0.72, sill: 0.16, nose: 0.3, deck: 0.04, roof: 1.12, cab: [0.85, -0.6], ws: 0.9, bl: 0.55, cabW: 0.74,
    wheel: 0.33, tyre: 0.25, rearTyre: 0.3, track: 0.8, rim: 'five', lights: 'slim', tail: 'round', arches: 'round', exhaust: 'center',
    extras: ['roofscoop', 'sidepods', 'diffuser'], seat: [0, 0.2, -0.3] },
  hyper_w16: { kind: 'car', shape: 'proto', L: 2.3, W: 2.0, belt: 0.78, sill: 0.16, nose: 0.28, deck: 0.02, roof: 1.2, cab: [0.85, -0.85], ws: 0.9, bl: 0.75, cabW: 0.72,
    wheel: 0.37, tyre: 0.28, rearTyre: 0.34, track: 0.86, rim: 'spoke', lights: 'slim', tail: 'bar', arches: 'flare', exhaust: 'quad', stripe: 'twotone',
    wing: { h: 0.0, c: 0.32, w: 0.9, paint: true }, extras: ['chrome', 'roofline', 'diffuser'] },
  hyper_ev: { kind: 'car', shape: 'proto', L: 2.3, W: 1.98, belt: 0.7, sill: 0.15, nose: 0.3, deck: 0.06, roof: 1.1, cab: [0.95, -0.75], ws: 0.95, bl: 0.9, cabW: 0.66,
    wheel: 0.36, tyre: 0.3, rearTyre: 0.33, track: 0.86, rim: 'spoke', lights: 'bar', tail: 'bar', arches: 'flare', exhaust: 'none', stripe: 'side', extras: ['splitter', 'diffuser', 'canards'] },
  hyper_fan: { kind: 'car', shape: 'proto', L: 2.4, W: 2.0, belt: 0.6, sill: 0.1, nose: 0.26, deck: 0.24, roof: 1.02, cab: [0.85, -0.2], ws: 0.75, bl: 0.4, cabW: 0.5,
    wheel: 0.35, tyre: 0.32, track: 0.86, rim: 'lock', lights: 'bar', tail: 'bar', arches: 'flare', exhaust: 'center',
    wing: { h: 0.32, c: 0.34, w: 0.85, plates: true }, stripe: 'livery', extras: ['fan', 'fin', 'splitter', 'diffuser', 'sidepods'], seat: [0, 0.12, -0.05] },

  // ---- Off-road ----
  off_jeep: { kind: 'car', shape: 'roadster', L: 1.65, W: 1.56, belt: 1.12, sill: 0.48, nose: 0.0, roof: 0, cab: [0.45, -0.95],
    wheel: 0.38, tyre: 0.24, track: 0.66, fz: 0.98, rz: -1.0, rim: 'beadlock', lights: 'round', tail: 'round', arches: 'none', exhaust: 'single', extras: ['grille7', 'spare'], seat: [0.3, 0.68, -0.45] },
  off_buggy: { kind: 'car', shape: 'buggy', L: 1.65, W: 1.5, belt: 0.72, sill: 0.34, nose: 0.12, roof: 0, cab: [0.45, -0.75],
    wheel: 0.34, rearWheel: 0.4, tyre: 0.24, rearTyre: 0.36, track: 0.72, fz: 1.08, rz: -1.0, rim: 'dish', lights: 'round', tail: 'round', arches: 'none', exhaust: 'twin', extras: ['rollbar', 'engine'], seat: [0.3, 0.42, -0.35] },
  off_crawler: { kind: 'car', shape: 'suv', L: 2.2, W: 1.8, belt: 1.26, sill: 0.62, nose: 0.02, roof: 1.98, cab: [0.85, -2.05], ws: 0.35, bl: 0.06,
    wheel: 0.44, tyre: 0.34, track: 0.82, fz: 1.35, rz: -1.35, rim: 'beadlock', lights: 'round', tail: 'block', arches: 'box', bumpers: 'dark', exhaust: 'single', extras: ['snorkel', 'roofrack', 'bullbar', 'spare', 'grille7'] },
  off_monster: { kind: 'car', shape: 'pickup', L: 2.45, W: 2.0, belt: 2.0, sill: 1.4, nose: 0.1, roof: 2.5, cab: [0.85, -0.45], ws: 0.6, bl: 0.12,
    wheel: 0.95, tyre: 0.7, track: 1.25, fz: 1.55, rz: -1.55, rim: 'beadlock', lights: 'square', tail: 'block', arches: 'none', exhaust: 'stack', stripe: 'livery', extras: ['bed', 'shocks', 'lightbar', 'cage'] },
  off_dakar: { kind: 'car', shape: 'wedge', L: 2.4, W: 1.98, belt: 1.16, sill: 0.62, nose: 0.3, roof: 1.78, cab: [0.85, -0.55], ws: 0.75, bl: 0.4, cabW: 0.78,
    wheel: 0.48, tyre: 0.34, track: 0.88, fz: 1.5, rz: -1.45, rim: 'beadlock', lights: 'slim', tail: 'block', arches: 'none', exhaust: 'twin', stripe: 'livery', number: '201',
    extras: ['roofscoop', 'shocks', 'lightpod', 'mudflaps', 'fin', 'spare'] },

  // ---- Classic ----
  classic_blower: { kind: 'car', shape: 'roadster', L: 2.25, W: 1.5, belt: 1.02, sill: 0.42, nose: 0.0, roof: 0, cab: [-0.1, -1.4],
    wheel: 0.44, tyre: 0.16, track: 0.7, fz: 1.45, rz: -1.35, rim: 'wire', lights: 'round', tail: 'round', arches: 'round', exhaust: 'side', number: '9', extras: ['blower', 'straps', 'spare', 'grille7'] },
  classic_gullwing: { kind: 'car', shape: 'fastback', L: 2.25, W: 1.72, belt: 0.82, sill: 0.26, nose: 0.12, roof: 1.3, cab: [0.35, -1.35], ws: 0.7, bl: 0.8, cabW: 0.8,
    wheel: 0.35, tyre: 0.2, track: 0.74, rim: 'wire', lights: 'round', tail: 'round', arches: 'round', bumpers: 'chrome', exhaust: 'single', extras: ['chrome', 'hoodvents'] },
  classic_fins: { kind: 'car', shape: 'coupe', L: 2.7, W: 1.95, belt: 0.86, sill: 0.28, nose: 0.02, deck: 0.04, roof: 1.32, cab: [0.6, -1.0], ws: 0.6, bl: 0.6,
    wheel: 0.36, track: 0.84, rim: 'dish', lights: 'quad', tail: 'fins', arches: 'none', bumpers: 'chrome', exhaust: 'twin', stripe: 'twotone', extras: ['tailfins', 'chrome', 'whitewall'] },
  classic_mini: { kind: 'car', shape: 'saloon', L: 1.52, W: 1.42, belt: 0.74, sill: 0.2, nose: 0.06, roof: 1.32, cab: [0.6, -1.25], ws: 0.25, bl: 0.12,
    wheel: 0.25, tyre: 0.18, track: 0.62, fz: 1.05, rz: -1.05, rim: 'five', lights: 'round', tail: 'block', arches: 'flare', bumpers: 'chrome', exhaust: 'single', stripe: 'twin', extras: ['lightpod'] },
  classic_rr: { kind: 'car', shape: 'fastback', L: 2.05, W: 1.66, belt: 0.74, sill: 0.24, nose: 0.12, deck: 0.04, roof: 1.22, cab: [0.5, -1.55], ws: 0.65, bl: 1.1,
    wheel: 0.32, tyre: 0.22, rearTyre: 0.28, track: 0.74, fz: 1.25, rz: -1.15, rim: 'five', lights: 'round', tail: 'bar', arches: 'round', bumpers: 'dark', exhaust: 'twin',
    wing: { h: 0.0, c: 0.3, w: 0.85, paint: true, z: -1.85 }, stripe: 'rocker', extras: [] },

  // ---- Formula 1 ----
  f1_1955: { kind: 'formula', era: 'front', rf: 0.34, rr: 0.36, wf: 0.16, wr: 0.2, track: [0.66, 0.65], fz: 1.25, rz: -1.15, number: '2', spokes: 10, rimFrac: 0.72, grooved: true, wire: true },
  f1_1967: { kind: 'formula', era: 'cigar', rf: 0.3, rr: 0.33, wf: 0.2, wr: 0.3, track: [0.7, 0.7], fz: 1.25, rz: -1.2, number: '24', spokes: 8, rimFrac: 0.66 },
  f1_1986: { kind: 'formula', era: 'turbo', rf: 0.33, rr: 0.34, wf: 0.3, wr: 0.44, track: [0.82, 0.78], fz: 1.5, rz: -1.35, number: '6', spokes: 6, rimFrac: 0.62 },
  f1_1992: { kind: 'formula', era: 'active', rf: 0.33, rr: 0.33, wf: 0.32, wr: 0.42, track: [0.8, 0.76], fz: 1.55, rz: -1.45, number: '5', spokes: 5, rimFrac: 0.6 },
  f1_2035: { kind: 'formula', era: 'concept', rf: 0.37, rr: 0.37, wf: 0.32, wr: 0.38, track: [0.82, 0.78], fz: 1.75, rz: -1.65, number: '35', spokes: 7, rimFrac: 0.72 },
};
