import './styles/main.css';
import './styles/hud-layout.css';
import './styles/mobile.css';
import { App } from './App';
import { installErrorReporting, sendReport } from './core/errorReport';
import { installPwa } from './core/pwa';
import { installMenuExtras } from './ui/menuExtras';

installErrorReporting();
installPwa();

function showFatal(err: unknown) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  void sendReport({ kind: 'error', msg: 'Start-up: ' + msg, stack: err instanceof Error ? err.stack : undefined });
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = '<div><h2>Moto Infinite could not start</h2><p></p><button class="btn primary">Reload</button> <button class="btn">Reset saved settings &amp; reload</button></div>';
  box.querySelector('p')!.textContent = msg + ' — try reloading. If it keeps happening, reset saved settings or update your browser / graphics driver.';
  const [reload, reset] = box.querySelectorAll('button');
  reload.onclick = () => location.reload();
  reset.onclick = () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith('moto:')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    location.reload();
  };
  document.body.appendChild(box);
}

try {
  new App();
  installMenuExtras();
} catch (err) {
  showFatal(err);
}
