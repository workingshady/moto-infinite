// Garage: every rideable vehicle with its handling. Names are fictional, classes/eras mirror real-world types.
// Speeds are game m/s (HUD shows them x3.6 as km/h, before nitro). `engine` drives the procedural engine sound.
import type { EngineProfile } from '../core/EngineSound';

export type VehicleKind = 'bike' | 'car';
export type VehicleModelId =
  | 'street' | 'superbike' | 'dirt' | 'cafe' | 'cruiser'
  | 'drift_coupe' | 'hatch' | 'gt' | 'muscle' | 'rally'
  | 'rotary' | 'hyper' | 'touring' | 'trophy' | 'roadster';

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
  /** Fluff for the garage card. */
  spec: { power: string; weight: string; layout: string };
}

export const VEHICLES: VehicleDef[] = [
  { id: 'street', name: 'Street 600', kind: 'bike', cls: 'Sport naked', era: '2020s', desc: 'Balanced all-rounder. Easy wheelies, forgiving grip.',
    top: 30, accel: 17, grip: 1.9, traction: 9, slideTraction: 2.2, hp: 0, offroad: 0.3, wheelie: true, engine: { type: 'i4', cyl: 4, idle: 1300, redline: 11500, gears: 6, crackle: 0.3 },
    spec: { power: '95 hp', weight: '185 kg', layout: 'Inline-4' } },
  { id: 'superbike', name: 'Vortex 1000RR', kind: 'bike', cls: 'Superbike', era: '2020s', desc: 'Brutal top speed, twitchy. Pros only.',
    top: 38, accel: 21, grip: 1.75, traction: 8, slideTraction: 2, hp: -10, offroad: 0.1, wheelie: true, engine: { type: 'i4', cyl: 4, idle: 1400, redline: 14500, gears: 6, crackle: 0.7 },
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
    top: 42, accel: 22, grip: 2.25, traction: 12, slideTraction: 2.5, hp: 40, offroad: 0, wheelie: false, engine: { type: 'v8', cyl: 8, idle: 1200, redline: 9000, gears: 6, crackle: 0.9, lope: 0.15 },
    spec: { power: '550 hp', weight: '1,250 kg', layout: 'MR · V8' } },
  { id: 'muscle', name: 'Brute V8', kind: 'car', cls: 'Muscle', era: '1970s', desc: 'Torque monster. Power oversteer everywhere.',
    top: 36, accel: 20, grip: 1.45, traction: 3.5, slideTraction: 0.7, hp: 60, offroad: 0.3, wheelie: false, engine: { type: 'v8', cyl: 8, idle: 750, redline: 6200, gears: 4, crackle: 0.5, lope: 0.6 },
    spec: { power: '425 hp', weight: '1,600 kg', layout: 'FR · V8' } },
  { id: 'rally', name: 'Gravel 4WD', kind: 'car', cls: 'Rally', era: '2000s', desc: 'All-wheel drive. King of dirt, snow and rain.',
    top: 33, accel: 19, grip: 2.05, traction: 6, slideTraction: 1.4, hp: 50, offroad: 1, wheelie: false, engine: { type: 'i4', cyl: 4, idle: 1000, redline: 7600, gears: 6, turbo: true, crackle: 1 },
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
];

export const vehicleById = (id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
