// On-screen buttons for phones/tablets, feeding player 1's controller.
import type { Action, Input } from '../core/Input';

const BUTTONS: [string, Action[]][] = [
  ['◀', ['left']], ['▶', ['right']],
  ['E', ['ride']], ['GUN', ['weapon']], ['JUMP', ['jump']], ['NOS', ['nitro']], ['FIRE', ['fire']], ['▼', ['down']], ['▲', ['up']],
];

export function createTouch(input: Input): HTMLDivElement | null {
  if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return null;
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `<div class="grp">${BUTTONS.slice(0, 2).map(([l], i) => `<button data-i="${i}">${l}</button>`).join('')}</div>
    <div class="grp">${BUTTONS.slice(2).map(([l], i) => `<button data-i="${i + 2}">${l}</button>`).join('')}</div>`;
  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const acts = BUTTONS[+b.dataset.i!][1];
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      acts.forEach((a) => input.touch.add(a));
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => acts.forEach((a) => input.touch.delete(a)));
  });
  document.body.appendChild(root);
  return root;
}
