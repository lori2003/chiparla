import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSegments, talkTime, applyShifts, driftCheck, hiddenIntervals, partGaps, currentSpeakerId, meetingEnd,
} from '../js/timeline.js';
import {
  fmtTime, fmtTimePrecise, fmtClock, parseTime, slugify, splitNames, textColorFor,
} from '../js/util.js';

const sp = (t, speakerId, createdAt = t) => ({ id: `${speakerId}@${t}`, type: 'speaker', t, speakerId, createdAt });
const sys = (t, kind) => ({ id: `${kind}@${t}`, type: 'sys', kind, t, createdAt: t });
const pick = (segs) => segs.map((s) => [s.speakerId, s.start, s.end, s.part]);

test('esempio della richiesta: 4 tocchi → 4 interventi', () => {
  const events = [sp(0, 'marco'), sp(102, 'giulia'), sp(195, 'luca'), sp(307, 'marco')];
  assert.deepEqual(pick(buildSegments(events, { endSec: 400 })), [
    ['marco', 0, 102, 1], ['giulia', 102, 195, 1], ['luca', 195, 307, 1], ['marco', 307, 400, 1],
  ]);
});

test('tocchi ripetuti sulla stessa persona vengono uniti', () => {
  const events = [sp(0, 'a'), sp(10, 'a'), sp(20, 'b'), sp(25, 'b'), sp(30, 'a')];
  assert.deepEqual(pick(buildSegments(events, { endSec: 40 })), [['a', 0, 20, 1], ['b', 20, 30, 1], ['a', 30, 40, 1]]);
});

test('l\'ordine è per tempo, non per ordine di inserimento', () => {
  const events = [sp(50, 'b', 1), sp(0, 'a', 2)];
  assert.deepEqual(pick(buildSegments(events, { endSec: 60 })), [['a', 0, 50, 1], ['b', 50, 60, 1]]);
  assert.equal(currentSpeakerId(events), 'b');
});

test('primo tocco dopo 1,2 s: il tempo di reazione viene assegnato al primo speaker', () => {
  const segs = buildSegments([sp(1.2, 'a'), sp(30, 'b')], { endSec: 60 });
  assert.deepEqual(pick(segs), [['a', 0, 30, 1], ['b', 30, 60, 1]]);
});

test('primo tocco dopo 10 s: il tratto iniziale resta "nessuno indicato"', () => {
  const segs = buildSegments([sp(10, 'a')], { endSec: 60 });
  assert.deepEqual(pick(segs), [[null, 0, 10, 1], ['a', 10, 60, 1]]);
});

test('nessun evento: un unico tratto senza speaker; durata zero: nessun segmento', () => {
  assert.deepEqual(pick(buildSegments([], { endSec: 30 })), [[null, 0, 30, 1]]);
  assert.deepEqual(buildSegments([sp(0, 'a')], { endSec: 0 }), []);
});

test('i segmenti si fermano ai buchi fra i file audio', () => {
  const parts = [{ n: 1, startSec: 0, endSec: 100 }, { n: 2, startSec: 130, endSec: 200 }];
  const segs = buildSegments([sp(0, 'marco'), sp(50, 'giulia'), sp(150, 'luca')], { endSec: 200, parts });
  assert.deepEqual(pick(segs), [
    ['marco', 0, 50, 1], ['giulia', 50, 100, 1], ['giulia', 100, 130, null], ['giulia', 130, 150, 2], ['luca', 150, 200, 2],
  ]);
  assert.deepEqual(partGaps(parts), [{ start: 100, end: 130, dur: 30, afterPart: 1 }]);
});

test('tempo di parola: esclude i tratti senza audio', () => {
  const parts = [{ n: 1, startSec: 0, endSec: 100 }, { n: 2, startSec: 130, endSec: 200 }];
  const segs = buildSegments([sp(0, 'a'), sp(60, 'b')], { endSec: 200, parts });
  const tt = talkTime(segs, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.deepEqual(tt.map((x) => [x.id, x.seconds, x.turns]), [['b', 110, 2], ['a', 60, 1]]);
  assert.equal(Math.round(tt[0].percent + tt[1].percent), 100);
});

test('sposta tempi: solo eventi utente dal punto indicato, senza scendere sotto zero', () => {
  const events = [sp(5, 'a'), sp(20, 'b'), sys(20, 'hidden'), { id: 'n', type: 'note', t: 30, text: 'x' }];
  const changed = applyShifts(events, [{ from: 10, delta: -25 }]);
  assert.deepEqual(changed.map((e) => [e.id, e.t]), [['b@20', 0], ['n', 5]]);
});

test('intervalli in background ricavati dagli eventi di sistema', () => {
  const events = [sys(10, 'hidden'), sys(40, 'visible'), sys(100, 'hidden'), sys(105, 'visible')];
  assert.deepEqual(hiddenIntervals(events), [{ start: 10, end: 40, dur: 30 }, { start: 100, end: 105, dur: 5 }]);
});

test('verifica allineamento: ok, audio più corto con correzione proposta, salti nel file', () => {
  const events = [sys(60, 'hidden'), sys(100, 'visible')];
  assert.equal(driftCheck({ startSec: 0, endSec: 300, audioDurSec: 299.2 }, events).status, 'ok');
  const short = driftCheck({ startSec: 0, endSec: 300, audioDurSec: 261 }, events);
  assert.equal(short.status, 'shorter');
  assert.deepEqual(short.shifts, [{ from: 100, delta: -40 }]);
  const unexplained = driftCheck({ startSec: 0, endSec: 300, audioDurSec: 200 }, events);
  assert.equal(unexplained.shifts, null);
  assert.equal(driftCheck({ startSec: 0, endSec: 300, audioDurSec: 261, audioSpanSec: 299.5 }, events).status, 'gaps');
  assert.equal(driftCheck({ startSec: 0, endSec: 300, audioDurSec: null }, events).status, 'unknown');
});

test('fine riunione: dichiarata oppure ricavata da parti ed eventi', () => {
  assert.equal(meetingEnd({ endSec: 42 }), 42);
  assert.equal(meetingEnd({ parts: [{ startSec: 0, endSec: 90 }] }, [sp(120, 'a')]), 120);
});

test('formati del tempo', () => {
  assert.equal(fmtTime(0), '00:00:00');
  assert.equal(fmtTime(102.9), '00:01:42');
  assert.equal(fmtTime(3725), '01:02:05');
  assert.equal(fmtTime(-3), '00:00:00');
  assert.equal(fmtTimePrecise(102.46), '00:01:42.4');
  assert.equal(fmtClock(83), '1:23');
  assert.equal(fmtClock(3723), '1:02:03');
  assert.equal(parseTime('1:42'), 102);
  assert.equal(parseTime('01:01:42.5'), 3702.5);
  assert.equal(parseTime('00:01:42,4'), 102.4);
  assert.equal(parseTime('102.5'), 102.5);
  assert.ok(Number.isNaN(parseTime('1:75')));
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.equal(parseTime(fmtTimePrecise(3702.5)), 3702.5);
});

test('nomi file e nomi partecipanti', () => {
  assert.equal(slugify('Riunione Comitato – Città 28/09'), 'riunione-comitato-citta-28-09');
  assert.deepEqual(splitNames(' Marco, Giulia;Luca\n  Anna  Maria '), ['Marco', 'Giulia', 'Luca', 'Anna Maria']);
  assert.equal(textColorFor('#FDD835'), '#111');
  assert.equal(textColorFor('#1E88E5'), '#fff');
});
