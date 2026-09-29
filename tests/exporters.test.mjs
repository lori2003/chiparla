import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModel, toJSON, toCSV, toTXT, toMarkdown, fileBase, audioFileName, csvCell,
} from '../js/exporters.js';

const participants = [
  { id: 'marco', name: 'Marco', color: '#E53935' },
  { id: 'giulia', name: 'Giulia', color: '#1E88E5' },
  { id: 'luca', name: 'Luca', color: '#43A047' },
];
const sp = (t, speakerId) => ({ id: `${speakerId}@${t}`, meetingId: 'r1', type: 'speaker', t, speakerId, createdAt: t });

const meeting = {
  id: 'r1',
  title: 'Comitato di settembre',
  startedAt: new Date(2026, 8, 28, 10, 30).getTime(),
  endSec: 400,
  participants,
  parts: [{ n: 1, startSec: 0, endSec: 400, mimeType: 'audio/mp4', ext: 'm4a', status: 'done', audioDurSec: 399.6, audioCheckedAt: 1 }],
};
const events = [
  sp(0, 'marco'), sp(102, 'giulia'), sp(195, 'luca'), sp(307, 'marco'),
  { id: 'n1', meetingId: 'r1', type: 'note', t: 95, text: 'Budget: decidere "entro" venerdì, poi Luca' },
  { id: 'm1', meetingId: 'r1', type: 'mark', t: 120.4, text: '' },
  { id: 's1', meetingId: 'r1', type: 'sys', kind: 'start', t: 0, text: 'Inizio registrazione' },
];

test('JSON: "segments" nel formato richiesto', () => {
  const obj = JSON.parse(toJSON(buildModel(meeting, events, { version: '1.0.0' })));
  assert.deepEqual(obj.segments, [
    { speaker: 'Marco', start_seconds: 0, end_seconds: 102, start: '00:00:00', end: '00:01:42', audio_part: 1, text: '' },
    { speaker: 'Giulia', start_seconds: 102, end_seconds: 195, start: '00:01:42', end: '00:03:15', audio_part: 1, text: '' },
    { speaker: 'Luca', start_seconds: 195, end_seconds: 307, start: '00:03:15', end: '00:05:07', audio_part: 1, text: '' },
    { speaker: 'Marco', start_seconds: 307, end_seconds: 400, start: '00:05:07', end: '00:06:40', audio_part: 1, text: '' },
  ]);
  assert.deepEqual(obj.transcript, []);
  assert.equal(obj.transcript_source, null);
  assert.equal(obj.meeting.duration, '00:06:40');
  assert.equal(obj.notes[0].speaker, 'Marco');
  assert.equal(obj.highlights[0].speaker, 'Giulia');
  assert.equal(obj.audio_files[0].file, '2026-09-28_1030_comitato-di-settembre_audio.m4a');
  assert.deepEqual(obj.warnings, []);
});

