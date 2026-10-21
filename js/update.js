// Aggiornamento forzato all'ultima versione pubblicata.
// Tocca solo i file dell'app (cache del service worker e cache del browser):
// riunioni, audio e impostazioni stanno in IndexedDB/localStorage e non vengono toccati.
// Prima scarica tutto di nuovo e solo se ci riesce sostituisce la versione installata,
// così senza internet l'app resta quella di prima e continua a funzionare offline.

const FLAG = 'chiparla.forcedUpdate';

export async function forceUpdate({ onStep } = {}) {
  onStep?.('Controllo la versione online…');
  // elenco dei file dell'app, preso dal service worker appena pubblicato
  let swText;
  try {
    const r = await fetch('sw.js', { cache: 'reload' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    swText = await r.text();
  } catch {
    throw new Error('Serve internet per scaricare l\'ultima versione. Nulla è stato cambiato.');
  }
  const block = swText.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] ?? '';
  const assets = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const version = swText.match(/const VERSION = '([^']+)'/)?.[1] ?? '';

  // aggiorna anche la cache del browser, altrimenti al riavvio potrebbe usare copie vecchie
  let done = 0;
  for (const a of assets) {
    const r = await fetch(a, { cache: 'reload' }).catch(() => null);
    if (!r?.ok) throw new Error(`Download non riuscito (${a}). Nulla è stato cambiato: riprova con una connessione migliore.`);
    done += 1;
    onStep?.(`Scarico l'ultima versione… ${Math.round((done / assets.length) * 100)}%`);
  }

  onStep?.('Installo…');
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chiparla-')).map((k) => caches.delete(k)));
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* al riavvio il service worker si reinstalla comunque */ }
  try { sessionStorage.setItem(FLAG, version || '?'); } catch { /* ignora */ }
  location.reload();
}

// Dopo il riavvio: versione appena installata (una volta sola), altrimenti null
export function takeForcedUpdateResult() {
  try {
    const v = sessionStorage.getItem(FLAG);
    if (v) sessionStorage.removeItem(FLAG);
    return v;
  } catch {
    return null;
  }
}
