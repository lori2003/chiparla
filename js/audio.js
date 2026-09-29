// Ricostruzione e verifica dei file audio salvati a pezzi.

import * as db from './db.js';
import { getMemoryChunks } from './session.js';
import { analyzeMp4Blob } from './mp4.js';
import { baseMime, extForMime } from './util.js';

// Unisce i pezzi di una parte in un unico file (i Blob letti da IndexedDB restano su disco)
export async function getPartBlob(meeting, part) {
  const stored = await db.getChunks(meeting.id, part.n);
  const seen = new Set(stored.map((c) => c.seq));
  const all = [...stored, ...getMemoryChunks(meeting.id, part.n).filter((c) => !seen.has(c.seq))]
    .sort((a, b) => a.seq - b.seq);
  if (!all.length) return null;
  return new Blob(all.map((c) => c.data), { type: baseMime(part.mimeType) });
}

// Durata letta dal lettore del browser (ripiego per formati diversi da MP4)
export function mediaDuration(blob, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.muted = true;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      a.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const ok = () => Number.isFinite(a.duration) && a.duration > 0;
    const timer = setTimeout(() => finish(null), timeoutMs);
    a.addEventListener('loadedmetadata', () => {
      if (ok()) { finish(a.duration); return; }
      // file senza durata nell'intestazione: si chiede di andare "alla fine"
      a.addEventListener('durationchange', () => { if (ok()) finish(a.duration); });
      try { a.currentTime = 1e7; } catch { finish(null); }
    });
    a.addEventListener('error', () => finish(null));
    a.src = url;
  });
}

export async function analyzeAudio(blob, mimeType, opts = {}) {
  if (extForMime(mimeType) === 'm4a') {
    const r = await analyzeMp4Blob(blob, opts);
    if (r.durationSec != null) return r;
    return { ...r, durationSec: await mediaDuration(blob) };
  }
  return { kind: extForMime(mimeType), durationSec: await mediaDuration(blob), spanSec: null, gaps: [], recoverable: null };
}

// Misura le parti non ancora verificate. Modifica l'oggetto riunione ricevuto (quello
// usato dalla schermata) e lo salva, così non si sovrascrivono modifiche fatte nel frattempo.
export async function verifyMeetingAudio(meeting, { force = false, onProgress } = {}) {
  let changed = false;
  for (const p of meeting.parts ?? []) {
    if (p.deleted || (!force && p.audioCheckedAt)) continue;
    const blob = await getPartBlob(meeting, p);
    p.audioCheckedAt = Date.now();
    changed = true;
    if (!blob) { p.audioDurSec = null; continue; }
    try {
      const r = await analyzeAudio(blob, p.mimeType, { onProgress: (f) => onProgress?.(p, f) });
      Object.assign(p, {
        audioDurSec: r.durationSec, audioSpanSec: r.spanSec ?? null, audioGaps: r.gaps ?? [], container: r.kind, bytes: blob.size,
      });
    } catch (e) {
      p.audioError = String(e?.message || e);
    }
  }
  if (changed) await db.putMeeting(meeting);
  return meeting;
}