test('CSV: BOM, intestazione, righe ordinate e testo con virgole/virgolette protetto', () => {
  const csv = toCSV(buildModel(meeting, events));
  assert.ok(csv.startsWith('﻿type,speaker,start,end,start_seconds,end_seconds,duration_seconds,audio_part,text\r\n'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[1], 'segment,Marco,00:00:00,00:01:42,0,102,102,1,');
  assert.equal(lines[2], 'note,Marco,00:01:35,,95,,,1,"Budget: decidere ""entro"" venerdì, poi Luca"');
  assert.equal(lines[4], 'highlight,Giulia,00:02:00,,120.4,,,1,');
  assert.equal(lines.length, 1 + 4 + 2);
  assert.equal(csvCell(' spazio'), '" spazio"');
});

test('TXT: tocchi e interventi come nell\'esempio', () => {
  const txt = toTXT(buildModel(meeting, events));
  assert.match(txt, /00:00:00 — Marco\n00:01:42 — Giulia\n00:03:15 — Luca\n00:05:07 — Marco/);
  assert.match(txt, /00:00:00 → 00:01:42 \| Marco\n00:01:42 → 00:03:15 \| Giulia/);
  assert.match(txt, /00:05:07 → 00:06:40 \| Marco/);
});

test('Markdown per AI: istruzioni, tabella, note, tempo di parola', () => {
  const md = toMarkdown(buildModel(meeting, events, { version: '1.0.0' }));
  assert.match(md, /^# Riunione: Comitato di settembre/);
  assert.match(md, /## Istruzioni per l'AI/);
  assert.match(md, /\| 1 \| 00:00:00 \| 00:01:42 \| 1:42 \| Marco \|/);
  assert.match(md, /\| 4 \| 00:05:07 \| 00:06:40 \| 1:33 \| Marco \|/);
  assert.match(md, /- \*\*00:01:35\*\* — Budget: decidere "entro" venerdì, poi Luca · parlava: Marco/);
  assert.match(md, /\| Marco \| 3:15 \| 49% \| 2 \|/);
  assert.match(md, /Nessuna interruzione rilevata/);
});

test('più file audio: timeline per file con tempi relativi e avvisi sul buco', () => {
  const m2 = {
    ...meeting,
    endSec: 200,
    parts: [
      { n: 1, startSec: 0, endSec: 100, mimeType: 'audio/mp4', ext: 'm4a', status: 'recovered' },
      { n: 2, startSec: 130, endSec: 200, mimeType: 'audio/mp4', ext: 'm4a', status: 'done' },
    ],
  };
  const ev2 = [sp(0, 'marco'), sp(50, 'giulia'), sp(150, 'luca'), { id: 'h', type: 'sys', kind: 'hidden', t: 95 }, { id: 'v', type: 'sys', kind: 'visible', t: 128 }];
  const model = buildModel(m2, ev2);
  const md = toMarkdown(model);
  assert.match(md, /### File audio 2: `2026-09-28_1030_comitato-di-settembre_audio-parte2\.m4a`/);
  assert.match(md, /Questo file inizia a 00:02:10 della riunione/);
  // nel file 2 Giulia parla dall'inizio del file fino a 00:00:20, poi Luca
  assert.match(md, /\| 1 \| 00:00:00 \| 00:00:20 \| 0:20 \| Giulia \|\n\| 2 \| 00:00:20 \| 00:01:10 \| 0:50 \| Luca \|/);
  assert.match(md, /Giulia _\(audio non registrato\)_/);
  assert.ok(model.warnings.some((w) => w.startsWith('Audio non registrato da 00:01:40 a 00:02:10')));
  assert.ok(model.warnings.some((w) => w.includes('recuperato dopo una chiusura improvvisa')));
  assert.ok(model.warnings.some((w) => w.startsWith('App non visibile da 00:01:35')));
  assert.equal(audioFileName(m2, m2.parts[0]), '2026-09-28_1030_comitato-di-settembre_audio-parte1.m4a');
});

test('trascrizione in diretta: testo attribuito a chi parlava, in JSON, CSV, TXT e Markdown', () => {
  const speech = (t, end, text) => ({ id: `s@${t}`, meetingId: 'r1', type: 'speech', t, end, text, createdAt: t });
  const withText = [
    ...events,
    speech(1.5, 6, 'Buongiorno a tutti, iniziamo.'),
    speech(40, 47, 'Primo punto: il bilancio.'),
    // a cavallo del cambio Marco→Giulia (102): metà frase a 103 → Giulia
    speech(99.5, 106.5, 'Grazie Marco, allora vediamo'),
    speech(200, 204, 'Io "non" sono d\'accordo, però'),
  ];
  const model = buildModel(meeting, withText);
  assert.deepEqual(model.transcript.map((x) => [x.speaker, x.start, x.text]), [
    ['Marco', '00:00:01', 'Buongiorno a tutti, iniziamo.'],
    ['Marco', '00:00:40', 'Primo punto: il bilancio.'],
    ['Giulia', '00:01:39', 'Grazie Marco, allora vediamo'],
    ['Luca', '00:03:20', 'Io "non" sono d\'accordo, però'],
  ]);
  assert.deepEqual(model.segments.map((s) => s.text), [
    'Buongiorno a tutti, iniziamo. Primo punto: il bilancio.', 'Grazie Marco, allora vediamo', 'Io "non" sono d\'accordo, però', '',
  ]);

  const obj = JSON.parse(toJSON(model));
  assert.equal(obj.transcript.length, 4);
  assert.match(obj.transcript_source, /approssimativo/);

  const csv = toCSV(model).trim().split('\r\n');
  assert.equal(csv[1], 'segment,Marco,00:00:00,00:01:42,0,102,102,1,"Buongiorno a tutti, iniziamo. Primo punto: il bilancio."');
  assert.ok(csv.includes('segment,Luca,00:03:15,00:05:07,195,307,112,1,"Io ""non"" sono d\'accordo, però"'));

  const txt = toTXT(model);
  assert.match(txt, /00:01:42 → 00:03:15 \| Giulia\n {4}Grazie Marco, allora vediamo/);

  const md = toMarkdown(model);
  assert.match(md, /## Trascrizione automatica \(approssimativa\)/);
  assert.match(md, /\*\*\[00:00:00\] Marco:\*\* Buongiorno a tutti, iniziamo\. Primo punto: il bilancio\./);
  assert.match(md, /\*\*\[00:05:07\] Marco:\*\* _\(nessun testo riconosciuto\)_/);
  assert.match(md, /trascrizione automatica fatta in diretta/);
  // senza trascrizione il documento resta come prima
  assert.doesNotMatch(toMarkdown(buildModel(meeting, events)), /Trascrizione automatica/);
});

test('solo timeline (audio con un\'altra app): nessun file audio, avviso finché non si allinea', () => {
  const ext = { ...meeting, externalAudio: true, parts: [] };
  const model = buildModel(ext, events);
  assert.deepEqual(model.segments.map((s) => s.audio_part), [1, 1, 1, 1]);
  assert.equal(model.audioFiles[0].file, null);
  assert.equal(model.audioFiles[0].external, true);
  assert.ok(model.warnings.some((w) => w.includes('non ancora allineati')));
  const md = toMarkdown(model);
  assert.match(md, /registrato con un'altra app/);
  assert.doesNotMatch(md, /audio non registrato/);
  const aligned = buildModel({ ...ext, externalOffset: 7 }, events);
  assert.ok(!aligned.warnings.some((w) => w.includes('non ancora allineati')));
  assert.match(toMarkdown(aligned), /già allineati/);
  assert.match(toTXT(model), /Audio: registrato con un'altra app/);
});

test('nome base dei file', () => {
  assert.equal(fileBase({ title: 'Àrea / Test!!', startedAt: new Date(2026, 0, 5, 9, 7).getTime() }), '2026-01-05_0907_area-test');
  assert.equal(fileBase({ title: '???', createdAt: new Date(2026, 0, 5, 9, 7).getTime() }), '2026-01-05_0907_riunione');
});
