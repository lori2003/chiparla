// Controlli sulla PWA: ogni file dell'app deve essere nella cache offline del service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...await listFiles(rel)); else out.push(rel);
  }
  return out;
}

async function swAssets() {
  const src = await readFile(join(root, 'sw.js'), 'utf8');
  const block = src.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('il service worker mette in cache tutti i file js, css e icone', async () => {
  const assets = await swAssets();
  const needed = [...await listFiles('js'), ...await listFiles('css'), ...await listFiles('icons'), 'index.html', 'manifest.webmanifest'];
  for (const f of needed) assert.ok(assets.includes(f), `manca in sw.js: ${f}`);
});

test('ogni file elencato nel service worker esiste', async () => {
  for (const f of await swAssets()) {
    if (f === './') continue;
    await access(join(root, f));
  }
});

test('manifest: icone esistenti, avvio relativo (funziona in una sottocartella di GitHub Pages)', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) await access(join(root, icon.src));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
});
