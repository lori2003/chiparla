// Logica pura della timeline: dagli eventi (tocchi) ai segmenti "chi parla da quando a quando".
// Nessun accesso al DOM: testata con `node --test`.
//
// Tempo di riferimento ("tempo riunione"): secondi dall'inizio della registrazione,
// misurati con l'orologio del telefono. Ogni file audio ("parte") copre un intervallo
// [startSec, endSec] di questo tempo; fra una parte e l'altra può esserci un buco
// (registrazione interrotta).

export function sortEvents(events) {
  return [...events].sort((a, b) => a.t - b.t || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export const userEvents = (events) => events.filter((e) => e.type !== 'sys');

// Lo speaker attivo è quello dell'ultimo evento "speaker" in ordine di tempo
export function currentSpeakerId(events) {
  const sp = sortEvents(events.filter((e) => e.type === 'speaker'));
  return sp.length ? sp[sp.length - 1].speakerId : null;
}

// Parti normalizzate: { n, start, end }. Senza parti si assume un unico file 0 → fine.
function normParts(parts, endSec) {
  if (!parts?.length) return [{ n: 1, start: 0, end: endSec }];
  return parts
    .filter((p) => p.startSec != null)
    .map((p) => ({ n: p.n, start: p.startSec, end: p.endSec ?? endSec }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Costruisce i segmenti contigui a partire dagli eventi speaker.
 * - tocchi consecutivi sullo stesso speaker vengono uniti;
 * - i segmenti vengono tagliati ai confini dei file audio (parti) e dei buchi;
 * - `part: null` indica un intervallo senza audio registrato;
 * - un eventuale tratto iniziale senza speaker più corto di `absorbLeadSec`
 *   (il tempo di reazione per il primo tocco) viene attribuito al primo speaker.
 * @returns {{speakerId: string|null, part: number|null, start: number, end: number}[]}
 */
export function buildSegments(events, { endSec, parts = [], absorbLeadSec = 3 } = {}) {
  if (!(endSec > 0)) return [];
  const sp = sortEvents(events.filter((e) => e.type === 'speaker' && e.t >= 0));
  const np = normParts(parts, endSec);

  const cutSet = new Set([0, endSec]);
  const addCut = (t) => { if (t > 0 && t < endSec) cutSet.add(t); };
  sp.forEach((e) => addCut(e.t));
  np.forEach((p) => { addCut(p.start); addCut(p.end); });
  const cuts = [...cutSet].sort((a, b) => a - b);

  const segs = [];
  let si = -1;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    while (si + 1 < sp.length && sp[si + 1].t <= a + 1e-9) si++;
    const speakerId = si >= 0 ? sp[si].speakerId : null;
    const mid = (a + b) / 2;
    const p = np.find((x) => x.start <= mid && mid < x.end);
    const part = p ? p.n : null;
    const last = segs[segs.length - 1];
    if (last && ((last.speakerId === speakerId && last.part === part) || b - a < 0.05)) {
      last.end = b;
      continue;
    }
    segs.push({ speakerId, part, start: a, end: b });
  }

  // tratto iniziale senza speaker dovuto al tempo di reazione
  if (segs.length > 1 && segs[0].speakerId === null && segs[1].speakerId !== null
      && segs[0].part === segs[1].part && segs[0].end - segs[0].start < absorbLeadSec) {
    segs[1].start = segs[0].start;
    segs.shift();
  }
  return segs;
}

// Speaker attivo a un certo istante secondo i segmenti
export function speakerAt(segments, t) {
  const s = segments.find((x) => x.start <= t && t < x.end) ?? segments[segments.length - 1];
  return s ? s.speakerId : null;
}

// Tempo di parola per partecipante (solo tratti con audio registrato)
export function talkTime(segments, participants) {
  const total = segments.filter((s) => s.speakerId && s.part !== null)
    .reduce((acc, s) => acc + (s.end - s.start), 0);
  return participants.map((p) => {
    const mine = segments.filter((s) => s.speakerId === p.id && s.part !== null);
    const seconds = mine.reduce((acc, s) => acc + (s.end - s.start), 0);
    return { id: p.id, name: p.name, color: p.color, seconds, turns: mine.length, percent: total ? (seconds / total) * 100 : 0 };
  }).sort((a, b) => b.seconds - a.seconds);
}

// Intervalli in cui l'app non era visibile (schermo bloccato, altra app): da eventi di sistema
export function hiddenIntervals(events) {
  const sys = sortEvents(events.filter((e) => e.type === 'sys'));
  const out = [];
  let start = null;
  for (const e of sys) {
    if (e.kind === 'hidden' && start === null) start = e.t;
    else if (e.kind === 'visible' && start !== null) {
      out.push({ start, end: e.t, dur: e.t - start });
      start = null;
    }
  }
  return out;
}

/**
 * Sposta nel tempo gli eventi dell'utente (non quelli di sistema).
 * Ogni shift { from, delta } si applica agli eventi con tempo originale >= from.
 * Restituisce solo gli eventi modificati (copie).
 */
export function applyShifts(events, shifts, { minT = 0, maxT = Infinity, rangeFrom = -Infinity, rangeTo = Infinity } = {}) {
  const changed = [];
  for (const e of events) {
    if (e.type === 'sys' || e.t < rangeFrom || e.t >= rangeTo) continue;
    const delta = shifts.filter((s) => e.t >= s.from).reduce((acc, s) => acc + s.delta, 0);
    if (!delta) continue;
    const t = Math.min(maxT, Math.max(minT, e.t + delta));
    if (t !== e.t) changed.push({ ...e, t, updatedAt: Date.now() });
  }
  return changed;
}

/**
 * Confronta la durata reale dell'audio di una parte con il tempo trascorso sull'orologio.
 * status:
 *  - 'unknown'  durata audio non misurata
 *  - 'ok'       differenza entro la tolleranza: timeline allineata
 *  - 'gaps'     il file ha salti nei timestamp (durata "piena" coerente, contenuto più corto)
 *  - 'shorter'  l'audio è più corto: dopo l'interruzione i tocchi sono in ritardo rispetto all'audio
 *               (quel tratto manca dal file, quindi ciò che segue nel file arriva prima).
 *               Se la differenza coincide con i periodi in background, `shifts` propone la correzione.
 *  - 'longer'   l'audio è più lungo del previsto (raro)
 */
export function driftCheck(part, events, tol = 2) {
  if (part.audioDurSec == null || part.endSec == null || part.startSec == null) return { status: 'unknown' };
  const w = part.endSec - part.startSec;
  const a = part.audioDurSec;
  const diff = w - a;
  if (Math.abs(diff) <= tol) return { status: 'ok', diff };
  if (diff < 0) return { status: 'longer', diff };
  if (part.audioSpanSec != null && Math.abs(w - part.audioSpanSec) <= tol) {
    return { status: 'gaps', diff, gaps: part.audioGaps ?? [] };
  }
  const hidden = hiddenIntervals(events)
    .filter((h) => h.start >= part.startSec - 1 && h.start <= part.endSec && h.dur > 0.5);
  const total = hidden.reduce((acc, h) => acc + h.dur, 0);
  const matches = hidden.length > 0 && Math.abs(total - diff) <= Math.max(tol, diff * 0.25);
  return {
    status: 'shorter',
    diff,
    hidden,
    shifts: matches ? hidden.map((h) => ({ from: h.end, delta: -h.dur })) : null,
  };
}

// File audio della riunione. In modalità "solo timeline" (audio registrato con un'altra app)
// un'unica parte virtuale copre tutta la riunione.
export function effectiveParts(meeting, endSec) {
  if (meeting.externalAudio) return [{ n: 1, startSec: 0, endSec, status: 'external', external: true }];
  return (meeting.parts ?? []).filter((p) => p.startSec != null);
}

// Fine della riunione: fine dichiarata, altrimenti il massimo fra parti ed eventi
export function meetingEnd(meeting, events = []) {
  if (meeting.endSec != null) return meeting.endSec;
  const partsEnd = Math.max(0, ...(meeting.parts ?? []).map((p) => p.endSec ?? p.startSec ?? 0));
  const evEnd = Math.max(0, ...events.map((e) => e.t));
  return Math.max(partsEnd, evEnd);
}

// Buchi fra una parte e la successiva (audio non registrato)
export function partGaps(parts, tol = 0.5) {
  const ps = [...(parts ?? [])].filter((p) => p.startSec != null).sort((a, b) => a.startSec - b.startSec);
  const out = [];
  for (let i = 0; i < ps.length - 1; i++) {
    const end = ps[i].endSec ?? ps[i].startSec;
    if (ps[i + 1].startSec - end > tol) out.push({ start: end, end: ps[i + 1].startSec, dur: ps[i + 1].startSec - end, afterPart: ps[i].n });
  }
  return out;
}
