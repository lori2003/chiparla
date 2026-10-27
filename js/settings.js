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

// ---------- gruppi di partecipanti (es. «Presidenza») ----------

const GROUPS_KEY = 'chiparla.groups.v1';

// Gruppi già pronti nell'app. Se l'utente ne modifica uno, vale la sua versione (salvata sul telefono).
// Un gruppo senza nomi chiede di incollare l'elenco al primo uso.
export const DEFAULT_GROUPS = Object.freeze([
  {
    // dal verbale della Presidenza (presenti e collegati a distanza)
    name: 'Presidenza',
    names: [
      'Finocchiaro Antonino', 'Innocente Enzo', 'Marchetti Lorenzo', 'Sassi Laura',
      'Sperindio Giancarlo', 'Tripodi Giuseppina', 'Attiani Alvaro', 'Vincenzi Bruna',
      'Pagani Mario', 'Nigi Luigi',
    ],
  },
]);

function readGroups() {
  try {
    const list = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((g) => g && typeof g.name === 'string') : [];
  } catch {
    return [];
  }
}

function writeGroups(list) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(list)); } catch { /* spazio pieno o modalità privata */ }
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// [{ name, names[] }]: prima i predefiniti (o la loro versione modificata), poi quelli creati dall'utente
export function getGroups() {
  const saved = readGroups();
  const out = [];
  for (const d of DEFAULT_GROUPS) {
    const s = saved.find((g) => sameName(g.name, d.name));
    if (s?.deleted) continue;
    out.push({ name: d.name, names: [...(s?.names ?? d.names)], builtIn: true });
  }
  for (const s of saved) {
    if (s.deleted || DEFAULT_GROUPS.some((d) => sameName(d.name, s.name))) continue;
    out.push({ name: s.name, names: [...(s.names ?? [])] });
  }
  return out;
}

export function saveGroup(name, names) {
  const list = readGroups().filter((g) => !sameName(g.name, name));
  list.push({ name: name.trim(), names: names.filter((n) => typeof n === 'string' && n.trim()) });
  writeGroups(list);
}

// I predefiniti si nascondono (restano nel codice), gli altri si cancellano
export function deleteGroup(name) {
  const list = readGroups().filter((g) => !sameName(g.name, name));
  if (DEFAULT_GROUPS.some((d) => sameName(d.name, name))) list.push({ name, deleted: true });
  writeGroups(list);
}
