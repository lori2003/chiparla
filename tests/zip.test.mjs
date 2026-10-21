// Archivio ZIP del backup: CRC, scrittura e rilettura
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, crc32Blob, makeZip, readZip } from '../js/zip.js';

test('crc32: valore di riferimento', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('crc32Blob a finestre = crc32 in un colpo', async () => {
  const u8 = new Uint8Array(300000).map((_, i) => (i * 31) & 255);
  assert.equal(await crc32Blob(new Blob([u8]), { windowSize: 4096 }), crc32(u8));
});

test('makeZip → readZip: nomi, dimensioni, CRC e contenuto', async () => {
  const audio = new Uint8Array(100000).map((_, i) => i & 255);
  const zip = await makeZip([
    { name: 'dati.json', data: '{"a":1}' },
    { name: 'audio/riunione è.m4a', data: new Blob([audio]) },
  ]);
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['dati.json', 'audio/riunione è.m4a']);
  assert.equal(await entries[0].blob.text(), '{"a":1}');
  assert.equal(entries[1].size, audio.length);
  assert.equal(entries[1].crc, crc32(audio));
  assert.deepEqual(new Uint8Array(await entries[1].blob.arrayBuffer()), audio);
});

test('readZip rifiuta file troncati o non ZIP', async () => {
  const zip = await makeZip([{ name: 'x.txt', data: 'ciao' }]);
  await assert.rejects(readZip(zip.slice(0, zip.size - 10)));
  await assert.rejects(readZip(new Blob(['non sono uno zip'])));
});
