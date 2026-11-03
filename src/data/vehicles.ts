// Garage: every rideable vehicle with its handling. Names are fictional, classes/eras mirror real-world types.
// Speeds are game m/s (HUD shows them x3.6 as km/h, before nitro). `engine` drives the procedural engine sound.
import type { EngineProfile } from '../core/EngineSound';

export type VehicleKind = 'bike' | 'car';
export type VehicleModelId =
  | 'street' | 'superbike' | 'dirt' | 'cafe' | 'cruiser'
  | 'drift_coupe' | 'hatch' | 'gt' | 'muscle' | 'rally'
  | 'rotary' | 'hyper' | 'touring' | 'trophy' | 'roadster'
  | 'f1_2026' | 'f1_v10' | 'f1_classic'
  | 'tesla_roadster' | 'tesla_model3';

export interface VehicleDef {
  id: VehicleModelId;
  name: string;
  kind: VehicleKind;
  cls: string; // Sport / Superbike / Motocross / Café racer / Cruiser / Drift / Race / Muscle / Rally
  era: string;
  desc: string;
  top: number; // m/s
  accel: number;
  grip: number; // steering rate
  /** How quickly the travel direction catches up with where the vehicle points (lower = slides more). */
  traction: number;
  /** Traction while the handbrake / drift key is held. */
  slideTraction: number;
  hp: number; // extra durability
  offroad: number; // 0..1, 1 = no off-road penalty
  wheelie: boolean;
  engine: EngineProfile;
  /**
   * Open-wheel aero cars: downforce grows with speed², so the cornering limit (aLat, m/s² at low speed)
   * rises at speed; F1 brakes hard (m/s²), ERS adds acceleration, straight-mode wings cut drag.
   */
  f1?: F1Spec;
  /** Electric drivetrain (instant torque, regen, single speed; optional cold-gas thrusters). See EvSpec. */
  ev?: EvSpec;
  /** Fluff for the garage card. */
  spec: { power: string; weight: string; layout: string };
  /** Career unlock: needs this career level and costs these credits. No rule = starter, always owned. */
  unlock?: VehicleUnlock;
}

export interface VehicleUnlock { level: number; price: number }

/**
 * Real-world-style F1 numbers. Physics derives everything from these:
 * drive force = min(power / v, traction), drag = ½ρ·CdA·v², downforce = ½ρ·ClA·v² (adds grip for cornering,
 * braking and traction). Top speed is wherever power meets drag — there is no artificial cap.
 */
export interface F1Spec {
  mass: number; // kg incl. driver
  power: number; // kW combustion engine
  ers: number; // kW electric deploy (0 = none)
  cda: number; // drag area m²
  cla: number; // downforce (lift) area m²
  mu: number; // tyre friction coefficient (lateral)
  muLong: number; // traction coefficient (drive)
  muBrake: number; // braking friction (carbon brakes + tyre)
  aero: 'active' | 'none'; // 2026 straight mode; older eras have fixed wings
}

/**
 * Electric cars: torque is available from 0 rpm, so launch acceleration is multiplied by `launch` and fades
 * out by `taper` x top speed; lifting off regenerates (`regen` m/s² of drag) and refills the boost meter.
 * `thrusters` swaps nitro for the cold-gas "SpaceX package" (numbers in config EV.thrust).
 */
export interface EvSpec {
  launch: number;
  taper: number;
  regen: number;
  regenCharge: number; // boost meter units / s while regenerating
  /** Track Mode style rear-biased torque: extra yaw (rad/s at full steer) on throttle mid-corner. */
  rearBias?: number;
  thrusters?: boolean;
}

