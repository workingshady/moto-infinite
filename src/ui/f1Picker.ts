// Formula 1 circuit picker: difficulty filter, sort chips and a scrollable row of circuit cards (flag, mini map,
// difficulty, length, turns). Menu.ts renders f1PickerHtml() and forwards data-f1f / data-f1s clicks here; the cards
// are ordinary data-opt="trackId" buttons.
import '../styles/f1picker.css';
import { F1_DIFFICULTY, F1_TRACKS, type F1Circuit, type F1Difficulty } from '../world/f1Circuits';
import { drawF1Map } from '../world/F1Track';
import { escapeHtml } from '../utils/math';

export type F1Filter = 'all' | F1Difficulty;
export type F1Sort = 'calendar' | 'difficulty' | 'length' | 'turns' | 'name';
const FILTERS: F1Filter[] = ['all', 'easy', 'medium', 'hard'];
const SORTS: [F1Sort, string][] = [['calendar', 'Default'], ['difficulty', 'Difficulty'], ['length', 'Length'], ['turns', 'Turns'], ['name', 'A-Z']];
export const isF1Filter = (v: unknown): v is F1Filter => FILTERS.includes(v as F1Filter);
export const isF1Sort = (v: unknown): v is F1Sort => SORTS.some(([k]) => k === v);

function list(filter: F1Filter, sort: F1Sort): F1Circuit[] {
  const l = F1_TRACKS.filter((t) => filter === 'all' || t.difficulty === filter);
  switch (sort) {
    case 'difficulty': return [...l].sort((a, b) => F1_DIFFICULTY[a.difficulty].rank - F1_DIFFICULTY[b.difficulty].rank || a.lengthKm - b.lengthKm);
    case 'length': return [...l].sort((a, b) => a.lengthKm - b.lengthKm);
    case 'turns': return [...l].sort((a, b) => a.turns - b.turns);
    case 'name': return [...l].sort((a, b) => a.name.localeCompare(b.name));
    default: return l;
  }
}

const card = (t: F1Circuit, on: boolean) => {
  const d = F1_DIFFICULTY[t.difficulty];
  return `<button class="f1c ${on ? 'on' : ''} d-${t.difficulty}" data-opt="trackId" data-val="${t.id}" aria-pressed="${on}" title="${escapeHtml(t.name)} (${escapeHtml(t.country)})">
    <canvas data-f1map="${t.id}" width="132" height="76" aria-hidden="true"></canvas>
    <b>${t.flag} ${escapeHtml(t.name)}</b>
    <span class="f1c-meta"><i class="f1c-diff">${d.icon} ${d.label}</i>${t.fictional ? '<i class="f1c-fic">Fictional</i>' : ''}</span>
    <span class="f1c-meta">${t.lengthKm.toFixed(3)} km · ${t.turns} turns</span>
  </button>`;
};

/** Filter + sort chips and the card row. The selected circuit is always shown, even if filtered out. */
export function f1PickerHtml(selected: string, filter: F1Filter, sort: F1Sort) {
  const shown = list(filter, sort), sel = F1_TRACKS.find((t) => t.id === selected);
  if (sel && !shown.includes(sel)) shown.unshift(sel);
  const count = (f: F1Filter) => (f === 'all' ? F1_TRACKS.length : F1_TRACKS.filter((t) => t.difficulty === f).length);
  return `<div class="f1pick">
    <div class="f1p-bar"><span>Show</span>${FILTERS.map((f) => `<button class="chip ${f === filter ? 'on' : ''}" data-f1f="${f}">${f === 'all' ? 'All' : `${F1_DIFFICULTY[f].icon} ${F1_DIFFICULTY[f].label}`} <small>${count(f)}</small></button>`).join('')}</div>
    <div class="f1p-bar"><span>Sort</span>${SORTS.map(([k, l]) => `<button class="chip ${k === sort ? 'on' : ''}" data-f1s="${k}">${l}</button>`).join('')}</div>
    <div class="f1p-row">${shown.map((t) => card(t, t.id === selected)).join('')}</div>
  </div>`;
}

/** One-line description of a circuit under the picker. */
export function f1InfoHtml(id: string) {
  const t = F1_TRACKS.find((x) => x.id === id);
  if (!t) return '';
  const d = F1_DIFFICULTY[t.difficulty];
  return `<b>${t.flag} ${escapeHtml(t.name)}</b> · ${escapeHtml(t.country)} · ${d.icon} ${d.label} · ${t.lengthKm.toFixed(3)} km · ${t.turns} turns · ${t.fictional ? 'fictional training layout' : 'real layout'}<br>${escapeHtml(t.blurb)}`;
}

/** Draw the mini maps and keep the selected card in view (call after each render). */
export function paintF1Picker(root: HTMLElement, scrollLeft?: number) {
  const row = root.querySelector<HTMLElement>('.f1p-row');
  if (!row) return;
  for (const c of row.querySelectorAll<HTMLCanvasElement>('canvas[data-f1map]')) {
    const ctx = c.getContext('2d');
    const id = F1_TRACKS.find((t) => t.id === c.dataset.f1map)?.id;
    if (!ctx || !id) continue;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 5;
    drawF1Map(ctx, id, c.width, c.height, 7);
    ctx.strokeStyle = '#f2f4f7';
    ctx.lineWidth = 2.2;
    drawF1Map(ctx, id, c.width, c.height, 7);
  }
  if (scrollLeft !== undefined) row.scrollLeft = scrollLeft;
  const on = row.querySelector<HTMLElement>('.f1c.on');
  if (on && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth))
    row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
}
