// Small stacked notifications in the top-centre (controller hot-plug, binding swaps).
let host: HTMLDivElement | null = null;

export function toast(text: string, warn = false) {
  if (!document.body) return;
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (warn ? ' warn' : '');
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}
