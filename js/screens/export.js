// Schermata 4: esportazione di audio, Markdown per AI, JSON, CSV, TXT.
// Su iPhone la strada più affidabile è «Condividi» → «Salva su File» / AirDrop / Mail.

import { h, toast, confirmDialog } from '../ui.js';
import * as db from '../db.js';
import { getPartBlob, verifyMeetingAudio } from '../audio.js';
import {
  buildModel, toJSON, toCSV, toTXT, toMarkdown, fileBase, audioFileName,
} from '../exporters.js';
import { appVersion } from '../env.js';
import { fmtTime, fmtBytes, fmtDateTime, baseMime } from '../util.js';

const ICONS = { audio: '🎧', md: '🤖', json: '{ }', csv: '▦', txt: '≡' };
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function renderExport(root, id) {
  const meeting = await db.getMeeting(id);
  if (!meeting) { location.replace('#/'); return undefined; }
  if (meeting.status === 'recording') { location.replace(`#/rec/${id}`); return undefined; }
  meeting.parts ??= [];
  root.replaceChildren(h('div', { class: 'screen' }, h('p', { class: 'muted' }, 'Preparo i file…')));

  if (meeting.parts.some((p) => !p.deleted && !p.audioCheckedAt)) await verifyMeetingAudio(meeting).catch(() => {});
  const events = await db.getEvents(id);
  const model = buildModel(meeting, events, { version: await appVersion() });
  const files = await prepareFiles(meeting, model);
  const md = files.find((f) => f.kind === 'md');

  root.replaceChildren(h('div', { class: 'screen export' },
    h('header', { class: 'topbar' },
      h('a', { class: 'btn ghost small', href: `#/timeline/${id}` }, '‹ Timeline'),
      h('h1', {}, 'Esporta')),
    h('div', { class: 'card' },
      h('strong', {}, meeting.title),
      h('p', { class: 'small muted' },
        `${fmtDateTime(meeting.startedAt || meeting.createdAt)} · ${fmtTime(model.endSec)} · ${count(meeting.participants.length, 'persona', 'persone')} · `
        + `${count(model.segments.filter((s) => s.speaker && s.audio_part !== null).length, 'intervento', 'interventi')} · `
        + `${count(model.notes.length, 'nota', 'note')} · ${count(model.highlights.length, 'momento importante', 'momenti importanti')}`)),
    model.warnings.length
      ? h('details', { class: 'card card-warn small' }, h('summary', {}, `⚠ ${model.warnings.length} avvisi sulla registrazione (inclusi nei file)`),
        h('ul', {}, model.warnings.map((w) => h('li', {}, w))))
      : null,
    h('button', { type: 'button', class: 'btn primary xl', onclick: () => share(files) }, '⬆ Condividi tutti i file'),
    h('p', { class: 'muted small center' }, 'Nel foglio di condivisione scegli «Salva su File» per tenerli sull\'iPhone, oppure AirDrop o Mail per spostarli sul computer.'),
    h('ul', { class: 'files' }, files.map((f) => h('li', { class: 'file' },
      h('span', { class: 'file-ico', 'aria-hidden': 'true' }, ICONS[f.kind]),
      h('span', { class: 'file-main' }, h('strong', {}, `${f.label} · ${fmtBytes(f.blob.size)}`), h('span', { class: 'muted small' }, f.name)),
      h('span', { class: 'file-actions' },
        h('button', { type: 'button', class: 'btn small secondary', onclick: () => share([f]) }, 'Condividi'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => download(f) }, 'Scarica'))))),
    md ? h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn secondary', onclick: () => copyText(md.text) }, 'Copia il Markdown'),
      h('span', { class: 'muted small' }, 'da incollare direttamente in ChatGPT o simili')) : null,
    md ? h('details', { class: 'card' }, h('summary', {}, 'Anteprima del Markdown per AI'), h('pre', { class: 'preview' }, md.text)) : null,
    h('details', { class: 'card danger-zone' },
      h('summary', {}, 'Libera spazio / elimina'),
      h('p', { class: 'small' }, 'Esporta e controlla i file prima di eliminare: sul telefono non esiste un cestino per questi dati.'),
      h('div', { class: 'row' },
        meeting.parts.some((p) => !p.deleted)
          ? h('button', { type: 'button', class: 'btn danger', onclick: () => deleteAudio(meeting) }, 'Elimina solo l\'audio')
          : null,
        h('button', { type: 'button', class: 'btn danger', onclick: () => deleteMeeting(meeting) }, 'Elimina la riunione')))));
  return undefined;
}

