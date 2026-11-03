// Tesla models (no logos or badges): next-generation Roadster and Model 3 Performance.
// Same conventions as vehicleModels.ts: forward = +z, ground at y = 0, flat-shaded low-poly, shared geometry.
// NOTE: vehicleModels.ts imports this file and we import its builder kit back (a cycle), so the kit is only
// touched inside the builder functions, never at module top level.
import * as THREE from 'three';
import { M } from './assets';
import { PI } from '../utils/math';
import { EV } from '../config';
import { type VehicleModel, box, carDone, carWheel, carbon, cyl, dark, kit, lampMat, mirrors, prism, rigWith, sym, winMat } from './vehicleModels';

// gold-tinted glass: Tesla says the new Roadster's windows mimic a spacesuit's gold visor
const visorGlass = new THREE.MeshStandardMaterial({ color: 0x4a3a14, transparent: true, opacity: 0.88, roughness: 0.08, metalness: 0.85 });
const roofGlass = new THREE.MeshStandardMaterial({ color: 0x0d1117, transparent: true, opacity: 0.85, roughness: 0.05, metalness: 0.7 });
const nozzleMat = M(0x8c929a, { roughness: 0.25, metalness: 0.85 });
const caliper = M(0xd8262c, { roughness: 0.45 });
/** EVs have no exhaust: hide the generic nitro flame cone. */
const noExhaust = (m: VehicleModel) => {
  m.flame.visible = false;
  return m;
};

/**
 * 2nd-gen Roadster (Oct 2026 reveal): very low and wide 2+2-style coupe, long grille-less sloping nose with hidden
 * headlights (thin light bar), fastback glass with removable T-top panels, full-width tail light, ducktail wing,
 * 2,825 mm wheelbase, staggered wheels, four rear cold-gas thruster nozzles (Thrust configuration).
 */
export function teslaRoadster(color: number) {
  const k = kit(color), { add, body, beam } = k;
  const rig = rigWith(k, (r, w, s) => carWheel(r, w, 'spoke', s), 0.34, 0.36, 0.28, 0.34, 0.82, 0.84, 1.42, -1.4);
  add(prism('tRoad', [[2.34, 0.2], [2.4, 0.3], [2.33, 0.41], [2.0, 0.51], [1.5, 0.59], [0.95, 0.67], [0.7, 0.7],
    [-0.6, 0.8], [-1.7, 0.82], [-2.2, 0.78], [-2.36, 0.66], [-2.39, 0.42], [-2.27, 0.2]], 1.92), body, 0, 0, 0);
  add(prism('tRoadG', [[0.8, 0.69], [0.1, 1.05], [-0.45, 1.09], [-1.2, 0.97], [-1.95, 0.81]], 1.36), visorGlass, 0, 0, 0);
  // T-top: body-colour spine, two removable dark glass panels
  beam(0.16, 0.04, body, 0, 0.12, 1.06, -0.47, 1.1);
  sym((s) => beam(0.5, 0.025, roofGlass, s * 0.36, 0.08, 1.055, -0.43, 1.09));
  sym((s) => {
    beam(0.07, 0.05, body, s * 0.67, 0.8, 0.69, 0.1, 1.05); // A-pillar
    beam(0.11, 0.05, body, s * 0.64, -0.45, 1.09, -1.95, 0.81); // fastback edge
    add(box(0.1, 0.08, 1.2), body, s * 0.95, 0.77, -1.38); // wide rear haunch shoulder
    add(box(0.012, 0.36, 0.012), dark, s * 0.965, 0.5, -0.5); // butterfly door seam
    beam(0.012, 0.012, dark, s * 0.965, 0.75, 0.32, -0.5, 0.32);
    add(box(0.03, 0.18, 0.42), dark, s * 0.962, 0.5, -0.85); // side intake
    add(box(0.32, 0.07, 0.03), dark, s * 0.62, 0.27, 2.37); // lower intakes (front retro nozzles inside)
    add(box(0.18, 0.025, 0.05), lampMat, s * 0.8, 0.43, 2.24, 0, -s * 0.5); // light bar wraps the corners
    add(box(0.03, 0.06, 0.06), dark, s * 0.965, EV.thrust.side[1], EV.thrust.side[2]); // side thruster ports
    add(box(0.03, 0.06, 0.06), dark, s * 0.97, EV.thrust.side[1], -EV.thrust.side[2]);
  });
  add(box(1.5, 0.025, 0.04), lampMat, 0, 0.44, 2.34, -0.4); // hidden headlights: one thin full-width bar
  add(box(1.92, 0.03, 0.32), carbon, 0, 0.15, 2.28); // splitter
  mirrors(k, body, 0.86, 0.8, 0.55);
  // tail: full-width light, ducktail / active wing, diffuser, 4 thruster nozzles
  add(box(1.84, 0.035, 0.04), k.brakeMat, 0, 0.68, -2.37);
  add(box(1.7, 0.03, 0.28), body, 0, 0.84, -2.18, -0.12);
  add(box(1.8, 0.03, 0.4), carbon, 0, 0.15, -2.2);
  for (const x of [-0.8, -0.45, 0.45, 0.8]) add(box(0.03, 0.22, 0.4), carbon, x, 0.25, -2.22);
  for (const [x, y, z] of EV.thrust.nozzles) {
    add(cyl(0.095, 0.07, 0.14, 8), nozzleMat, x, y, z, -PI / 2);
    add(cyl(0.05, 0.05, 0.02, 8), dark, x, y, z - 0.07, PI / 2);
  }
  return noExhaust(carDone(k, rig, [0, 0.4, -2.5, 0.07], [0.44, 2.34], [-0.34, 0.16, -0.4]));
}

