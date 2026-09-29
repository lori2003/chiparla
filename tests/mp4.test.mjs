// Test del lettore MP4 su file costruiti a mano con la stessa struttura prodotta da Safari
// (ftyp + moov di inizializzazione, poi coppie moof + mdat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMp4Blob, detectContainer } from '../js/mp4.js';

const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const box = (type, ...parts) => {
  const payload = concat(parts);
  return concat([u32(8 + payload.length), ascii(type), payload]);
};
const fullbox = (type, version, flags, ...parts) => box(type, u32((version << 24) | flags), ...parts);

const TS = 48000;
const FRAME = 1024;

function initSegment() {
  const ftyp = box('ftyp', ascii('iso5'), u32(512), ascii('iso5'), ascii('iso6'), ascii('mp41'));
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), new Uint8Array(80));
  const tkhd = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(0), new Uint8Array(60));
  const mdhd = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(0), u32(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), ascii('soun'), new Uint8Array(12), new Uint8Array([0]));
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr));
  const mvex = box('mvex', fullbox('trex', 0, 0, u32(1), u32(1), u32(FRAME), u32(0), u32(0)));
  return concat([ftyp, box('moov', mvhd, trak, mvex)]);
}

function fragment(seq, baseTime, samples, perSampleDuration = false) {
  const tfhd = fullbox('tfhd', 0, 0x020000, u32(1)); // default-base-is-moof, durata da trex
  const tfdt = fullbox('tfdt', 1, 0, u64(baseTime));
  const entries = [];
  for (let i = 0; i < samples; i++) {
    if (perSampleDuration) entries.push(u32(FRAME));
    entries.push(u32(10));
  }
  const trun = fullbox('trun', 0, 0x001 | 0x200 | (perSampleDuration ? 0x100 : 0), u32(samples), u32(0), ...entries);
  const moof = box('moof', fullbox('mfhd', 0, 0, u32(seq)), box('traf', tfhd, tfdt, trun));
  return concat([moof, box('mdat', new Uint8Array(samples * 10))]);
}

// n frammenti da 47 campioni (~1,003 s ciascuno); gapAfter: indice dopo cui saltano 5 s
function recording(n, { gapAfter = -1, perSampleDuration = false } = {}) {
  const parts = [initSegment()];
  let base = 0;
  for (let i = 0; i < n; i++) {
    parts.push(fragment(i + 1, base, 47, perSampleDuration));
    base += 47 * FRAME;
    if (i === gapAfter) base += 5 * TS;
  }
  return concat(parts);
}

const fragSec = (47 * FRAME) / TS;

test('fMP4 continuo: durata = somma dei campioni, nessun salto', async () => {
  const r = await analyzeMp4Blob(new Blob([recording(10)]));
  assert.equal(r.kind, 'fmp4');
  assert.equal(r.fragments, 10);
  assert.ok(Math.abs(r.durationSec - 10 * fragSec) < 1e-9);
  assert.ok(Math.abs(r.spanSec - r.durationSec) < 1e-9);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.recoverable, true);
});

test('fMP4 con durate per campione e con un salto di 5 s nei timestamp', async () => {
  const r = await analyzeMp4Blob(new Blob([recording(10, { gapAfter: 4, perSampleDuration: true })]));
  assert.ok(Math.abs(r.durationSec - 10 * fragSec) < 1e-9);
  assert.ok(Math.abs(r.spanSec - (10 * fragSec + 5)) < 1e-9);
  assert.equal(r.gaps.length, 1);
  assert.ok(Math.abs(r.gaps[0].atSec - 5 * fragSec) < 1e-9);
  assert.ok(Math.abs(r.gaps[0].durSec - 5) < 1e-9);
});

test('file troncato (chiusura improvvisa): conta i frammenti completi', async () => {
  const full = recording(6);
  const r = await analyzeMp4Blob(new Blob([full.slice(0, full.length - 200)]));
  assert.equal(r.truncated, true);
  assert.equal(r.fragments, 5);
  assert.ok(Math.abs(r.durationSec - 5 * fragSec) < 1e-9);
});

test('finestre di lettura: funziona anche con file più grandi della finestra', async () => {
  const r = await analyzeMp4Blob(new Blob([recording(900)]));
  assert.equal(r.fragments, 900);
  assert.ok(Math.abs(r.durationSec - 900 * fragSec) < 1e-6);
});

test('riconoscimento del contenitore dal primo pezzo', async () => {
  const first = await detectContainer(new Blob([initSegment()]));
  assert.deepEqual([first.kind, first.recoverable], ['fmp4', true]);
  const classic = await detectContainer(new Blob([concat([box('ftyp', ascii('M4A '), u32(0)), box('mdat', new Uint8Array(64))])]));
  assert.deepEqual([classic.kind, classic.recoverable], ['mp4', false]);
  const webm = await detectContainer(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0])]));
  assert.equal(webm.kind, 'webm');
});

test('MP4 classico interrotto (manca moov): non recuperabile', async () => {
  const r = await analyzeMp4Blob(new Blob([concat([box('ftyp', ascii('M4A '), u32(0)), box('mdat', new Uint8Array(64))])]));
  assert.equal(r.kind, 'mp4-incompleto');
  assert.equal(r.recoverable, false);
  assert.equal(r.durationSec, null);
});