async function prepareFiles(meeting, model) {
  const base = fileBase(meeting);
  const files = [];
  for (const p of model.parts) {
    if (p.deleted) continue;
    const blob = await getPartBlob(meeting, p);
    if (blob?.size) {
      files.push({
        kind: 'audio', label: model.parts.length > 1 ? `Audio – file ${p.n}` : 'Audio', name: audioFileName(meeting, p), type: baseMime(p.mimeType), blob,
      });
    }
  }
  const text = (kind, label, name, type, content) => ({ kind, label, name, type, text: content, blob: new Blob([content], { type }) });
  files.push(text('md', 'Markdown per AI', `${base}_per-AI.md`, 'text/markdown', toMarkdown(model)));
  files.push(text('json', 'JSON – dati completi', `${base}.json`, 'application/json', toJSON(model)));
  files.push(text('csv', 'CSV – tabella', `${base}.csv`, 'text/csv', toCSV(model)));
  files.push(text('txt', 'TXT – testo leggibile', `${base}.txt`, 'text/plain', toTXT(model)));
  return files;
}

// Alcuni browser accettano solo certi tipi: in quel caso i file di testo passano come text/plain
function shareableFiles(list) {
  if (!navigator.canShare) return null;
  const make = (plain) => list.map((f) => new File([f.blob], f.name, { type: plain && f.kind !== 'audio' ? 'text/plain' : f.type }));
  for (const plain of [false, true]) {
    const files = make(plain);
    try { if (navigator.canShare({ files })) return files; } catch { /* prova la variante successiva */ }
  }
  return null;
}

// Deve restare sincrona fino a navigator.share: iOS richiede che parta dal tocco
function share(list) {
  const files = shareableFiles(list);
  if (!files) {
    toast('Condivisione di file non disponibile: avvio il download.');
    list.forEach((f, i) => setTimeout(() => download(f), i * 400));
    return;
  }
  // Solo "files": su iOS aggiungere title/text può far condividere il testo invece dei file
  navigator.share({ files }).catch((e) => {
    if (e?.name !== 'AbortError') toast(`Condivisione non riuscita: ${e?.message || e}`);
  });
}

function download(f) {
  const url = URL.createObjectURL(f.blob);
  const a = h('a', { href: url, download: f.name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Markdown copiato');
  } catch {
    toast('Copia non riuscita: usa «Condividi» sul file Markdown');
  }
}

async function deleteAudio(meeting) {
  const ok = await confirmDialog('Eliminare l\'audio?', 'Restano timeline, note ed esportazioni di testo. L\'audio non si potrà recuperare.', { ok: 'Elimina audio', danger: true });
  if (!ok) return;
  await db.deleteChunks(meeting.id);
  meeting.parts.forEach((p) => { p.deleted = true; });
  await db.putMeeting(meeting);
  toast('Audio eliminato');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function deleteMeeting(meeting) {
  const ok = await confirmDialog('Eliminare la riunione?', `«${meeting.title}»: audio, timeline e note verranno cancellati da questo telefono.`, { ok: 'Elimina tutto', danger: true });
  if (!ok) return;
  await db.deleteMeeting(meeting.id);
  toast('Riunione eliminata');
  location.hash = '#/';
}
