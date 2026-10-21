// Archivio ZIP minimo, senza compressione ("stored"): serve per il backup completo di una riunione.
// I dati audio non vengono copiati in memoria: il file finale è un Blob composto dai Blob originali
// più le intestazioni. Si legge solo per calcolare il CRC, a finestre da 1 MB.
// Nessun accesso al DOM: funziona anche in Node per i test.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// CRC-32 incrementale: crc32(dati) oppure crc32(altri, crcPrecedente)
export function crc32(u8, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function crc32Blob(blob, { windowSize = 1 << 20, onProgress } = {}) {
  let crc = 0;
  for (let off = 0; off < blob.size; off += windowSize) {
    crc = crc32(new Uint8Array(await blob.slice(off, off + windowSize).arrayBuffer()), crc);
    onProgress?.(Math.min(blob.size, off + windowSize));
  }
  return crc;
}

const enc = new TextEncoder();

function dosDateTime(ms) {
  const d = new Date(ms);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX32 = 0xffffffff;

/**
 * entries: [{ name, data: Blob | string, crc? }]
 * onProgress(frazione 0..1) mentre calcola i CRC.
 * Restituisce un Blob application/zip.
 */
export async function makeZip(entries, { date = Date.now(), onProgress } = {}) {
  const files = entries.map((e) => ({
    name: enc.encode(e.name),
    blob: e.data instanceof Blob ? e.data : new Blob([e.data]),
    crc: e.crc, // facoltativo: CRC già calcolato
  }));
  const total = files.reduce((acc, f) => acc + f.blob.size, 0) || 1;
  const { time, date: ddate } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  let done = 0;
  for (const f of files) {
    const crc = f.crc ?? await crc32Blob(f.blob, { onProgress: (n) => onProgress?.((done + n) / total) });
    done += f.blob.size;
    const size = f.blob.size;
    if (size >= MAX32 || offset >= MAX32) throw new Error('Backup troppo grande (oltre 4 GB).');
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomi in UTF-8
    local.setUint16(8, 0, true); // nessuna compressione
    local.setUint16(10, time, true);
    local.setUint16(12, ddate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, f.name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, f.name, f.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, ddate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, f.name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, f.name);
    offset += 30 + f.name.length + size;
  }
  const cdSize = central.reduce((acc, p) => acc + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * Legge l'indice di uno ZIP senza caricarlo in memoria.
 * Restituisce [{ name, size, crc, blob }] dove blob è la porzione del file con il contenuto.
 * Solo file non compressi (come quelli creati da makeZip).
 */
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Non è un file ZIP valido (indice finale mancante).');
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOff = tv.getUint32(eocd + 16, true);
  if (cdOff + cdSize > blob.size) throw new Error('File ZIP incompleto o danneggiato.');
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Indice dello ZIP danneggiato.');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // cartella
    if (method !== 0) {
      throw new Error(`«${name}» è compresso: usa il file di backup originale creato da ChiParla, senza ricomprimerlo.`);
    }
    const lh = new DataView(await blob.slice(localOff, localOff + 30).arrayBuffer());
    if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw new Error(`Intestazione di «${name}» danneggiata.`);
    const start = localOff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + csize > blob.size) throw new Error(`«${name}» è incompleto: il file di backup è troncato.`);
    out.push({ name, size: usize, crc, blob: blob.slice(start, start + csize) });
  }
  return out;
}
