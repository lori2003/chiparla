// Impostazioni semplici e nomi recenti: localStorage (piccoli dati, non critici).

const KEY = 'chiparla.settings.v1';
const RECENT_KEY = 'chiparla.recentNames.v1';

export const DEFAULTS = Object.freeze({
  bitrate: 64000,     // 64 kbps AAC mono: ~29 MB/ora, ottimo per il parlato
  processing: false,  // false = audio naturale (meglio per registrare una stanza)
  timesliceMs: 5000,  // ogni 5 s un pezzo di audio viene salvato su IndexedDB
  rotateMin: 0,       // 0 = un solo file; altrimenti nuovo file ogni N minuti
  haptics: true,      // vibrazione al tocco, dove il browser lo consente
  meter: true,        // indicatore livello microfono
  externalAudio: false, // true = l'audio lo registra un'altra app (es. Memo Vocali): solo timeline
  transcribe: true,   // trascrizione in diretta con il riconoscimento vocale del browser
  lang: 'it-IT',      // lingua della trascrizione
});

export const LANGUAGES = [
  ['it-IT', 'Italiano'],
  ['en-GB', 'English (UK)'],
  ['en-US', 'English (US)'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['es-ES', 'Español'],
];

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* spazio pieno o modalità privata */ }
  return next;
}

export function getRecentNames() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// I nomi appena usati vanno in testa, senza doppioni (maiuscole ignorate), massimo 30
export function rememberNames(names) {
  const seen = new Set();
  const merged = [...names, ...getRecentNames()].filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(merged)); } catch { /* ignora */ }
  return merged;
}
