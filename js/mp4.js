// Lettura minima dei file MP4 / MP4 frammentato (fMP4) prodotti da MediaRecorder su Safari.
// Serve a: 1) capire se il formato è recuperabile dopo una chiusura improvvisa;
//          2) misurare la durata reale dell'audio senza dipendere dal lettore del browser;
//          3) trovare eventuali salti nei timestamp (tratti senza audio).
// Nessun accesso al DOM: usa solo Blob / ArrayBuffer (funziona anche in Node per i test).

const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

// Scorre i box contenuti in u8[start, end)
export function* iterBoxes(u8, start = 0, end = u8.length) {
  const dv = view(u8);
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = fourcc(u8, off + 4);
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(dv.getBigUint64(off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < hdr) return;
    const boxEnd = off + size;
    yield { type, start: off, body: off + hdr, end: Math.min(boxEnd, end), complete: boxEnd <= end };
    if (boxEnd > end) return;
    off = boxEnd;
  }
}

// Informazioni dal box moov: tracce (id, timescale, durata, tipo) e durate di default (trex)
export function parseMoov(u8) {
  const dv = view(u8);
  const info = { tracks: [], trex: new Map(), mvhd: null };
  const moov = iterBoxes(u8).next().value;
  if (!moov || moov.type !== 'moov') return info;
  for (const b of iterBoxes(u8, moov.body, moov.end)) {
    if (b.type === 'mvhd') {
      const v = u8[b.body];
      info.mvhd = {
        timescale: dv.getUint32(b.body + (v === 1 ? 20 : 12)),
        duration: v === 1 ? Number(dv.getBigUint64(b.body + 24)) : dv.getUint32(b.body + 16),
      };
    } else if (b.type === 'trak') {
      const t = { id: null, timescale: null, duration: null, handler: null };
      for (const c of iterBoxes(u8, b.body, b.end)) {
        if (c.type === 'tkhd') {
          t.id = dv.getUint32(c.body + (u8[c.body] === 1 ? 20 : 12));
        } else if (c.type === 'mdia') {
          for (const d of iterBoxes(u8, c.body, c.end)) {
            if (d.type === 'mdhd') {
              const v = u8[d.body];
              t.timescale = dv.getUint32(d.body + (v === 1 ? 20 : 12));
              t.duration = v === 1 ? Number(dv.getBigUint64(d.body + 24)) : dv.getUint32(d.body + 16);
            } else if (d.type === 'hdlr') {
              t.handler = fourcc(u8, d.body + 8);
            }
          }
        }
      }
      info.tracks.push(t);
    } else if (b.type === 'mvex') {
      for (const c of iterBoxes(u8, b.body, b.end)) {
        if (c.type === 'trex') info.trex.set(dv.getUint32(c.body + 4), dv.getUint32(c.body + 12));
      }
    }
  }
  return info;
}

// Frammenti di un box moof: [{ trackId, base (tfdt), duration, samples }]
export function parseMoof(u8, init) {
  const dv = view(u8);
  const out = [];
  const moof = iterBoxes(u8).next().value;
  if (!moof || moof.type !== 'moof') return out;
  for (const b of iterBoxes(u8, moof.body, moof.end)) {
    if (b.type !== 'traf') continue;
    let trackId = null;
    let defDur = null;
    let base = null;
    let duration = 0;
    let samples = 0;
    for (const c of iterBoxes(u8, b.body, b.end)) {
      if (c.type === 'tfhd') {
        const flags = dv.getUint32(c.body) & 0xffffff;
        let p = c.body + 4;
        trackId = dv.getUint32(p); p += 4;
        if (flags & 0x01) p += 8; // base-data-offset
        if (flags & 0x02) p += 4; // sample-description-index
        if (flags & 0x08) defDur = dv.getUint32(p); // default-sample-duration
      } else if (c.type === 'tfdt') {
        base = u8[c.body] === 1 ? Number(dv.getBigUint64(c.body + 4)) : dv.getUint32(c.body + 4);
      } else if (c.type === 'trun') {
        const flags = dv.getUint32(c.body) & 0xffffff;
        const n = dv.getUint32(c.body + 4);
        let p = c.body + 8;
        if (flags & 0x01) p += 4; // data-offset
        if (flags & 0x04) p += 4; // first-sample-flags
        const fallback = defDur ?? init?.trex?.get(trackId) ?? 0;
        for (let i = 0; i < n; i++) {
          let d = fallback;
          if (flags & 0x100) { d = dv.getUint32(p); p += 4; }
          if (flags & 0x200) p += 4;
          if (flags & 0x400) p += 4;
          if (flags & 0x800) p += 4;
          duration += d;
        }
        samples += n;
      }
    }
    out.push({ trackId, base, duration, samples });
  }
  return out;
}

const pickAudioTrack = (init) => init?.tracks.find((t) => t.handler === 'soun') ?? init?.tracks[0] ?? null;

// Legge un Blob a finestre (evita migliaia di letture piccole su file lunghi)
function makeReader(blob, windowSize = 1 << 19) {
  let wStart = 0;
  let wBuf = new Uint8Array(0);
  return async (off, len) => {
    const end = Math.min(off + len, blob.size);
    if (off >= wStart && end <= wStart + wBuf.length) return wBuf.subarray(off - wStart, end - wStart);
    const size = Math.max(end - off, windowSize);
    wBuf = new Uint8Array(await blob.slice(off, Math.min(off + size, blob.size)).arrayBuffer());
    wStart = off;
    return wBuf.subarray(0, end - off);
  };
}

