// Avvio dell'app: router a "hash" (#/...), service worker, gestione aggiornamenti.

import { session } from './session.js';
import { h, toast } from './ui.js';
import { renderHome } from './screens/home.js';
import { renderSetup } from './screens/setup.js';
import { renderRecord } from './screens/record.js';
import { renderEdit } from './screens/edit.js';
import { renderExport } from './screens/export.js';
import { renderDiag } from './screens/diag.js';

const root = document.getElementById('app');

const ROUTES = [
  [/^#\/?$/, renderHome],
  [/^#\/nuova$/, renderSetup],
  [/^#\/rec\/([\w-]+)$/, renderRecord],
  [/^#\/timeline\/([\w-]+)$/, renderEdit],
  [/^#\/export\/([\w-]+)$/, renderExport],
  [/^#\/diagnostica$/, renderDiag],
];

let cleanup = null;
let routing = 0;

async function route() {
  const hash = location.hash || '#/';
  // Durante la registrazione si resta sulla schermata di registrazione
  // (evita di uscirne per sbaglio, per esempio con lo swipe "indietro")
  if (session.active && hash !== `#/rec/${session.meeting.id}`) {
    location.replace(`#/rec/${session.meeting.id}`);
    return;
  }
  const match = ROUTES.map(([re, fn]) => [hash.match(re), fn]).find(([m]) => m);
  if (!match) { location.replace('#/'); return; }
  const [m, render] = match;
  const my = ++routing;
  try { cleanup?.(); } catch { /* ignora */ }
  cleanup = null;
  window.scrollTo(0, 0);
  try {
    const c = await render(root, ...m.slice(1));
    if (my === routing) cleanup = typeof c === 'function' ? c : null;
    else if (typeof c === 'function') c(); // nel frattempo si è cambiata schermata
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('div', { class: 'screen' },
      h('h1', {}, 'Qualcosa è andato storto'),
      h('p', {}, err?.message || String(err)),
      h('a', { class: 'btn primary', href: '#/' }, 'Torna alla Home')));
  }
}

window.addEventListener('hashchange', route);

// Avviso (dove il browser lo consente) se si chiude la pagina durante una registrazione
window.addEventListener('beforeunload', (e) => {
  if (session.active) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`Errore: ${e.reason?.message || e.reason}`);
});

// ---------- service worker e aggiornamenti ----------

let updateRequested = false;

function showUpdateBanner(worker) {
  if (session.active) {
    // mai ricaricare durante una registrazione: si propone dopo lo Stop
    const later = () => { if (!session.active) { session.removeEventListener('change', later); showUpdateBanner(worker); } };
    session.addEventListener('change', later);
    return;
  }
  if (document.querySelector('.update-banner')) return;
  document.body.append(h('div', { class: 'update-banner', role: 'status' },
    h('span', {}, 'Nuova versione disponibile'),
    h('button', {
      type: 'button',
      class: 'btn small primary',
      onclick: () => {
        updateRequested = true;
        worker.postMessage('SKIP_WAITING');
      },
    }, 'Aggiorna')));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const check = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting); };
    check();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !session.active) reg.update().catch(() => {});
    });
  } catch (e) {
    console.warn('Service worker non registrato', e);
  }
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (updateRequested) location.reload();
});

route();
registerServiceWorker();
