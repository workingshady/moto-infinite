// Small stacked toasts (achievement unlocked, career level) in the corner of one player's HUD viewport.
import '../styles/career.css';
import { CAREER } from '../config';
import { escapeHtml } from '../utils/math';

const MAX = 3;

export function showToast(hudRoot: HTMLElement, icon: string, title: string, sub: string, label = 'ACHIEVEMENT') {
  let box = hudRoot.querySelector<HTMLDivElement>('.ach-toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'ach-toasts';
    hudRoot.appendChild(box);
  }
  while (box.children.length >= MAX) box.firstElementChild!.remove();
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.innerHTML = `<span class="ach-ic">${escapeHtml(icon)}</span><span class="ach-tx"><small>${escapeHtml(label)}</small><b>${escapeHtml(title)}</b><em>${escapeHtml(sub)}</em></span>`;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, CAREER.toastTime * 1000);
}
