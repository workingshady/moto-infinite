// "Report a bug" dialog (pause menu): optional description + the last console errors + device info,
// sent to /api/log. The player sees exactly what is included before sending.
import { deviceInfo, recentErrors, sendReport } from '../core/errorReport';
import { toast } from '../core/pwa';
import { LOG_LIMITS } from '../../shared/logReport';

export function openBugReport() {
  if (document.querySelector('.bug-dialog')) return;
  const errors = recentErrors().slice(-LOG_LIMITS.errors);
  const dev = deviceInfo(true);
  const el = document.createElement('div');
  el.className = 'bug-dialog';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="bug-card">
      <h2>🐞 Report a bug</h2>
      <label class="hint" for="bugNote">What happened? (optional, please no personal details)</label>
      <textarea id="bugNote" maxlength="${LOG_LIMITS.note}" rows="4" placeholder="e.g. I fell through the road after the big jump near the windmill"></textarea>
      <details class="hint"><summary>Included: ${errors.length} recent error${errors.length === 1 ? '' : 's'} + device info</summary><pre></pre></details>
      <p class="err" aria-live="polite"></p>
      <div class="row-buttons"><button class="btn ghost" data-bug="cancel">Cancel</button><button class="btn primary" data-bug="send">Send report</button></div>
    </div>`;
  el.querySelector('pre')!.textContent = [
    `${dev.ua}`, `${dev.vw}x${dev.vh} @${dev.dpr}x · ${dev.touch ? 'touch' : 'mouse'} · ${dev.lang}${dev.gpu ? ' · ' + dev.gpu : ''}`,
    ...(errors.length ? ['', ...errors] : []),
  ].join('\n');
  const note = el.querySelector('textarea')!, err = el.querySelector<HTMLElement>('.err')!, send = el.querySelector<HTMLButtonElement>('[data-bug="send"]')!;
  const close = () => el.remove();
  // keep clicks/keys away from the menu and the game underneath
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-bug]')?.dataset.bug;
    if (k === 'cancel' || e.target === el) close();
    if (k !== 'send') return;
    send.disabled = true;
    err.textContent = '';
    void sendReport({ kind: 'bug', msg: note.value.trim().slice(0, 120) || 'Bug report', note: note.value.trim(), errors, device: dev }, true).then((ok) => {
      if (ok) { close(); toast('Thanks! Your report was sent.', undefined, 3500); return; }
      send.disabled = false;
      err.textContent = navigator.onLine ? 'Could not send the report, please try again.' : 'You are offline: connect to the internet to send the report.';
    });
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.appendChild(el);
  note.focus();
}
