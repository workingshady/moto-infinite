// Garage vehicle picker: class tabs (bikes + every car class), sort chips and the card grid.
// Menu.ts renders garagePicker() and forwards data-gtab / data-gsort clicks here.
import '../styles/garage.css';
import { VEHICLES, type VehicleDef } from '../data/vehicles';
import { clamp, escapeHtml } from '../utils/math';
import { isUnlocked } from '../core/career';
import { vehicleLockHtml } from './CareerPanel';

export type GarageSort = 'default' | 'speed' | 'accel' | 'handling' | 'drift' | 'era' | 'name';
const SORTS: [GarageSort, string][] = [['default', 'Class'], ['speed', 'Speed'], ['accel', 'Accel'], ['handling', 'Handling'], ['drift', 'Drift'], ['era', 'Era'], ['name', 'A-Z']];
const ICON: Record<string, string> = { Drift: '🌀', Race: '🏁', Muscle: '💪', Rally: '🌲', Hypercar: '⚡', 'Off-road': '⛰', Classic: '🎩', 'Formula 1': '🏎' };

/** Tab ids: 'bike', 'car' (all cars) or a car class name. Counts only owned vehicles when `ownedOnly` (Player 2). */
export function garageTabs(ownedOnly = false) {
  const classes: string[] = [];
  for (const v of VEHICLES) if (v.kind === 'car' && !classes.includes(v.cls)) classes.push(v.cls);
  const n = (f: (v: VehicleDef) => boolean) => VEHICLES.filter((v) => f(v) && (!ownedOnly || isUnlocked(v.id))).length;
  return [
    { id: 'bike', label: `🏍 Bikes`, count: n((v) => v.kind === 'bike') },
    { id: 'car', label: '🚗 All cars', count: n((v) => v.kind === 'car') },
    ...classes.map((c) => ({ id: c, label: `${ICON[c] ?? '🚗'} ${c}`, count: n((v) => v.kind === 'car' && v.cls === c) })),
  ];
}
/** The tab a vehicle lives in (its car class, or bikes). */
export const tabFor = (v: VehicleDef) => (v.kind === 'bike' ? 'bike' : v.cls);
const inTab = (v: VehicleDef, tab: string) => (tab === 'bike' || tab === 'car' ? v.kind === tab : v.kind === 'car' && v.cls === tab);
const year = (era: string) => parseInt(era, 10) || 0;

function sorted(list: VehicleDef[], sort: GarageSort) {
  const by = (f: (v: VehicleDef) => number) => [...list].sort((a, b) => f(b) - f(a));
  switch (sort) {
    case 'speed': return by((v) => v.top);
    case 'accel': return by((v) => v.accel);
    case 'handling': return by((v) => v.grip);
    case 'drift': return by((v) => -v.traction);
    case 'era': return by((v) => -year(v.era));
    case 'name': return [...list].sort((a, b) => a.name.localeCompare(b.name));
    default: return list;
  }
}

const bar = (v: number) => `<i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i>`;
function card(v: VehicleDef, sel: string, tab: string, topMax: number) {
  return `
    <button class="veh ${v.id === sel ? 'on' : ''} ${isUnlocked(v.id) ? '' : 'locked'}" data-veh="${v.id}">
      <div class="veh-head"><b>${escapeHtml(v.name)}</b><span>${tab === 'bike' || tab === 'car' ? `${escapeHtml(v.cls)} · ` : ''}${v.era}</span></div>${vehicleLockHtml(v.id)}
      <div class="stat"><span>Speed</span><div class="sbar">${bar(v.top / topMax)}</div></div>
      <div class="stat"><span>Accel</span><div class="sbar">${bar(v.accel / (v.f1 ? 32 : 27))}</div></div>
      <div class="stat"><span>Handling</span><div class="sbar">${bar(v.grip / (v.f1 ? 2.8 : 2.45))}</div></div>
      <div class="stat"><span>Drift</span><div class="sbar drift">${bar(1 - v.traction / (v.f1 ? 18 : 14))}</div></div>
      <div class="veh-spec">${v.spec.power} · ${v.spec.weight} · ${v.spec.layout}</div>
    </button>`;
}

/** Tabs + sort chips + cards for the selected tab. */
export function garagePicker(sel: string, tab: string, sort: GarageSort, ownedOnly = false) {
  const list = sorted(VEHICLES.filter((v) => inTab(v, tab) && (!ownedOnly || isUnlocked(v.id))), sort);
  const topMax = list.some((v) => v.f1) && list.every((v) => v.f1) ? 95 : 48;
  return `
    <div class="gp-tabs" role="tablist">${garageTabs(ownedOnly).map((t) => `<button class="chip ${t.id === tab ? 'on' : ''}" data-gtab="${escapeHtml(t.id)}" role="tab">${t.label} <small>${t.count}</small></button>`).join('')}</div>
    <div class="gp-sort"><span>Sort</span>${SORTS.map(([id, l]) => `<button class="chip ${id === sort ? 'on' : ''}" data-gsort="${id}">${l}</button>`).join('')}</div>
    <div class="veh-grid">${list.map((v) => card(v, sel, tab, topMax)).join('') || '<p class="dim">Nothing here yet: unlock vehicles of this class in the Player 1 garage.</p>'}</div>`;
}

export const isGarageSort = (s: string): s is GarageSort => SORTS.some(([id]) => id === s);

/** Re-render without losing the scroll position of the tab strip and card list. */
export function keepGarageScroll(root: HTMLElement, rerender: () => void) {
  const grid = root.querySelector('.veh-grid')?.scrollTop ?? 0, tabs = root.querySelector('.gp-tabs')?.scrollLeft ?? 0;
  rerender();
  const g = root.querySelector('.veh-grid'), t = root.querySelector('.gp-tabs');
  if (g) g.scrollTop = grid;
  if (t) t.scrollLeft = tabs;
}
