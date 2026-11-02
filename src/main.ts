import './styles/main.css';
import { App } from './App';

function showFatal(err: unknown) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
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
} catch (err) {
  showFatal(err);
}
