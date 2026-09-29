// Funzioni di utilità pure (nessun accesso al DOM): usate dall'app e dai test Node.

export const APP_NAME = 'ChiParla';

// 12 colori ben distinguibili per i partecipanti
export const PALETTE = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1',
  '#D81B60', '#FDD835', '#6D4C41', '#3949AB', '#7CB342', '#546E7A',
];

export function uid(prefix = '') {
  const rnd = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}-${rnd}`;
}

export const pad2 = (n) => String(n).padStart(2, '0');

export const round1 = (x) => Math.round(x * 10) / 10;

// 102.4 → "00:01:42" (i secondi vengono troncati, come un cronometro)
export function fmtTime(sec) {
  const s = Math.floor((Number.isFinite(sec) && sec > 0 ? sec : 0) + 1e-6);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

// 102.46 → "00:01:42.4"
export function fmtTimePrecise(sec) {
  const t = Math.floor((Number.isFinite(sec) && sec > 0 ? sec : 0) * 10 + 1e-6) / 10;
  const whole = Math.floor(t);
  return `${fmtTime(whole)}.${Math.round((t - whole) * 10)}`;
}

// Durata compatta per l'interfaccia: 83 → "1:23", 3723 → "1:02:03"
export function fmtClock(sec) {
  const s = Math.floor(Math.max(0, sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

// Durata leggibile: 12 → "12 s", 125 → "2 min 05 s", 3725 → "1 h 02 min"
export function fmtDuration(sec) {
  const s = Math.round(Math.max(0, sec || 0));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${pad2(m)} min`;
  return `${m} min ${pad2(s % 60)} s`;
}

// Accetta "102", "102.5", "1:42", "01:42.5", "1:01:42", "01:01:42,5"
export function parseTime(str) {
  const s = String(str ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mi = parseInt(m[2], 10);
  const se = parseFloat(m[3]);
  if (mi >= 60 || se >= 60) return NaN;
  return h * 3600 + mi * 60 + se;
}

export function slugify(str, max = 40) {
  return String(str ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Colore del testo (nero/bianco) leggibile sopra un colore di sfondo esadecimale
export function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const v = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return L > 0.4 ? '#111' : '#fff';
}

// Primo colore della tavolozza non ancora usato (poi ricomincia)
export function nextColor(used = []) {
  return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
}

// "audio/mp4;codecs=mp4a.40.2" → "audio/mp4"
export function baseMime(mime) {
  return String(mime || '').split(';')[0].trim() || 'application/octet-stream';
}

// Estensione del file audio in base al formato prodotto dal registratore
export function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg')) return 'mp3';
  return 'm4a';
}

// Divide "Marco, Giulia; Luca\nAnna" in nomi puliti
export function splitNames(text) {
  return String(text ?? '')
    .split(/[,;\n]+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}
