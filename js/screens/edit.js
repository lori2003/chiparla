// Schermata 3: timeline modificabile, con lettore audio per controllare e correggere i tempi.

import { h, toast, openModal, confirmDialog, promptDialog } from '../ui.js';
import * as db from '../db.js';
import { getPartBlob, verifyMeetingAudio } from '../audio.js';
import {
  buildSegments, sortEvents, talkTime, driftCheck, applyShifts, meetingEnd, partGaps,
} from '../timeline.js';
import {
  fmtTime, fmtTimePrecise, fmtClock, fmtDuration, fmtDateTime, fmtBytes, parseTime, uid, textColorFor, nextColor,
} from '../util.js';

const TYPES = [['speaker', 'Chi parla'], ['note', '✎ Nota'], ['mark', '★ Importante']];
const NOTABLE_SYS = new Set(['hidden', 'visible', 'mute', 'unmute', 'ended', 'part-start', 'recorder-stop', 'error', 'container', 'device']);

export async function renderEdit(root, id) {
  const meeting = await db.getMeeting(id);
  if (!meeting) { location.replace('#/'); return undefined; }
  if (meeting.status === 'recording') { location.replace(`#/rec/${id}`); return undefined; }
  meeting.participants ??= [];
  meeting.parts ??= [];
  let events = await db.getEvents(id);
  let verifying = false;
  let showSys = events.some((e) => e.type === 'sys' && NOTABLE_SYS.has(e.kind) && e.kind !== 'part-start');

  const player = createPlayer(meeting);
  const top = h('div', {});
  const rest = h('div', {});
  root.replaceChildren(h('div', { class: 'screen edit' }, top, player.el, rest));

  const endSec = () => meetingEnd(meeting, events);
  const partOf = (sid) => meeting.participants.find((p) => p.id === sid);
  const saveMeeting = () => db.putMeeting(meeting);

  function render() {
    const end = endSec();
    const segs = buildSegments(events, { endSec: end, parts: meeting.parts });
    const sorted = sortEvents(events);
    const turns = segs.filter((s) => s.speakerId && s.part !== null).length;
    top.replaceChildren(
      h('header', { class: 'topbar' },
        h('a', { class: 'btn ghost small', href: '#/' }, '‹ Home'),
        h('button', { type: 'button', class: 'title-btn', onclick: renameMeeting }, meeting.title),
        h('a', { class: 'btn ghost small', href: `#/export/${id}` }, 'Esporta ›')),
      h('p', { class: 'muted small' },
        `${fmtDateTime(meeting.startedAt || meeting.createdAt)} · durata ${fmtTime(end)} · ${turns} interventi`),
      audioStatus());
    const info = speakerInfo(sorted, end);
    rest.replaceChildren(
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn small secondary', onclick: () => editEvent(null) }, '＋ Evento'),
        h('button', { type: 'button', class: 'btn small secondary', onclick: () => shiftDialog() }, '⇆ Sposta tempi'),
        h('label', { class: 'check small' },
          h('input', { type: 'checkbox', checked: showSys, onchange: (e) => { showSys = e.target.checked; render(); } }),
          h('span', {}, 'eventi tecnici'))),
      h('p', { class: 'muted small' }, 'Tocca un evento per cambiare persona o tempo. ▶ ascolta da un secondo prima.'),
      h('ul', { class: 'events' }, sorted.filter((e) => e.type !== 'sys' || (showSys && NOTABLE_SYS.has(e.kind))).map((e) => eventRow(e, info))),
      participantsCard(segs),
      h('div', { class: 'sticky-bottom' }, h('a', { class: 'btn primary xl', href: `#/export/${id}` }, 'Esporta i file ›')));
  }

  // ---------- stato dell'audio ----------

  function audioStatus() {
    if (meeting.externalAudio) return externalAudioCard();
    const parts = meeting.parts;
    if (!parts.length) return h('div', { class: 'card card-warn small' }, 'Nessun audio registrato per questa riunione.');
    const lines = parts.map((p) => {
      const label = parts.length > 1 ? `File audio ${p.n}` : 'File audio';
      const recovered = p.status === 'recovered' ? ' (recuperato dopo una chiusura improvvisa)' : '';
      if (p.deleted) return h('div', { class: 'line muted' }, `${label}: eliminato dal telefono.`);
      if (!p.audioCheckedAt) return h('div', { class: 'line muted' }, `${label}: ${verifying ? 'verifica in corso…' : 'non ancora verificato'}`);
      const size = p.bytes ? ` · ${fmtBytes(p.bytes)}` : '';
      const dur = p.audioDurSec != null ? fmtTime(p.audioDurSec) : 'durata non misurabile';
      const c = driftCheck(p, events);
      if (c.status === 'ok') return h('div', { class: 'line ok' }, `✓ ${label}: ${dur}${size}${recovered}. Allineato alla timeline.`);
      if (c.status === 'unknown') return h('div', { class: 'line muted' }, `${label}: ${dur}${size}${recovered}.`);
      if (c.status === 'gaps') {
        return h('div', { class: 'line warn' }, `⚠ ${label}: ${dur} di audio in ${fmtTime(p.endSec - p.startSec)}${recovered}. Contiene tratti senza suono registrato (salti nei tempi): i programmi che li saltano mostrano i tempi successivi in ritardo rispetto alla timeline.`);
      }
      if (c.status === 'longer') return h('div', { class: 'line warn' }, `⚠ ${label}: ${dur}, ${fmtDuration(-c.diff)} più del previsto${recovered}.`);
      return h('div', { class: 'line warn' },
        `⚠ ${label}: ${dur}, cioè ${fmtDuration(c.diff)} meno del tempo trascorso${recovered}. Il tratto mancante è stato saltato nel file, quindi i tocchi successivi sono in ritardo rispetto all'audio. `,
        c.shifts
          ? h('button', { type: 'button', class: 'btn small primary', onclick: () => applyDriftFix(p, c) }, 'Correggi i tempi')
          : h('span', {}, 'Usa «Sposta tempi» per riallinearli.'));
    });
    for (const g of partGaps(meeting.parts)) {
      lines.push(h('div', { class: 'line warn' }, `⚠ Audio mancante da ${fmtTime(g.start)} a ${fmtTime(g.end)} (${fmtDuration(g.dur)}).`));
    }
    return h('div', { class: 'audio-status' }, lines);
  }

  // Modalità "solo timeline": l'audio è in un file di un'altra app, iniziato prima di ChiParla
  function externalAudioCard() {
    const input = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'secondi, es. 7 oppure 0:07' });
    return h('div', { class: 'card small' },
      h('p', {}, h('strong', {}, 'Audio registrato con un\'altra app. '),
        meeting.externalOffset != null
          ? `Tempi allineati all'inizio del file audio (spostati di ${meeting.externalOffset} s). Se serve, puoi aggiungere altri secondi.`
          : 'Per allineare i tempi, nel file audio trova il momento in cui hai avviato ChiParla (per esempio quando hai detto «via») e scrivi a che punto si trova.'),
      h('div', { class: 'add-row' }, input,
        h('button', { type: 'button', class: 'btn secondary', onclick: () => alignExternal(input.value) }, 'Allinea')));
  }

  async function alignExternal(value) {
    const d = parseTime(value);
    if (!Number.isFinite(d) || d <= 0) { toast('Scrivi i secondi, per esempio 7 oppure 0:07'); return; }
    const end = endSec();
    // si spostano tutti gli eventi, anche quelli tecnici: cambia solo lo zero di riferimento
    events = events.map((e) => ({ ...e, t: e.t + d }));
    await db.putEvents(events);
    meeting.endSec = end + d;
    meeting.externalOffset = Math.round(((meeting.externalOffset ?? 0) + d) * 10) / 10;
    meeting.corrections = [...(meeting.corrections ?? []), { at: Date.now(), text: `tempi allineati all'audio esterno (+${d} s)` }];
    await saveMeeting();
    render();
    toast(`Tempi spostati di +${d} s`);
  }

  async function applyDriftFix(part, check) {
    const ok = await confirmDialog('Correggere i tempi?',
      `L'audio dura ${fmtDuration(check.diff)} meno del tempo trascorso, quanto il tempo in cui l'app è rimasta nascosta. `
      + 'Sposto indietro i tocchi successivi a ogni interruzione, così coincidono con l\'audio.', { ok: 'Correggi' });
    if (!ok) return;
    const changed = applyShifts(events, check.shifts, {
      rangeFrom: part.startSec, rangeTo: part.endSec, maxT: part.startSec + part.audioDurSec,
    });
    await db.putEvents(changed);
    const byId = new Map(changed.map((e) => [e.id, e]));
    events = events.map((e) => byId.get(e.id) ?? e);
    part.endSec = part.startSec + part.audioDurSec;
    meeting.corrections = [...(meeting.corrections ?? []), {
      at: Date.now(), text: `file ${part.n}: tocchi riallineati all'audio (compensati ${fmtDuration(check.diff)} non registrati)`,
    }];
    await saveMeeting();
    render();
    toast(`${changed.length} eventi riallineati`);
  }

  // ---------- elenco eventi ----------

  function eventRow(e, info) {
    if (e.type === 'sys') {
      return h('li', { class: 'ev ev-sys' }, h('span', { class: 'ev-time' }, fmtTime(e.t)), h('span', { class: 'ev-body' }, `ⓘ ${e.text || e.kind}`));
    }
    const play = player.el
      ? h('button', { type: 'button', class: 'ev-play', 'aria-label': `Ascolta da ${fmtTime(e.t)}`, onclick: () => player.seek(e.t) }, '▶')
      : null;
    let content;
    if (e.type === 'speaker') {
      const p = partOf(e.speakerId);
      const i = info.get(e.id);
      content = [
        h('span', { class: 'ev-dot', style: { background: p?.color ?? '#888' } }),
        h('strong', {}, p?.name ?? '(sconosciuto)'),
        h('span', { class: 'muted small' }, i?.dup ? ' (ripetuto)' : ` → ${fmtTime(i.until)} · ${fmtClock(i.until - e.t)}`),
      ];
    } else {
      content = [
        h('span', { class: 'ev-ico' }, e.type === 'note' ? '✎' : '★'),
        h('span', {}, e.text || (e.type === 'mark' ? 'Momento importante' : '(nota vuota)')),
      ];
    }
    return h('li', { class: `ev ev-${e.type}` },
      h('button', { type: 'button', class: 'ev-time', onclick: () => editEvent(e) }, fmtTime(e.t)),
      h('button', { type: 'button', class: 'ev-body', onclick: () => editEvent(e) }, content),
      play);
  }

  async function removeEvent(ev) {
    await db.deleteEvent(ev.id);
    events = events.filter((x) => x.id !== ev.id);
    render();
    toast('Evento eliminato', {
      action: 'Annulla',
      onAction: async () => {
        await db.putEvent(ev);
        events = [...events, ev];
        render();
      },
    });
  }

  // ---------- modifica / aggiunta ----------

  function editEvent(ev) {
    const isNew = !ev;
    const draft = ev ? { ...ev } : {
      id: uid('e'), meetingId: id, type: 'speaker', t: player.meetingTime() ?? 0, speakerId: null, text: '', createdAt: Date.now(),
    };
    const initialTime = fmtTimePrecise(draft.t);
    const timeInput = h('input', { type: 'text', inputmode: 'decimal', value: initialTime });
    const nudge = (d) => {
      const t = parseTime(timeInput.value);
      timeInput.value = fmtTimePrecise(Math.max(0, (Number.isFinite(t) ? t : draft.t) + d));
    };
    const typeRow = h('div', { class: 'seg' });
    const speakerRow = h('div', { class: 'speaker-pick' });
    const text = h('textarea', { rows: 3, placeholder: 'Testo' });
    text.value = draft.text || '';
    const textField = h('label', { class: 'field' }, h('span', {}, 'Testo'), text);

    const refresh = () => {
      typeRow.replaceChildren(...TYPES.map(([v, label]) => h('button', {
        type: 'button', class: draft.type === v ? 'on' : '', onclick: () => { draft.type = v; refresh(); },
      }, label)));
      speakerRow.hidden = draft.type !== 'speaker';
      textField.hidden = draft.type === 'speaker';
      speakerRow.replaceChildren(...meeting.participants.map((p) => h('button', {
        type: 'button',
        class: `pick${draft.speakerId === p.id ? ' on' : ''}`,
        style: { '--c': p.color, '--fg': textColorFor(p.color) },
        onclick: () => { draft.speakerId = p.id; refresh(); },
      }, p.name)));
    };
    refresh();

    const body = h('div', { class: 'edit-form' },
      h('div', { class: 'field' }, h('span', {}, 'Momento (ore:minuti:secondi)'), timeInput,
        h('div', { class: 'nudge' },
          [-5, -1, 1, 5].map((d) => h('button', { type: 'button', class: 'btn small secondary', onclick: () => nudge(d) }, `${d > 0 ? '+' : '−'}${Math.abs(d)} s`)),
          player.el ? h('button', {
            type: 'button',
            class: 'btn small secondary',
            onclick: () => {
              const t = player.meetingTime();
              if (t == null) toast('Fai partire prima il lettore audio'); else timeInput.value = fmtTimePrecise(t);
            },
          }, '⏱ Posizione audio') : null)),
      h('div', { class: 'field' }, h('span', {}, 'Tipo'), typeRow),
      speakerRow,
      textField);

    openModal({
      title: isNew ? 'Nuovo evento' : 'Modifica evento',
      body,
      actions: [
        isNew ? null : { label: 'Elimina', class: 'danger', onClick: async () => { await removeEvent(ev); return true; } },
        { label: 'Annulla', value: null, class: 'secondary' },
        {
          label: 'Salva',
          class: 'primary',
          onClick: async () => {
            // tempo non toccato: si conserva il valore originale al millisecondo
            const t = timeInput.value === initialTime ? draft.t : parseTime(timeInput.value);
            const end = endSec();
            if (!Number.isFinite(t) || t < 0) { toast('Tempo non valido: usa ore:minuti:secondi'); return false; }
            if (t > end + 0.05) { toast(`Oltre la fine della riunione (${fmtTime(end)})`); return false; }
            if (draft.type === 'speaker' && !draft.speakerId) { toast('Scegli chi parla'); return false; }
            if (draft.type === 'note' && !text.value.trim()) { toast('Scrivi il testo della nota'); return false; }
            const saved = { ...draft, t, updatedAt: Date.now(), edited: true };
            if (draft.type === 'speaker') delete saved.text; else { saved.text = text.value.trim(); delete saved.speakerId; }
            await db.putEvent(saved);
            events = [...events.filter((x) => x.id !== saved.id), saved];
            render();
            return true;
          },
        },
      ].filter(Boolean),
    });
  }

  function shiftDialog() {
    const from = h('input', { type: 'text', inputmode: 'decimal', value: fmtTime(player.meetingTime() ?? 0) });
    const delta = h('input', { type: 'text', inputmode: 'decimal', value: '-1' });
    openModal({
      title: 'Sposta i tempi',
      body: h('div', { class: 'edit-form' },
        h('p', { class: 'small' }, 'Sposta di N secondi tutti i tocchi (speaker, note, momenti) a partire da un certo momento. '
          + 'Esempi: tocchi sempre in ritardo di un secondo → da 00:00:00, −1. Audio in ritardo dopo un\'interruzione → dal momento dell\'interruzione, secondi negativi.'),
        h('label', { class: 'field' }, h('span', {}, 'A partire da (ore:minuti:secondi)'), from),
        h('label', { class: 'field' }, h('span', {}, 'Secondi (negativo = prima, positivo = dopo)'), delta)),
      actions: [
        { label: 'Annulla', value: null, class: 'secondary' },
        {
          label: 'Applica',
          class: 'primary',
          onClick: async () => {
            const f = parseTime(from.value);
            const d = parseFloat(String(delta.value).replace(',', '.').replace('−', '-'));
            if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) { toast('Valori non validi'); return false; }
            const changed = applyShifts(events, [{ from: f, delta: d }], { maxT: endSec() });
            await db.putEvents(changed);
            const byId = new Map(changed.map((e) => [e.id, e]));
            events = events.map((e) => byId.get(e.id) ?? e);
            meeting.corrections = [...(meeting.corrections ?? []), { at: Date.now(), text: `tocchi da ${fmtTime(f)} spostati di ${d} s` }];
            await saveMeeting();
            render();
            toast(`${changed.length} eventi spostati`);
            return true;
          },
        },
      ],
    });
  }

  // ---------- partecipanti ----------

  function participantsCard(segs) {
    const talk = talkTime(segs, meeting.participants);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Partecipanti e tempo di parola'),
      h('div', { class: 'talk' }, talk.map((t) => h('div', { class: 'talk-row' },
        h('button', { type: 'button', class: 'talk-name', onclick: () => renameParticipant(t.id) },
          h('span', { class: 'ev-dot', style: { background: t.color } }), t.name),
        h('div', { class: 'talk-bar' }, h('span', { style: { width: `${t.percent.toFixed(1)}%`, background: t.color } })),
        h('span', { class: 'talk-val small' }, `${fmtClock(t.seconds)} · ${Math.round(t.percent)}% · ${t.turns}×`)))),
      h('button', { type: 'button', class: 'btn small secondary', onclick: addParticipant }, '＋ Partecipante'));
  }

  function renameParticipant(pid) {
    const p = partOf(pid);
    promptDialog('Rinomina partecipante', { value: p.name }).then(async (v) => {
      if (!v) return;
      p.name = v;
      await saveMeeting();
      render();
    });
  }

  function addParticipant() {
    promptDialog('Nuovo partecipante', { placeholder: 'Nome', ok: 'Aggiungi' }).then(async (v) => {
      if (!v) return;
      meeting.participants.push({ id: uid('p'), name: v, color: nextColor(meeting.participants.map((x) => x.color)) });
      await saveMeeting();
      render();
    });
  }

  function renameMeeting() {
    promptDialog('Titolo della riunione', { value: meeting.title }).then(async (v) => {
      if (!v) return;
      meeting.title = v;
      await saveMeeting();
      render();
    });
  }

  render();
  if (meeting.parts.some((p) => !p.deleted && !p.audioCheckedAt)) {
    verifying = true;
    render();
    verifyMeetingAudio(meeting).catch(() => {}).finally(() => { verifying = false; render(); });
  }
  return () => player.destroy();
}

