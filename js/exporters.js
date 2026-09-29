// Generazione dei file di esportazione (JSON, CSV, TXT, Markdown per AI).
// Funzioni pure: ricevono riunione + eventi e restituiscono testo.

import {
  buildSegments, talkTime, sortEvents, speakerAt, partGaps, hiddenIntervals, driftCheck, meetingEnd, effectiveParts,
  transcriptItems, segmentTexts,
} from './timeline.js';
import {
  fmtTime, fmtClock, fmtDuration, fmtDateTime, round1, slugify, pad2, baseMime, extForMime,
} from './util.js';

export function fileBase(meeting) {
  const d = new Date(meeting.startedAt || meeting.createdAt || Date.now());
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `${stamp}_${slugify(meeting.title) || 'riunione'}`;
}

export function audioFileName(meeting, part) {
  const multi = (meeting.parts?.length ?? 0) > 1;
  return `${fileBase(meeting)}_audio${multi ? `-parte${part.n}` : ''}.${part.ext || extForMime(part.mimeType)}`;
}

const partLabel = (parts, p) => (parts.length > 1 ? ` (parte ${p.n})` : '');

export function buildWarnings(meeting, events) {
  const out = [];
  const parts = meeting.parts ?? [];
  for (const g of partGaps(parts)) {
    out.push(`Audio non registrato da ${fmtTime(g.start)} a ${fmtTime(g.end)} (${fmtDuration(g.dur)}): la registrazione si è interrotta ed è ripartita in un nuovo file.`);
  }
  for (const p of parts) {
    const lbl = partLabel(parts, p);
    if (p.status === 'recovered') out.push(`File audio${lbl} recuperato dopo una chiusura improvvisa dell'app: gli ultimi secondi prima della chiusura potrebbero mancare.`);
    if (p.deleted) out.push(`File audio${lbl} eliminato dal telefono.`);
    const d = driftCheck(p, events);
    if (d.status === 'shorter') out.push(`L'audio${lbl} dura ${fmtDuration(d.diff)} meno del tempo trascorso: dopo un'interruzione i tempi della timeline potrebbero essere in ritardo rispetto all'audio.`);
    if (d.status === 'gaps') out.push(`Il file audio${lbl} contiene salti temporali per ${fmtDuration(d.diff)} in totale (tratti senza suono registrato): se il programma che lo legge li salta, i tempi successivi della timeline risultano in ritardo rispetto all'audio.`);
    if (d.status === 'longer') out.push(`L'audio${lbl} dura ${fmtDuration(-d.diff)} più del tempo trascorso: controlla l'allineamento.`);
  }
  for (const h of hiddenIntervals(events)) {
    if (h.dur < 1) continue;
    out.push(meeting.externalAudio
      ? `App non visibile da ${fmtTime(h.start)} per ${fmtDuration(h.dur)}: in quel tratto non è stato possibile segnare i cambi di speaker (l'audio dell'altra app non ne risente).`
      : `App non visibile da ${fmtTime(h.start)} per ${fmtDuration(h.dur)} (schermo bloccato o altra app): in quel tratto iOS potrebbe non aver registrato.`);
  }
  if (meeting.externalAudio && meeting.externalOffset == null) {
    out.push('Audio registrato con un\'altra app e tempi non ancora allineati: lo zero della timeline è l\'avvio di ChiParla, non l\'inizio del file audio.');
  }
  return out;
}