/**
 * Model 3 Performance ("Highland"): smooth 4-door fastback saloon, grille-less nose with slim swept headlights,
 * one-piece tinted glass roof, C-shaped tail lights, carbon lip spoiler, 20" turbine-style wheels, red calipers.
 */
export function teslaModel3(color: number) {
  const k = kit(color), { add, body, beam } = k;
  const rig = rigWith(k, (r, w, s) => carWheel(r, w, 'spoke', s), 0.35, 0.35, 0.26, 0.28, 0.8, 0.81, 1.45, -1.42);
  add(prism('tM3', [[2.3, 0.22], [2.38, 0.36], [2.34, 0.52], [2.12, 0.64], [1.6, 0.74], [1.0, 0.8], [-1.4, 0.86],
    [-2.05, 0.9], [-2.3, 0.86], [-2.34, 0.6], [-2.25, 0.22]], 1.84), body, 0, 0, 0);
  add(prism('tM3G', [[1.0, 0.79], [0.25, 1.28], [-0.55, 1.33], [-1.3, 1.2], [-2.0, 0.9]], 1.5), winMat, 0, 0, 0);
  beam(1.3, 0.03, roofGlass, 0, 0.25, 1.285, -0.55, 1.335); // glass roof
  beam(1.3, 0.03, roofGlass, 0, -0.55, 1.335, -1.3, 1.205);
  sym((s) => {
    beam(0.07, 0.06, body, s * 0.74, 1.0, 0.79, 0.25, 1.28); // A-pillar
    add(box(0.06, 0.44, 0.1), dark, s * 0.75, 1.07, -0.3); // B-pillar
    beam(0.1, 0.06, body, s * 0.72, -1.3, 1.2, -2.0, 0.9); // C-pillar
    for (const z of [0.95, -0.3, -1.3]) add(box(0.012, 0.42, 0.012), dark, s * 0.925, 0.6, z); // door seams
    for (const z of [0.35, -0.7]) add(box(0.012, 0.03, 0.18), dark, s * 0.925, 0.76, z); // flush handles
    add(box(0.44, 0.06, 0.14), lampMat, s * 0.62, 0.62, 2.2, 0.35, s * 0.25); // slim headlights
    add(box(0.42, 0.08, 0.04), k.brakeMat, s * 0.6, 0.8, -2.315); // C-shaped tail lights
    add(box(0.06, 0.18, 0.04), k.brakeMat, s * 0.83, 0.73, -2.3);
    add(box(0.05, 0.16, 0.2), caliper, s * 0.72, 0.42, 1.55); // red Performance calipers
    add(box(0.05, 0.14, 0.18), caliper, s * 0.73, 0.42, -1.3);
  });
  mirrors(k, body, 0.96, 0.96, 0.75);
  add(box(0.9, 0.08, 0.04), dark, 0, 0.3, 2.37); // small lower intake, no grille
  add(box(1.6, 0.025, 0.2), carbon, 0, 0.16, 2.28);
  add(box(1.25, 0.03, 0.12), carbon, 0, 0.92, -2.22, -0.15); // carbon lip spoiler
  add(box(1.4, 0.06, 0.22), carbon, 0, 0.24, -2.26);
  return noExhaust(carDone(k, rig, [0, 0.3, -2.5, 0.07], [0.62, 2.3], [-0.38, 0.3, -0.25]));
}
