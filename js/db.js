// Archivio locale su IndexedDB. Tutto resta sul telefono: nessun server.
//
// Store:
//  meetings  { id, title, participants[], parts[], status, startedAt, endSec, ... }
//  events    { id, meetingId, type, t, speakerId?, text?, kind?, createdAt }   indice: meetingId
//  chunks    { meetingId, part, seq, data (Blob o ArrayBuffer), size, at }     chiave: [meetingId, part, seq]

const DB_NAME = 'chiparla';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB non disponibile in questo browser')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meetings')) db.createObjectStore('meetings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      }
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['meetingId', 'part', 'seq'] });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      // Su iOS la connessione può chiudersi da sola dopo il background: alla prossima operazione si riapre
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Archivio bloccato: chiudi le altre schede di ChiParla'));
  });
}

function getDB() {
  if (!dbPromise) dbPromise = open().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

// Errori tipici di Safari quando la connessione è stata persa ("Connection to Indexed Database server lost")
const RETRYABLE = new Set(['InvalidStateError', 'UnknownError', 'TransactionInactiveError']);

// Esegue `fn(tx, done)` in una transazione; `done(valore)` imposta il risultato.
async function run(stores, mode, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      const db = await getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new DOMException('Transazione annullata', 'AbortError'));
        try {
          fn(tx, (v) => { result = v; });
        } catch (e) {
          try { tx.abort(); } catch { /* già chiusa */ }
          reject(e);
        }
      });
    } catch (e) {
      if (attempt === 0 && RETRYABLE.has(e?.name)) { dbPromise = null; continue; }
      throw e;
    }
  }
}

const reqValue = (req, done) => { req.onsuccess = () => done(req.result); };
const meetingRange = (id) => IDBKeyRange.bound([id], [id, []]);
const partRange = (id, part) => IDBKeyRange.bound([id, part], [id, part, []]);

// ---------- riunioni ----------

export const putMeeting = (m) => run(['meetings'], 'readwrite', (tx) => {
  tx.objectStore('meetings').put({ ...m, updatedAt: Date.now() });
});

export const getMeeting = (id) => run(['meetings'], 'readonly', (tx, done) => reqValue(tx.objectStore('meetings').get(id), done));

export const getAllMeetings = () => run(['meetings'], 'readonly', (tx, done) => reqValue(tx.objectStore('meetings').getAll(), done));

export const deleteMeeting = (id) => run(['meetings', 'events', 'chunks'], 'readwrite', (tx) => {
  tx.objectStore('meetings').delete(id);
  tx.objectStore('chunks').delete(meetingRange(id));
  const cur = tx.objectStore('events').index('meetingId').openKeyCursor(IDBKeyRange.only(id));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    tx.objectStore('events').delete(c.primaryKey);
    c.continue();
  };
});

// ---------- eventi ----------

export const putEvent = (e) => run(['events'], 'readwrite', (tx) => { tx.objectStore('events').put(e); });

export const putEvents = (list) => run(['events'], 'readwrite', (tx) => {
  const s = tx.objectStore('events');
  list.forEach((e) => s.put(e));
});

export const deleteEvent = (id) => run(['events'], 'readwrite', (tx) => { tx.objectStore('events').delete(id); });

export const getEvents = (meetingId) => run(['events'], 'readonly', (tx, done) => (
  reqValue(tx.objectStore('events').index('meetingId').getAll(IDBKeyRange.only(meetingId)), done)
));

// ---------- pezzi di audio ----------

function putChunkRaw(chunk, meeting) {
  return run(meeting ? ['chunks', 'meetings'] : ['chunks'], 'readwrite', (tx) => {
    tx.objectStore('chunks').put(chunk);
    if (meeting) tx.objectStore('meetings').put({ ...meeting, updatedAt: Date.now() });
  });
}

// Salva un pezzo di audio (e, nella stessa transazione, lo stato aggiornato della riunione).
// Se il browser non accetta Blob in IndexedDB, riprova come ArrayBuffer.
export async function putChunk(chunk, meeting = null) {
  try {
    await putChunkRaw(chunk, meeting);
  } catch (e) {
    if (!(chunk.data instanceof Blob) || e?.name === 'QuotaExceededError') throw e;
    const data = await chunk.data.arrayBuffer();
    await putChunkRaw({ ...chunk, data, asBuffer: true }, meeting);
  }
}

export const getChunks = (meetingId, part) => run(['chunks'], 'readonly', (tx, done) => (
  reqValue(tx.objectStore('chunks').getAll(partRange(meetingId, part)), done)
));

// Statistiche per parte senza caricare l'audio: Map(part → { count, bytes, lastAt })
export const chunkStats = (meetingId) => run(['chunks'], 'readonly', (tx, done) => {
  const stats = new Map();
  const cur = tx.objectStore('chunks').openCursor(meetingRange(meetingId));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) { done(stats); return; }
    const v = c.value;
    const s = stats.get(v.part) ?? { count: 0, bytes: 0, lastAt: 0 };
    s.count += 1;
    s.bytes += v.size || 0;
    s.lastAt = Math.max(s.lastAt, v.at || 0);
    stats.set(v.part, s);
    c.continue();
  };
});

export const deleteChunks = (meetingId, part = null) => run(['chunks'], 'readwrite', (tx) => {
  tx.objectStore('chunks').delete(part == null ? meetingRange(meetingId) : partRange(meetingId, part));
});

// ---------- spazio ----------

export async function storageInfo() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) Object.assign(out, await navigator.storage.estimate());
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* non supportato */ }
  return out;
}