export const VEHICLES: VehicleDef[] = [
  { id: 'street', name: 'Street 600', kind: 'bike', cls: 'Sport naked', era: '2020s', desc: 'Balanced all-rounder. Easy wheelies, forgiving grip.',
    top: 30, accel: 17, grip: 1.9, traction: 9, slideTraction: 2.2, hp: 0, offroad: 0.3, wheelie: true, engine: { type: 'i4', cyl: 4, idle: 1300, redline: 11500, gears: 6, crackle: 0.3 },
    spec: { power: '95 hp', weight: '185 kg', layout: 'Inline-4' } },
  { id: 'superbike', name: 'Vortex 1000RR', kind: 'bike', cls: 'Superbike', era: '2020s', desc: 'Brutal top speed, twitchy. Pros only.',
    top: 38, accel: 21, grip: 1.75, traction: 8, slideTraction: 2, hp: -10, offroad: 0.1, wheelie: true, engine: { type: 'i4', cyl: 4, idle: 1400, redline: 14500, gears: 6, crackle: 0.5, pitch: 0.92 },
    spec: { power: '210 hp', weight: '195 kg', layout: 'Inline-4' } },
  { id: 'dirt', name: 'Dust Devil 450', kind: 'bike', cls: 'Motocross', era: '2010s', desc: 'Light, launches high, ignores rough ground.',
    top: 27, accel: 19, grip: 2.2, traction: 7, slideTraction: 1.6, hp: 0, offroad: 1, wheelie: true, engine: { type: 'single', cyl: 1, idle: 1700, redline: 10500, gears: 5, crackle: 0.5 },
    spec: { power: '55 hp', weight: '105 kg', layout: 'Single' } },
  { id: 'cafe', name: 'Café 750', kind: 'bike', cls: 'Café racer', era: '1970s', desc: 'Old-school style, smooth and stable.',
    top: 27, accel: 14, grip: 1.85, traction: 10, slideTraction: 2.6, hp: 10, offroad: 0.2, wheelie: true, engine: { type: 'twin', cyl: 2, idle: 1000, redline: 8000, gears: 5, crackle: 0.3, lope: 0.2 },
    spec: { power: '68 hp', weight: '210 kg', layout: 'Parallel twin' } },
  { id: 'cruiser', name: 'Thunder Cruiser', kind: 'bike', cls: 'Cruiser', era: '1990s', desc: 'Heavy and tough. Lazy steering, huge torque.',
    top: 29, accel: 15, grip: 1.45, traction: 11, slideTraction: 3, hp: 50, offroad: 0.2, wheelie: false, engine: { type: 'vtwin', cyl: 2, idle: 800, redline: 5500, gears: 5, crackle: 0.4, lope: 0.75 },
    spec: { power: '90 hp', weight: '320 kg', layout: 'V-twin' } },
  { id: 'drift_coupe', name: 'Kitsune S-Spec', kind: 'car', cls: 'Drift', era: '1990s', desc: 'Rear-drive coupe built to slide. Handbrake and hold the angle.',
    top: 34, accel: 17, grip: 1.75, traction: 4, slideTraction: 0.8, hp: 40, offroad: 0.2, wheelie: false, engine: { type: 'i6', cyl: 6, idle: 900, redline: 7600, gears: 6, turbo: true, crackle: 0.4 },
    spec: { power: '280 hp', weight: '1,240 kg', layout: 'FR · turbo I6' } },
  { id: 'hatch', name: 'Panda 86', kind: 'car', cls: 'Drift', era: '1980s', desc: 'Light hatchback. Low power, perfect balance, mountain pass hero.',
    top: 29, accel: 13, grip: 2, traction: 5, slideTraction: 1.1, hp: 30, offroad: 0.3, wheelie: false, engine: { type: 'i4', cyl: 4, idle: 900, redline: 7800, gears: 5, crackle: 0.2 },
    spec: { power: '130 hp', weight: '940 kg', layout: 'FR · I4' } },
  { id: 'gt', name: 'Apex GT3', kind: 'car', cls: 'Race', era: '2020s', desc: 'Aero grip and speed. Hard to unstick, fastest on a circuit.',
    top: 42, accel: 22, grip: 2.25, traction: 12, slideTraction: 2.5, hp: 40, offroad: 0, wheelie: false, engine: { type: 'v8', cyl: 8, idle: 1200, redline: 9000, gears: 6, crackle: 0.7, lope: 0.15 },
    spec: { power: '550 hp', weight: '1,250 kg', layout: 'MR · V8' } },
  { id: 'muscle', name: 'Brute V8', kind: 'car', cls: 'Muscle', era: '1970s', desc: 'Torque monster. Power oversteer everywhere.',
    top: 36, accel: 20, grip: 1.45, traction: 3.5, slideTraction: 0.7, hp: 60, offroad: 0.3, wheelie: false, engine: { type: 'v8', cyl: 8, idle: 750, redline: 6200, gears: 4, crackle: 0.5, lope: 0.6 },
    spec: { power: '425 hp', weight: '1,600 kg', layout: 'FR · V8' } },
  { id: 'rally', name: 'Gravel 4WD', kind: 'car', cls: 'Rally', era: '2000s', desc: 'All-wheel drive. King of dirt, snow and rain.',
    top: 33, accel: 19, grip: 2.05, traction: 6, slideTraction: 1.4, hp: 50, offroad: 1, wheelie: false, engine: { type: 'i4', cyl: 4, idle: 1000, redline: 7600, gears: 6, turbo: true, crackle: 0.8 },
    spec: { power: '300 hp', weight: '1,230 kg', layout: '4WD · turbo I4' } },
  { id: 'rotary', name: 'Kaze 7R', kind: 'car', cls: 'Drift', era: '1990s', desc: 'Rotary-engined coupe. Revs forever, light tail, loves long slides.',
    top: 35, accel: 18, grip: 1.85, traction: 4.5, slideTraction: 0.9, hp: 35, offroad: 0.2, wheelie: false, engine: { type: 'rotary', cyl: 4, idle: 1000, redline: 9000, gears: 5, turbo: true, crackle: 0.8 },
    spec: { power: '276 hp', weight: '1,280 kg', layout: 'FR · twin-rotor' } },
  { id: 'hyper', name: 'Zenith Hyper', kind: 'car', cls: 'Hypercar', era: '2020s', desc: 'Absurd top speed and grip. Barely slides, flies on the straights.',
    top: 46, accel: 25, grip: 2.2, traction: 13, slideTraction: 3, hp: 30, offroad: 0, wheelie: false, engine: { type: 'hybrid', cyl: 8, idle: 1100, redline: 9500, gears: 7, turbo: true, crackle: 0.6 },
    spec: { power: '1,200 hp', weight: '1,380 kg', layout: 'MR · hybrid V8' } },
  { id: 'touring', name: 'Euro Touring 3', kind: 'car', cls: 'Race', era: '2000s', desc: 'Touring-car saloon. Stable, tough, made for door-to-door racing.',
    top: 36, accel: 18, grip: 2.1, traction: 10, slideTraction: 2.2, hp: 70, offroad: 0.1, wheelie: false, engine: { type: 'i4', cyl: 4, idle: 1000, redline: 8500, gears: 6, crackle: 0.6 },
    spec: { power: '310 hp', weight: '1,150 kg', layout: 'FR · I4' } },
  { id: 'trophy', name: 'Dune Trophy', kind: 'car', cls: 'Off-road', era: '2010s', desc: 'Desert trophy truck. Huge suspension, flies over anything.',
    top: 31, accel: 17, grip: 1.7, traction: 5.5, slideTraction: 1.3, hp: 90, offroad: 1, wheelie: false, engine: { type: 'v8', cyl: 8, idle: 800, redline: 6500, gears: 4, crackle: 0.4, lope: 0.5 },
    spec: { power: '850 hp', weight: '2,700 kg', layout: '4WD · V8' } },
  { id: 'roadster', name: 'Riviera GT', kind: 'car', cls: 'Classic', era: '1960s', desc: 'Open-top classic GT. Elegant, light steering, gentle drifts.',
    top: 31, accel: 14, grip: 1.8, traction: 6, slideTraction: 1.4, hp: 20, offroad: 0.1, wheelie: false, engine: { type: 'i6', cyl: 6, idle: 800, redline: 6500, gears: 4, crackle: 0.3 },
    spec: { power: '265 hp', weight: '1,150 kg', layout: 'FR · I6' } },
  // Formula cars: real-scale speeds for the 1:1 F1 circuits (HUD shows true km/h)
  { id: 'f1_2026', name: 'Formula 2026', kind: 'car', cls: 'Formula 1', era: '2026', desc: '768 kg + driver, 3.4 m wheelbase, active aero straight mode, 400 kW engine + 350 kW electric (tapers above ~290 km/h).',
    top: 90, accel: 30, grip: 2.6, traction: 16, slideTraction: 4, hp: 20, offroad: 0, wheelie: false,
    engine: { type: 'hybrid', cyl: 6, idle: 4000, redline: 15000, gears: 8, turbo: true, crackle: 0.2 },
    f1: { mass: 800, power: 400, ers: 350, cda: 1.25, cla: 3.4, mu: 1.75, muLong: 1.05, muBrake: 1.9, aero: 'active' },
    spec: { power: '~1,000 hp (V6 hybrid)', weight: '768 kg', layout: 'MR · 1.6 V6 turbo + ERS' } },
  { id: 'f1_v10', name: 'Formula V10', kind: 'car', cls: 'Formula 1', era: '2004', desc: 'The screaming V10 era: 19,000 rpm, 670 kW, peak downforce, no DRS (it came in 2011).',
    top: 92, accel: 29, grip: 2.5, traction: 15, slideTraction: 3.6, hp: 15, offroad: 0, wheelie: false,
    engine: { type: 'v10', cyl: 10, idle: 5000, redline: 19000, gears: 7, crackle: 0.5, pitch: 0.8 },
    f1: { mass: 690, power: 670, ers: 0, cda: 1.2, cla: 4.2, mu: 1.75, muLong: 1.0, muBrake: 1.9, aero: 'none' },
    spec: { power: '~900 hp (3.0 V10)', weight: '605 kg', layout: 'MR · 3.0 V10' } },
  { id: 'f1_classic', name: 'Formula 1976', kind: 'car', cls: 'Formula 1', era: '1970s', desc: 'Cigar-shaped wedge with a tall airbox. Less downforce, more slide, all heart.',
    top: 78, accel: 22, grip: 2.2, traction: 9, slideTraction: 2.4, hp: 10, offroad: 0.1, wheelie: false,
    engine: { type: 'v8', cyl: 8, idle: 3000, redline: 11000, gears: 5, crackle: 0.8, lope: 0.1 },
    f1: { mass: 650, power: 370, ers: 0, cda: 1.1, cla: 1.6, mu: 1.45, muLong: 0.85, muBrake: 1.5, aero: 'none' },
    spec: { power: '~480 hp (3.0 V8)', weight: '575 kg', layout: 'MR · 3.0 V8' } },
  // Real electric cars (Tesla). No badges are drawn on the models. Figures are Tesla's claims, see desc.
  { id: 'tesla_roadster', name: 'Tesla Roadster (2nd gen)', kind: 'car', cls: 'Hypercar', era: '2020s',
    desc: 'Revealed Oct 2026 (production planned 2028; untested claims). Thrust config: claimed 0-60 mph under 0.9 s with cold-gas thrusters (0.81 s shown, not independently timed), under 1.6 s without; 1,000+ kW, 230+ mph, 300+ mi range, >2 g cornering, 2,825 mm wheelbase, removable roof. Boost = SpaceX thrusters: extra push, brake and grip; C = hover hop.',
    top: 48, accel: 27, grip: 2.3, traction: 12, slideTraction: 2.6, hp: 35, offroad: 0, wheelie: false,
    engine: { type: 'electric', cyl: 2, idle: 600, redline: 17000, gears: 1, crackle: 0 },
    ev: { launch: 1.9, taper: 0.7, regen: 3, regenCharge: 9, thrusters: true },
    spec: { power: '1,000+ kW (1,341+ hp)', weight: '<1,700 kg (target)', layout: 'RWD · twin rear motors + cold-gas thrusters' } },
  { id: 'tesla_model3', name: 'Tesla Model 3 Performance', kind: 'car', cls: 'Race', era: '2020s',
    desc: 'Electric sports sedan. 0-60 mph 2.9 s (Tesla, 1-ft rollout), 163 mph top speed, 510 hp, ~1,850 kg. Dual-motor AWD with Track Mode: instant torque, rear-biased balance, lift-off regen refills your boost.',
    top: 38, accel: 20, grip: 2.0, traction: 9, slideTraction: 1.9, hp: 55, offroad: 0.15, wheelie: false,
    engine: { type: 'electric', cyl: 2, idle: 600, redline: 15000, gears: 1, crackle: 0, pitch: 0.9 },
    ev: { launch: 1.7, taper: 0.6, regen: 2.6, regenCharge: 7, rearBias: 0.14 },
    spec: { power: '510 hp · 741 Nm', weight: '1,851 kg', layout: 'AWD · dual motor' } },
];

/**
 * Career garage: level needed + credit price. Starters (Street 600, Dust Devil 450, Kitsune S-Spec,
 * Panda 86, Formula 2026) have no rule, so every mode stays playable on a fresh save.
 */
export const VEHICLE_UNLOCKS: Partial<Record<VehicleModelId, VehicleUnlock>> = {
  cafe: { level: 2, price: 300 },
  rally: { level: 2, price: 400 },
  cruiser: { level: 3, price: 500 },
  roadster: { level: 3, price: 450 },
  touring: { level: 4, price: 700 },
  muscle: { level: 4, price: 800 },
  f1_classic: { level: 4, price: 900 },
  rotary: { level: 5, price: 1000 },
  superbike: { level: 6, price: 1500 },
  trophy: { level: 6, price: 1200 },
  f1_v10: { level: 7, price: 1800 },
  gt: { level: 8, price: 2000 },
  hyper: { level: 12, price: 4000 },
  tesla_model3: { level: 6, price: 1600 },
  tesla_roadster: { level: 14, price: 6000 },
};
for (const v of VEHICLES) v.unlock ??= VEHICLE_UNLOCKS[v.id];

export const vehicleById =(id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