/**
 * Riconosce il contenitore dai primi byte (basta il primo pezzo registrato).
 * recoverable: true se i pezzi salvati finora formano un file leggibile anche dopo un crash.
 */
export async function detectContainer(blob) {
  const u8 = new Uint8Array(await blob.slice(0, Math.min(blob.size, 1 << 18)).arrayBuffer());
  if (u8.length < 8) return { kind: 'sconosciuto', recoverable: null, types: [] };
  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) return { kind: 'webm', recoverable: true, types: [] };
  if (fourcc(u8, 0) === 'OggS') return { kind: 'ogg', recoverable: true, types: [] };
  if (fourcc(u8, 0) === 'RIFF') return { kind: 'wav', recoverable: false, types: [] };
  const types = [...iterBoxes(u8)].map((b) => b.type);
  if (types[0] !== 'ftyp') return { kind: 'sconosciuto', recoverable: null, types };
  const moov = types.indexOf('moov');
  const mdat = types.indexOf('mdat');
  if (moov !== -1 && (mdat === -1 || moov < mdat)) return { kind: 'fmp4', recoverable: true, types };
  if (mdat !== -1) return { kind: 'mp4', recoverable: false, types };
  return { kind: 'mp4', recoverable: null, types };
}

/**
 * Analizza un file MP4/fMP4 completo.
 * durationSec: somma delle durate dei campioni audio (contenuto reale)
 * spanSec:     estensione dei timestamp (include eventuali salti)
 * gaps:        salti nei timestamp [{ atSec, durSec }]
 */
export async function analyzeMp4Blob(blob, { onProgress } = {}) {
  const res = {
    kind: 'sconosciuto', topTypes: [], durationSec: null, spanSec: null, gaps: [], fragments: 0, truncated: false, recoverable: null,
  };
  const read = makeReader(blob);
  const size = blob.size;
  let off = 0;
  let init = null;
  let track = null;
  let firstBase = null;
  let prevEnd = null;
  let maxEnd = 0;
  let sum = 0;
  let sawMoov = false;
  let mdatBeforeMoov = false;
  let lastProgress = 0;
  let pending = null; // frammenti di un moof, contati solo quando anche il loro mdat è completo

  const commit = () => {
    if (!pending) return;
    for (const f of pending) {
      if (track.id != null && f.trackId !== track.id) continue;
      const base = f.base ?? prevEnd ?? 0;
      if (firstBase === null) firstBase = base;
      if (prevEnd !== null && base - prevEnd > track.timescale * 0.25) {
        res.gaps.push({ atSec: (prevEnd - firstBase) / track.timescale, durSec: (base - prevEnd) / track.timescale });
      }
      sum += f.duration;
      prevEnd = base + f.duration;
      maxEnd = Math.max(maxEnd, prevEnd);
    }
    res.fragments++;
    pending = null;
  };

  while (off + 8 <= size) {
    const hdr = await read(off, 16);
    const dv = view(hdr);
    let bsize = dv.getUint32(0);
    const type = fourcc(hdr, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) { res.truncated = true; break; }
    if (bsize === 1) {
      if (hdr.length < 16) { res.truncated = true; break; }
      bsize = Number(dv.getBigUint64(8));
    } else if (bsize === 0) {
      bsize = size - off;
    }
    if (bsize < 8) { res.truncated = true; break; }
    if (res.topTypes.length < 16) res.topTypes.push(type);
    const complete = off + bsize <= size;

    if (type === 'moov' && complete) {
      sawMoov = true;
      init = parseMoov(await read(off, bsize));
      track = pickAudioTrack(init);
    } else if (type === 'moof' && complete && track?.timescale) {
      commit();
      pending = parseMoof(await read(off, bsize), init);
    } else if (type === 'mdat') {
      if (!sawMoov) mdatBeforeMoov = true;
      if (complete) commit();
    }

    if (!complete) { res.truncated = true; pending = null; break; }
    off += bsize;
    if (onProgress && off - lastProgress > 4e6) { lastProgress = off; onProgress(off / size); }
  }
  if (!res.truncated) commit();

  if (res.topTypes[0] !== 'ftyp') return res;
  if (res.fragments > 0 && track?.timescale) {
    res.kind = 'fmp4';
    res.recoverable = true;
    res.durationSec = sum / track.timescale;
    res.spanSec = (maxEnd - firstBase) / track.timescale;
  } else if (sawMoov && track) {
    res.kind = 'mp4';
    res.recoverable = !mdatBeforeMoov;
    if (track.duration && track.timescale) res.durationSec = track.duration / track.timescale;
    else if (init.mvhd?.duration && init.mvhd.timescale) res.durationSec = init.mvhd.duration / init.mvhd.timescale;
  } else if (mdatBeforeMoov) {
    res.kind = 'mp4-incompleto'; // manca l'indice finale: tipico di un MP4 classico interrotto
    res.recoverable = false;
  }
  return res;
}