// Per ogni evento speaker: fino a quando parla e se ripete lo speaker precedente
function speakerInfo(sorted, end) {
  const sp = sorted.filter((e) => e.type === 'speaker');
  const info = new Map();
  for (let i = 0; i < sp.length; i++) {
    let j = i + 1;
    while (j < sp.length && sp[j].speakerId === sp[i].speakerId) j++;
    info.set(sp[i].id, { dup: i > 0 && sp[i - 1].speakerId === sp[i].speakerId, until: j < sp.length ? sp[j].t : end });
  }
  return info;
}

// Lettore audio: sceglie il file giusto in base al momento della riunione
function createPlayer(meeting) {
  const parts = (meeting.parts ?? []).filter((p) => !p.deleted && p.startSec != null);
  if (!parts.length) return { el: null, seek() {}, meetingTime: () => null, destroy() {} };
  const audio = h('audio', { controls: true, preload: 'metadata' });
  audio.setAttribute('playsinline', '');
  const pos = h('span', { class: 'muted small' }, '');
  const sel = parts.length > 1
    ? h('select', { onchange: (e) => load(parts.find((p) => p.n === Number(e.target.value))) },
      parts.map((p) => h('option', { value: String(p.n) }, `File ${p.n}: ${fmtTime(p.startSec)} → ${fmtTime(p.endSec ?? p.startSec)}`)))
    : null;
  let current = null;
  let url = null;

  async function load(p) {
    if (!p || current === p) return;
    current = p;
    if (sel) sel.value = String(p.n);
    const blob = await getPartBlob(meeting, p);
    if (current !== p) return;
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : null;
    if (url) audio.src = url; else audio.removeAttribute('src');
  }

  const partAt = (t) => parts.find((p) => t >= p.startSec - 0.01 && t < (p.endSec ?? Infinity)) ?? null;

  async function seek(t) {
    const p = partAt(t);
    if (!p) { toast('In quel momento l\'audio non è stato registrato'); return; }
    if (current !== p) await load(p);
    const go = () => {
      try { audio.currentTime = Math.max(0, t - p.startSec - 1); } catch { /* non ancora pronto */ }
      audio.play().catch(() => toast('Premi ▶ sul lettore per ascoltare'));
    };
    if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
  }

  audio.addEventListener('timeupdate', () => {
    if (current) pos.textContent = `Posizione nella riunione: ${fmtTimePrecise(current.startSec + audio.currentTime)}`;
  });
  load(parts[0]);
  return {
    el: h('div', { class: 'player' }, audio, h('div', { class: 'player-row' }, sel, pos)),
    seek,
    meetingTime: () => (current && audio.currentTime > 0 ? current.startSec + audio.currentTime : null),
    destroy() {
      audio.pause();
      if (url) URL.revokeObjectURL(url);
    },
  };
}
