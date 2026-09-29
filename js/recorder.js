// Accesso al microfono e registrazione di una "parte" (un file audio) con MediaRecorder.

// Ordine di preferenza: MP4/AAC (.m4a) è il formato nativo di Safari e il più compatibile
// con lettori e servizi di trascrizione; WebM/Opus è il ripiego per Chrome/Firefox.
export const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

export function supportedMimeTypes() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return [];
  return MIME_CANDIDATES.filter((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
}

// null = MediaRecorder assente; '' = lascia decidere al browser
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return supportedMimeTypes()[0] ?? '';
}

export function audioConstraints(processing) {
  // Elaborazione spenta: niente cancellazione eco/riduzione rumore pensate per le chiamate,
  // che tendono ad abbassare e "tagliare" le voci lontane dal telefono.
  return {
    audio: {
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
      channelCount: 1,
    },
  };
}

// Microfono finto per provare l'app sul computer: aggiungere ?fakemic all'indirizzo
function fakeMicStream() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const osc = ctx.createOscillator();
  osc.frequency.value = 220;
  const gain = ctx.createGain();
  gain.gain.value = 0.1;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.09;
  lfo.connect(lfoGain).connect(gain.gain);
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  lfo.start();
  ctx.resume();
  const stream = dest.stream;
  stream.getAudioTracks()[0].addEventListener('ended', () => ctx.close());
  return stream;
}

export async function getMicStream(processing) {
  if (new URLSearchParams(location.search).has('fakemic')) return fakeMicStream();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Questo browser non permette di usare il microfono (serve Safari su iOS 14.5+ e una pagina https).');
  }
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints(processing));
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
      throw new Error('Permesso microfono negato. Su iPhone: tocca «aA» nella barra di Safari → Impostazioni sito web → Microfono → Consenti (oppure Impostazioni → App → Safari → Microfono).');
    }
    if (e?.name === 'NotFoundError') throw new Error('Nessun microfono trovato.');
    if (e?.name === 'NotReadableError') throw new Error('Il microfono è occupato da un\'altra app (chiamata, registratore, Siri?). Chiudila e riprova.');
    throw e;
  }
}

/**
 * Registra una parte. I pezzi (chunk) arrivano ogni `timesliceMs` e vengono passati a `onChunk`,
 * che li salva subito: se Safari si chiude, si perdono al massimo gli ultimi secondi.
 */
export class PartRecorder {
  constructor({ stream, mimeType, bitrate, timesliceMs, onChunk, onError, onStop }) {
    Object.assign(this, { stream, requestedMime: mimeType, bitrate, timesliceMs, onChunk, onError, onStop });
    this.rec = null;
    this.expectedStop = false;
    this.stopped = false;
    this.startedAtMs = null;
  }

  get mimeType() { return this.rec?.mimeType || this.requestedMime || ''; }

  get state() { return this.rec?.state ?? 'inactive'; }

  // Risolve con l'istante (Date.now) in cui la registrazione è davvero partita
  start() {
    return new Promise((resolve, reject) => {
      const opts = {};
      if (this.requestedMime) opts.mimeType = this.requestedMime;
      if (this.bitrate) opts.audioBitsPerSecond = this.bitrate;
      let rec;
      try {
        rec = new MediaRecorder(this.stream, opts);
      } catch {
        try { rec = new MediaRecorder(this.stream); } catch (e) { reject(e); return; }
      }
      this.rec = rec;
      let started = false;
      const markStarted = () => {
        if (started) return;
        started = true;
        this.startedAtMs = Date.now();
        resolve(this.startedAtMs);
      };
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.onChunk?.(e.data); };
      rec.onerror = (e) => this.onError?.(e.error || e);
      rec.onstart = markStarted;
      rec.onstop = () => {
        this.stopped = true;
        this._resolveStop?.();
        this.onStop?.(this);
      };
      try {
        if (this.timesliceMs) rec.start(this.timesliceMs); else rec.start();
      } catch (e) {
        reject(e);
        return;
      }
      // Alcune versioni di Safari non emettono "start" in modo affidabile
      setTimeout(() => { if (rec.state === 'recording') markStarted(); }, 1500);
      setTimeout(() => { if (!started) reject(new Error('Il registratore non è partito')); }, 6000);
    });
  }

  // Ferma e attende l'ultimo pezzo. Timeout: su iOS "stop" a volte non arriva.
  stop(timeoutMs = 5000) {
    this.expectedStop = true;
    if (!this.rec || this.rec.state === 'inactive' || this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      this._resolveStop = resolve;
      try { this.rec.stop(); } catch { resolve(); }
      setTimeout(resolve, timeoutMs);
    });
  }
}