export function buildModel(meeting, events, { version = '', generatedAt = Date.now() } = {}) {
  const endSec = meetingEnd(meeting, events);
  const parts = effectiveParts(meeting, endSec);
  const participants = meeting.participants ?? [];
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const nameOf = (id) => (id == null ? null : names.get(id) ?? '(sconosciuto)');
  const segs = buildSegments(events, { endSec, parts });
  const partAt = (t) => parts.find((p) => p.startSec <= t && t < (p.endSec ?? endSec)) ?? null;
  const items = transcriptItems(events, segs);
  const texts = segmentTexts(segs, items);

  const segments = segs.map((s, i) => ({
    speaker: nameOf(s.speakerId),
    start_seconds: round1(s.start),
    end_seconds: round1(s.end),
    start: fmtTime(s.start),
    end: fmtTime(s.end),
    audio_part: s.part,
    text: texts[i],
  }));

  // Trascrizione frase per frase (automatica, approssimativa)
  const transcript = items.map((it) => ({
    speaker: nameOf(it.speakerId),
    start_seconds: round1(it.start),
    end_seconds: round1(it.end),
    start: fmtTime(it.start),
    end: fmtTime(it.end),
    text: it.text,
  }));

  const sorted = sortEvents(events);
  const point = (e) => ({
    time_seconds: round1(e.t),
    time: fmtTime(e.t),
    speaker: nameOf(speakerAt(segs, e.t)),
    text: e.text || '',
    audio_part: partAt(e.t)?.n ?? null,
  });

  const audioFiles = parts.map((p) => ({
    part: p.n,
    file: p.deleted || p.external ? null : audioFileName(meeting, p),
    external: p.external || undefined,
    mime_type: p.external ? null : baseMime(p.mimeType),
    start_seconds: round1(p.startSec),
    end_seconds: round1(p.endSec ?? endSec),
    start: fmtTime(p.startSec),
    end: fmtTime(p.endSec ?? endSec),
    measured_duration_seconds: p.audioDurSec != null ? round1(p.audioDurSec) : null,
    status: p.status,
    deleted: !!p.deleted,
  }));

  return {
    meeting,
    endSec,
    parts,
    segs,
    segments,
    transcript,
    notes: sorted.filter((e) => e.type === 'note').map(point),
    highlights: sorted.filter((e) => e.type === 'mark').map(point),
    audioFiles,
    talk: talkTime(segs, participants),
    warnings: buildWarnings(meeting, events),
    events: sorted,
    nameOf,
    version,
    generatedAt,
  };
}

// ---------- JSON ----------

