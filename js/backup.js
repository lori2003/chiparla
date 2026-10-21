// Backup completo di una riunione in un unico file .zip, e ripristino da quel file.
//
// Il backup contiene tutto ciò che serve per ricostruire la riunione in ChiParla (anche su un
// altro iPhone o dopo che Safari ha cancellato i dati) e, già pronti per l'uso sul computer:
// audio .m4a, Markdown per AI, JSON, CSV, TXT e un rapporto di verifica.
// Il ripristino non sovrascrive mai una riunione esistente: se c'è già, crea una copia.

import * as db from './db.js';
import { getPartBlob } from './audio.js';
import { makeZip, readZip, crc32Blob } from './zip.js';
import {
  buildModel, toJSON, toCSV, toTXT, toMarkdown, fileBase, audioFileName,
} from './exporters.js';
import { driftCheck } from './timeline.js';
import { fmtTime, fmtBytes, fmtDateTime, uid } from './util.js';

export const BACKUP_FORMAT = 'chiparla-backup/1';
export const BACKUP_DATA = 'chiparla-backup.json';
const RESTORE_CHUNK = 4 << 20; // l'audio ripristinato si salva a pezzi da 4 MB

// true se della riunione è stato fatto (e condiviso o scaricato) un backup completo
export const isBackedUp = (m) => !!m.backupAt;

// Rapporto leggibile: che cosa è stato davvero registrato e salvato
export function verificationReport(meeting, events, model, audio) {
  const L = [];
  const count = (type) => events.filter((e) => e.type === type).length;
  L.push(`RAPPORTO DI VERIFICA – ${meeting.title}`);
  L.push(`Creato il ${fmtDateTime(Date.now())} da ChiParla ${model.version}`.trim());
  L.push('');
  L.push(`Inizio registrazione: ${meeting.startedAt ? fmtDateTime(meeting.startedAt) : '—'}`);
  L.push(`Durata della riunione (orologio del telefono): ${fmtTime(model.endSec)}`);
  L.push(`Partecipanti: ${(meeting.participants ?? []).map((p) => p.name).join(', ') || '—'}`);
  L.push(`Eventi salvati: ${events.length} (cambi di chi parla ${count('speaker')}, frasi trascritte ${count('speech')}, note ${count('note')}, momenti importanti ${count('mark')}, eventi tecnici ${count('sys')})`);
  L.push('');
  L.push('FILE AUDIO');
  if (meeting.externalAudio) L.push('- Audio registrato con un\'altra app: non incluso.');
  for (const p of meeting.parts ?? []) {
    const a = audio.find((x) => x.n === p.n);
    const expected = p.endSec != null && p.startSec != null ? p.endSec - p.startSec : null;
    const measured = p.audioDurSec != null ? fmtTime(p.audioDurSec) : 'non misurata';
    const check = driftCheck(p, events).status;
    const verdict = { ok: '✓ allineato', gaps: '⚠ contiene salti', shorter: '⚠ più corto del tempo trascorso', longer: '⚠ più lungo del previsto', unknown: '? non verificabile' }[check];
    if (p.deleted) { L.push(`- File ${p.n}: eliminato dal telefono prima del backup.`); continue; }
    L.push(`- File ${p.n}: ${a ? `${a.file}, ${fmtBytes(a.size)}, CRC ${a.crc.toString(16).padStart(8, '0')}` : 'NESSUN AUDIO SALVATO'}`
      + ` · da ${fmtTime(p.startSec)} a ${fmtTime(p.endSec ?? p.startSec)}`
      + ` · durata attesa ${expected != null ? fmtTime(expected) : '—'}, misurata ${measured} · ${verdict}`);
  }
  L.push('');
  L.push('AVVISI');
  if (model.warnings.length) model.warnings.forEach((w) => L.push(`- ${w}`)); else L.push('- Nessuno.');
  L.push('');
  L.push('Per ripristinare la riunione in ChiParla: Home → «Ripristina un backup» → scegli questo file .zip.');
  return `${L.join('\n')}\n`;
}

/**
 * Crea il backup. onProgress(frase, frazione).
 * Restituisce { blob, name, report, entries } dopo averlo riletto e controllato.
 */
export async function buildBackup(meeting, events, { version = '', onProgress } = {}) {
  const base = fileBase(meeting);
  const model = buildModel(meeting, events, { version });
  const audio = [];
  const audioEntries = [];
  for (const p of meeting.parts ?? []) {
    if (p.deleted) continue;
    onProgress?.('Raccolgo l\'audio…', 0);
    const blob = await getPartBlob(meeting, p);
    if (!blob?.size) continue;
    const file = `audio/${audioFileName(meeting, p)}`;
    audio.push({ n: p.n, file, size: blob.size, mimeType: p.mimeType, crc: 0 });
    audioEntries.push({ name: file, data: blob, crc: 0 });
  }
  // CRC dell'audio calcolati qui, così finiscono anche nel rapporto
  const totalAudio = audio.reduce((acc, a) => acc + a.size, 0) || 1;
  let done = 0;
  for (let i = 0; i < audio.length; i++) {
    audio[i].crc = await crc32Blob(audioEntries[i].data, {
      onProgress: (n) => onProgress?.('Controllo l\'audio…', (done + n) / totalAudio),
    });
    audioEntries[i].crc = audio[i].crc; // makeZip non lo ricalcola
    done += audio[i].size;
  }
  const data = {
    format: BACKUP_FORMAT,
    generator: `ChiParla ${version}`.trim(),
    created_at: new Date().toISOString(),
    meeting: { ...meeting },
    events,
    audio: audio.map(({ n, file, size, mimeType, crc }) => ({ part: n, file, size, mimeType, crc })),
  };
  const report = verificationReport(meeting, events, model, audio);
  const entries = [
    { name: BACKUP_DATA, data: JSON.stringify(data) },
    { name: 'LEGGIMI-VERIFICA.txt', data: report },
    { name: `${base}_per-AI.md`, data: toMarkdown(model) },
    { name: `${base}.json`, data: toJSON(model) },
    { name: `${base}.csv`, data: toCSV(model) },
    { name: `${base}.txt`, data: toTXT(model) },
    ...audioEntries,
  ];
  const blob = await makeZip(entries, { onProgress: (f) => onProgress?.('Creo il backup…', f) });
  onProgress?.('Verifico il backup…', 1);
  const check = await verifyBackup(blob, data);
  return { blob, name: `${base}_BACKUP.zip`, report, check };
}