export function toJSON(model) {
  const m = model.meeting;
  const obj = {
    format: 'chiparla/1',
    generator: `ChiParla ${model.version}`.trim(),
    generated_at: new Date(model.generatedAt).toISOString(),
    meeting: {
      id: m.id,
      title: m.title,
      started_at: m.startedAt ? new Date(m.startedAt).toISOString() : null,
      duration_seconds: round1(model.endSec),
      duration: fmtTime(model.endSec),
    },
    participants: (m.participants ?? []).map((p) => ({ name: p.name, color: p.color })),
    audio_files: model.audioFiles,
    // Formato richiesto: un elemento per ogni intervento (audio_part: file audio di riferimento,
    // text: testo riconosciuto in diretta, approssimativo)
    segments: model.segments,
    transcript: model.transcript,
    transcript_source: model.transcript.length
      ? 'Riconoscimento vocale del browser in tempo reale (Web Speech API): automatico e approssimativo'
      : null,
    notes: model.notes,
    highlights: model.highlights,
    talk_time: model.talk.map((t) => ({
      speaker: t.name, seconds: round1(t.seconds), percent: round1(t.percent), turns: t.turns,
    })),
    events: model.events.map((e) => ({
      type: e.type,
      time_seconds: round1(e.t),
      time: fmtTime(e.t),
      speaker: e.speakerId ? model.nameOf(e.speakerId) : undefined,
      text: e.text || undefined,
      kind: e.kind || undefined,
    })),
    warnings: model.warnings,
    corrections: m.corrections ?? [],
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

// ---------- CSV ----------

export const CSV_HEADER = ['type', 'speaker', 'start', 'end', 'start_seconds', 'end_seconds', 'duration_seconds', 'audio_part', 'text'];

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(model) {
  const rows = [];
  for (const s of model.segments) {
    rows.push({ t: s.start_seconds, o: 0, cells: ['segment', s.speaker ?? '', s.start, s.end, s.start_seconds, s.end_seconds, round1(s.end_seconds - s.start_seconds), s.audio_part ?? '', s.text] });
  }
  for (const [type, list, o] of [['highlight', model.highlights, 1], ['note', model.notes, 2]]) {
    for (const n of list) rows.push({ t: n.time_seconds, o, cells: [type, n.speaker ?? '', n.time, '', n.time_seconds, '', '', n.audio_part ?? '', n.text] });
  }
  rows.sort((a, b) => a.t - b.t || a.o - b.o);
  const lines = [CSV_HEADER, ...rows.map((r) => r.cells)].map((r) => r.map(csvCell).join(','));
  // BOM: fa riconoscere l'UTF-8 (accenti) a Excel
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------- TXT ----------

const who = (name) => name ?? '(nessuno indicato)';

export function toTXT(model) {
  const m = model.meeting;
  const L = [];
  L.push(`RIUNIONE: ${m.title}`);
  L.push(`Inizio: ${m.startedAt ? fmtDateTime(m.startedAt) : '—'} · Durata: ${fmtTime(model.endSec)}`);
  L.push(`Partecipanti: ${(m.participants ?? []).map((p) => p.name).join(', ')}`);
  for (const f of model.audioFiles) {
    if (f.external) L.push('Audio: registrato con un\'altra app (non incluso)');
    else L.push(`Audio: ${f.file ?? '(eliminato)'} (${f.start} → ${f.end})`);
  }
  L.push('', 'CAMBI DI SPEAKER (tocchi)');
  let last = null;
  for (const e of model.events.filter((x) => x.type === 'speaker')) {
    if (e.speakerId === last) continue;
    last = e.speakerId;
    L.push(`${fmtTime(e.t)} — ${model.nameOf(e.speakerId)}`);
  }
  L.push('', model.transcript.length ? 'INTERVENTI (con il testo riconosciuto in diretta, approssimativo)' : 'INTERVENTI');
  for (const s of model.segments) {
    const label = s.audio_part === null ? `${who(s.speaker)} [audio non registrato]` : who(s.speaker);
    L.push(`${s.start} → ${s.end} | ${label}`);
    if (s.text) L.push(`    ${s.text}`);
  }
  if (model.highlights.length) {
    L.push('', 'MOMENTI IMPORTANTI');
    for (const h of model.highlights) L.push(`${h.time} — ★${h.text ? ` ${h.text}` : ''} (parlava: ${who(h.speaker)})`);
  }
  if (model.notes.length) {
    L.push('', 'NOTE');
    for (const n of model.notes) L.push(`${n.time} — ${n.text} (parlava: ${who(n.speaker)})`);
  }
  if (model.warnings.length) {
    L.push('', 'AVVISI SULLA REGISTRAZIONE');
    for (const w of model.warnings) L.push(`- ${w}`);
  }
  return `${L.join('\n')}\n`;
}

// ---------- Markdown per AI ----------

const mdEsc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();

function segmentTable(rows, offset = 0, withFile = false) {
  const L = [];
  L.push(withFile ? '| # | Inizio | Fine | Durata | Chi parla | File audio |' : '| # | Inizio | Fine | Durata | Chi parla |');
  L.push(withFile ? '|---:|---|---|---:|---|---:|' : '|---:|---|---|---:|---|');
  rows.forEach((s, i) => {
    const name = s.audio_part === null ? `${mdEsc(who(s.speaker))} _(audio non registrato)_` : mdEsc(who(s.speaker));
    const cells = [i + 1, fmtTime(s.start_seconds - offset), fmtTime(s.end_seconds - offset), fmtClock(s.end_seconds - s.start_seconds), name];
    if (withFile) cells.push(s.audio_part ?? '—');
    L.push(`| ${cells.join(' | ')} |`);
  });
  return L;
}

export function toMarkdown(model) {
  const m = model.meeting;
  const files = model.audioFiles;
  const multi = files.length > 1;
  const hasText = model.transcript.length > 0;
  const L = [];

  L.push(`# Riunione: ${mdEsc(m.title)}`, '');
  L.push(`> Documento generato da ChiParla. Contiene la **timeline degli interventi** (chi parlava e quando), segnata a mano in tempo reale toccando il nome di chi prendeva la parola, ${hasText ? 'la **trascrizione automatica** fatta in diretta, ' : ''}più note e momenti importanti. Va usato insieme al file audio della stessa riunione.`, '');

  L.push('## Informazioni', '');
  L.push(`- **Inizio:** ${m.startedAt ? fmtDateTime(m.startedAt) : '—'}`);
  L.push(`- **Durata:** ${fmtTime(model.endSec)} (${fmtDuration(model.endSec)})`);
  L.push(`- **Partecipanti (${(m.participants ?? []).length}):** ${(m.participants ?? []).map((p) => mdEsc(p.name)).join(', ')}`);
  if (!files.length) L.push('- **Audio:** nessun file audio');
  for (const f of files) {
    if (f.external) {
      L.push(`- **Audio:** registrato con un'altra app (es. Memo Vocali), da fornire insieme a questo documento. ${m.externalOffset != null
        ? 'I tempi qui sotto sono già allineati all\'inizio di quel file audio.'
        : 'Attenzione: i tempi partono dall\'avvio di ChiParla; se l\'audio è partito prima, sono in anticipo di quella quantità rispetto al file.'}`);
      continue;
    }
    const range = multi ? `, copre ${f.start} → ${f.end} della riunione` : '';
    L.push(`- **File audio${multi ? ` ${f.part}` : ''}:** ${f.file ? `\`${f.file}\`` : '_(eliminato)_'}${range}`);
  }
  L.push('');

  L.push("## Istruzioni per l'AI", '');
  L.push(hasText
    ? "1. Più sotto c'è una trascrizione automatica fatta in diretta dal riconoscimento vocale del telefono: è **approssimativa** (parole mancanti o sbagliate, frasi attribuite con qualche secondo di ritardo). Se hai anche l'audio, trascrivilo di nuovo con attenzione e usa questa trascrizione solo come riferimento; se non hai l'audio, lavora su questa correggendo gli errori evidenti."
    : "1. Trascrivi l'audio della riunione.");
  L.push('2. Usa la timeline qui sotto per attribuire ogni frase a chi parla: in ogni intervallo aveva la parola la persona indicata.');
  L.push('3. I tempi sono stati segnati a mano in tempo reale, quindi di solito sono **in ritardo di 1-3 secondi** rispetto al vero cambio di voce: se senti il cambio di voce poco prima del tempo indicato, sposta il confine sul cambio di voce ma mantieni l\'attribuzione della timeline.');
  L.push('4. Se dentro un intervallo si sente brevemente un\'altra voce (interruzioni, battute), attribuiscila solo se è chiaro chi parla; altrimenti scrivi [voce non identificata]. Non inventare nomi né contenuti; dove l\'audio non si capisce scrivi [incomprensibile].');
  L.push('5. Note e momenti importanti riportano il momento in cui sono stati segnati: il contenuto a cui si riferiscono di solito è nei 30-60 secondi precedenti.');
  L.push("6. Poi produci: (a) trascrizione con i nomi; (b) sintesi; (c) decisioni prese; (d) azioni da fare con responsabile e scadenza, se dette; (e) punti aperti; (f) per ogni momento importante, che cosa è stato detto.");
  if (multi) L.push(`7. L'audio è diviso in ${files.length} file: per ognuno trovi più sotto una timeline con i tempi relativi all'inizio di quel file.`);
  L.push('');

  if (hasText) {
    L.push('## Trascrizione automatica (approssimativa)', '');
    L.push('_Riconoscimento vocale del telefono in tempo reale; ogni blocco è un intervento, attribuito secondo i tocchi sui nomi._', '');
    for (const s of model.segments) {
      if (!s.speaker && !s.text) continue;
      const missing = s.audio_part === null ? '_(audio non registrato)_' : '_(nessun testo riconosciuto)_';
      L.push(`**[${s.start}] ${mdEsc(who(s.speaker))}:** ${s.text ? mdEsc(s.text) : missing}`, '');
    }
  }

  if (!multi) {
    L.push('## Timeline degli interventi', '');
    L.push("Tempi relativi all'inizio del file audio (hh:mm:ss).", '');
    L.push(...segmentTable(model.segments));
    L.push('');
  } else {
    L.push('## Timeline degli interventi (tempo della riunione)', '');
    L.push(...segmentTable(model.segments, 0, true));
    L.push('');
    for (const f of files) {
      L.push(`### File audio ${f.part}: ${f.file ? `\`${f.file}\`` : '_(eliminato)_'}`, '');
      L.push(`Questo file inizia a ${f.start} della riunione. Tempi qui sotto relativi all'inizio del file.`, '');
      L.push(...segmentTable(model.segments.filter((s) => s.audio_part === f.part), f.start_seconds));
      L.push('');
    }
  }

  const pointLine = (p, prefix) => {
    const rel = multi && p.audio_part ? ` (file ${p.audio_part}: ${fmtTime(p.time_seconds - files.find((f) => f.part === p.audio_part).start_seconds)})` : '';
    return `- **${p.time}**${rel} — ${prefix}${mdEsc(p.text) || '_(senza testo)_'} · parlava: ${mdEsc(who(p.speaker))}`;
  };
  L.push('## Momenti importanti', '');
  if (model.highlights.length) model.highlights.forEach((h) => L.push(pointLine(h, '⭐ ')));
  else L.push('_Nessuno._');
  L.push('');

  L.push('## Note prese durante la riunione', '');
  if (model.notes.length) model.notes.forEach((n) => L.push(pointLine(n, '')));
  else L.push('_Nessuna._');
  L.push('');

  L.push('## Tempo di parola', '');
  L.push('| Partecipante | Tempo | % | Interventi |', '|---|---:|---:|---:|');
  for (const t of model.talk) L.push(`| ${mdEsc(t.name)} | ${fmtClock(t.seconds)} | ${Math.round(t.percent)}% | ${t.turns} |`);
  L.push('');

  L.push('## Qualità della registrazione', '');
  if (model.warnings.length) model.warnings.forEach((w) => L.push(`- ${w}`));
  else L.push('- Nessuna interruzione rilevata: audio e timeline sono allineati.');
  for (const c of m.corrections ?? []) L.push(`- Correzione applicata: ${c.text}`);
  L.push('');
  L.push(`_Generato il ${fmtDateTime(model.generatedAt)} con ChiParla${model.version ? ` ${model.version}` : ''}._`);
  return `${L.join('\n')}\n`;
}