/**
 * Rilegge un backup e controlla che contenga davvero tutto: dati della riunione leggibili,
 * ogni file audio presente con la dimensione giusta e, se `full`, con lo stesso CRC.
 */
export async function verifyBackup(blob, expected = null, { full = false, onProgress } = {}) {
  const entries = await readZip(blob);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const dataEntry = byName.get(BACKUP_DATA);
  if (!dataEntry) throw new Error('Questo file non è un backup di ChiParla (manca chiparla-backup.json).');
  const data = JSON.parse(await dataEntry.blob.text());
  if (data.format !== BACKUP_FORMAT) throw new Error(`Formato di backup non riconosciuto: ${data.format}`);
  if (expected && (data.meeting?.id !== expected.meeting.id || data.events?.length !== expected.events.length)) {
    throw new Error('Il backup riletto non coincide con la riunione.');
  }
  const problems = [];
  let bytes = 0;
  for (const a of data.audio ?? []) {
    const e = byName.get(a.file);
    if (!e) { problems.push(`manca ${a.file}`); continue; }
    if (e.blob.size !== a.size) { problems.push(`${a.file}: dimensione ${e.blob.size} invece di ${a.size}`); continue; }
    if (full) {
      const crc = await crc32Blob(e.blob, { onProgress: (n) => onProgress?.((bytes + n) / blob.size) });
      if (crc !== a.crc) problems.push(`${a.file}: contenuto diverso dall'originale (CRC)`);
    }
    bytes += e.blob.size;
  }
  if (problems.length) throw new Error(`Backup non valido: ${problems.join('; ')}`);
  return { data, entries, audioFiles: (data.audio ?? []).length, audioBytes: bytes, events: data.events.length };
}

// Ripristina una riunione da un file di backup. Restituisce la riunione salvata.
export async function restoreBackup(file, { onProgress } = {}) {
  onProgress?.('Controllo il file…', 0);
  const { data, entries } = await verifyBackup(file, null, { full: true, onProgress: (f) => onProgress?.('Controllo il file…', f) });
  const byName = new Map(entries.map((e) => [e.name, e]));
  const meeting = { ...data.meeting };
  let events = data.events ?? [];
  // mai sovrascrivere: se la riunione esiste già (anche nel cestino) si crea una copia
  const existing = await db.getMeeting(meeting.id);
  if (existing) {
    meeting.id = uid('r');
    meeting.title = `${meeting.title} (ripristinata)`;
    events = events.map((e) => ({ ...e, id: uid('e'), meetingId: meeting.id }));
  }
  delete meeting.deletedAt;
  meeting.restoredAt = Date.now();
  meeting.backupAt ??= Date.now(); // esiste già un backup: è il file da cui la si sta ripristinando
  if (meeting.status === 'recording') meeting.status = 'stopped';

  const audioByPart = new Map((data.audio ?? []).map((a) => [a.part, a]));
  const total = (data.audio ?? []).reduce((acc, a) => acc + a.size, 0) || 1;
  let done = 0;
  try {
    for (const p of meeting.parts ?? []) {
      const a = audioByPart.get(p.n);
      const blob = a ? byName.get(a.file)?.blob : null;
      if (!blob) { p.deleted = true; continue; }
      let seq = 0;
      for (let off = 0; off < blob.size; off += RESTORE_CHUNK) {
        const slice = blob.slice(off, Math.min(blob.size, off + RESTORE_CHUNK), blob.type || a.mimeType);
        await db.putChunk({ meetingId: meeting.id, part: p.n, seq: seq++, data: slice, size: slice.size, at: Date.now(), restored: true });
        onProgress?.('Ripristino l\'audio…', (done + off + slice.size) / total);
      }
      done += blob.size;
      p.deleted = false;
      p.chunks = seq;
      p.bytes = blob.size;
    }
    await db.putEvents(events.map((e) => ({ ...e, meetingId: meeting.id })));
    await db.putMeeting(meeting); // per ultima: finché non c'è, il ripristino non risulta fatto
  } catch (e) {
    // ripristino a metà: si toglie ciò che è stato scritto (l'id è nuovo, non tocca altre riunioni)
    await db.deleteMeeting(meeting.id).catch(() => {});
    throw e;
  }
  return meeting;
}
