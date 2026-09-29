// Sessione di registrazione (una sola alla volta).
//
// Robustezza:
//  - l'audio arriva a pezzi ogni pochi secondi e ogni pezzo viene subito scritto su IndexedDB;
//  - ogni tocco (speaker, nota, momento importante) viene scritto subito;
//  - se iOS chiude il microfono o il registratore si ferma da solo, si apre una nuova "parte"
//    (nuovo file audio) e la timeline segna il buco;
//  - schermo bloccato / app in background vengono registrati come eventi di sistema,
//    così a fine riunione si può verificare e correggere l'allineamento.

import * as db from './db.js';
import { PartRecorder, pickMimeType, getMicStream } from './recorder.js';
import { detectContainer } from './mp4.js';
import { LevelMeter } from './level.js';
import { ScreenWake } from './wakelock.js';
import { getSettings } from './settings.js';
import { isStandalone } from './env.js';
import { uid, extForMime, nextColor } from './util.js';
import { currentSpeakerId } from './timeline.js';

// Pezzi che non è stato possibile scrivere su IndexedDB: restano in memoria fino all'esportazione
const memoryChunks = [];
export const getMemoryChunks = (meetingId, part) => memoryChunks.filter((c) => c.meetingId === meetingId && c.part === part);

const REASONS = {
  start: 'inizio',
  resume: 'ripresa',
  'auto-resume': 'ripresa automatica',
  rotate: 'nuovo file programmato',
  'restart-mic': 'microfono riavviato',
};

class RecordingSession extends EventTarget {
  constructor() {
    super();
    this.wake = new ScreenWake();
    this.wake.onchange = () => this.emit();
    this.onVisibility = this.onVisibility.bind(this);
    this.onDeviceChange = () => { if (this.active) this.addSys('device', 'Dispositivi audio cambiati (es. cuffie o AirPods)'); };
    this.clear();
  }

  clear() {
    clearInterval(this.timer);
    this.timer = null;
    this.meeting = null;
    this.events = [];
    this.stream = null;
    this.rec = null;
    this.part = null;
    this.meter = null;
    this.status = 'idle'; // idle | starting | recording | interrupted | stopping
    this.warnings = new Map(); // chiave → { text, level: 'warn'|'error', action }
    this.saveChain = Promise.resolve();
    this.lastChunkAt = null;
    this.partStartedAtMs = null;
    this.hiddenAt = null;
    this.mutedSince = null;
    this.autoRotateMin = 0;
    this.rotating = false;
    this.resuming = false;
  }

  get active() { return this.status !== 'idle'; }

  get track() { return this.stream?.getAudioTracks()[0] ?? null; }

  get currentSpeakerId() { return currentSpeakerId(this.events); }

  emit() { this.dispatchEvent(new Event('change')); }

  // Tempo riunione (secondi dall'inizio della registrazione) per un istante Date.now()
  elapsed(atMs = Date.now()) {
    return this.meeting?.startedAt ? Math.max(0, (atMs - this.meeting.startedAt) / 1000) : 0;
  }

  setWarning(key, text, level = 'warn', action = null) {
    const prev = this.warnings.get(key);
    if (prev && prev.text === text && prev.action === action) return;
    this.warnings.set(key, { text, level, action });
    this.emit();
  }

  clearWarning(key) { if (this.warnings.delete(key)) this.emit(); }

  // ---------- avvio ----------

  // Da chiamare direttamente nel gestore del tocco "Avvia registrazione" / "Riprendi"
  async start(meeting) {
    if (this.active) throw new Error('C\'è già una registrazione in corso.');
    this.clear();
    this.settings = getSettings();
    this.meeting = meeting;
    this.status = 'starting';
    this.prepareInGesture();
    this.emit();
    try {
      if (this.external) {
        this.events = await db.getEvents(meeting.id);
        await this.startTimelineOnly();
      } else {
        await this.openMic(); // subito, ancora dentro il tocco dell'utente
        this.events = await db.getEvents(meeting.id);
        await this.startPart(meeting.parts?.length ? 'resume' : 'start');
      }
    } catch (e) {
      this.teardown();
      this.clear();
      this.emit();
      throw e;
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    this.timer = setInterval(() => this.watchdog(), 1000);
    return meeting.id;
  }

  // Modalità "solo timeline": l'audio lo registra un'altra app (es. Memo Vocali), qui solo orologio e tocchi
  get external() { return !!this.meeting?.externalAudio; }

  async startTimelineOnly() {
    const m = this.meeting;
    const resumed = !!m.startedAt;
    if (!resumed) m.startedAt = Date.now();
    m.status = 'recording';
    m.settings = { ...this.settings };
    m.device = { userAgent: navigator.userAgent, standalone: isStandalone() };
    this.status = 'recording';
    await db.putMeeting(m);
    await this.addSys(resumed ? 'part-start' : 'start',
      resumed ? 'Ripresa della timeline (audio con un\'altra app)' : 'Inizio timeline (audio registrato con un\'altra app)');
    this.emit();
  }

  // Su iOS audio e blocco schermo vanno attivati durante un tocco dell'utente
  prepareInGesture() {
    if (this.settings.meter && !this.meter && !this.external) this.meter = new LevelMeter();
    this.meter?.resume();
    this.wake.request();
    navigator.storage?.persist?.().then((p) => { this.persisted = p; }).catch(() => {});
  }

  async openMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = await getMicStream(this.settings.processing);
    const track = this.track;
    track.addEventListener('mute', () => { if (track === this.track) this.onTrackMute(true); });
    track.addEventListener('unmute', () => { if (track === this.track) this.onTrackMute(false); });
    track.addEventListener('ended', () => { if (track === this.track) this.onTrackEnded(); });
    this.mutedSince = null;
    this.meter?.attach(this.stream);
  }

  async startPart(reason) {
    const m = this.meeting;
    const mimeType = pickMimeType();
    if (mimeType === null) throw new Error('Questo browser non può registrare audio (MediaRecorder assente): aggiorna iOS.');
    const part = {
      n: Math.max(0, ...(m.parts ?? []).map((p) => p.n)) + 1,
      startSec: null,
      endSec: null,
      mimeType,
      ext: extForMime(mimeType),
      bytes: 0,
      chunks: 0,
      lastChunkAt: null,
      status: 'recording',
      container: null,
      reason,
    };
    let seq = 0;
    const rec = new PartRecorder({
      stream: this.stream,
      mimeType,
      bitrate: this.settings.bitrate,
      timesliceMs: this.settings.timesliceMs,
      onChunk: (blob) => this.saveChunk(part, seq++, blob),
      onError: (err) => this.addSys('error', `Errore del registratore: ${err?.name || err?.message || err}`),
      onStop: (r) => this.onRecorderStopped(r),
    });
    const startedAtMs = await rec.start();
    part.mimeType = rec.mimeType || mimeType;
    part.ext = extForMime(part.mimeType);
    if (!m.startedAt) m.startedAt = startedAtMs;
    part.startSec = this.elapsed(startedAtMs);
    m.parts = [...(m.parts ?? []), part];
    m.status = 'recording';
    m.settings = { ...this.settings };
    m.device = { userAgent: navigator.userAgent, standalone: isStandalone() };
    this.rec = rec;
    this.part = part;
    this.partStartedAtMs = startedAtMs;
    this.lastChunkAt = null;
    this.status = 'recording';
    await db.putMeeting(m);
    await this.addSys(part.n === 1 ? 'start' : 'part-start',
      part.n === 1 ? 'Inizio registrazione' : `Inizio file audio ${part.n} (${REASONS[reason] ?? reason})`);
    this.emit();
    return part;
  }

  // ---------- salvataggio audio ----------

  saveChunk(part, seq, blob) {
    const at = Date.now();
    const m = this.meeting;
    part.bytes += blob.size;
    part.chunks += 1;
    part.lastChunkAt = at;
    if (part === this.part) this.lastChunkAt = at;
    const chunk = { meetingId: m.id, part: part.n, seq, data: blob, size: blob.size, at };
    this.saveChain = this.saveChain.then(async () => {
      try {
        await db.putChunk(chunk, m);
        this.clearWarning('save');
      } catch (e) {
        memoryChunks.push(chunk);
        this.setWarning('save', e?.name === 'QuotaExceededError'
          ? 'Spazio del telefono esaurito: l\'audio resta solo in memoria. Ferma ed esporta appena puoi.'
          : `Salvataggio non riuscito (${e?.name || e}): l'audio resta solo in memoria, non chiudere Safari.`, 'error');
      }
      if (seq === 0) await this.inspectFirstChunk(part, blob);
    });
  }

  async inspectFirstChunk(part, blob) {
    try {
      const info = await detectContainer(blob);
      part.container = info.kind;
      part.recoverable = info.recoverable;
      if (info.recoverable === false && !this.settings.rotateMin && !this.autoRotateMin) {
        // Con questo formato un file interrotto non è leggibile: limitiamo la perdita a 10 minuti
        this.autoRotateMin = 10;
        this.addSys('container', `Formato "${info.kind}" non recuperabile dopo una chiusura improvvisa: l'audio verrà diviso in file da 10 minuti.`);
      }
      this.emit();
    } catch { /* controllo non essenziale */ }
  }

  // ---------- eventi ----------

  async addEvent(type, data = {}, atMs = Date.now()) {
    const m = this.meeting;
    if (!m?.startedAt) return null;
    const ev = { id: uid('e'), meetingId: m.id, type, t: this.elapsed(atMs), createdAt: Date.now(), ...data };
    this.events.push(ev);
    this.emit();
    try {
      await db.putEvent(ev);
      this.clearWarning('events');
    } catch (e) {
      this.setWarning('events', `Impossibile salvare gli ultimi tocchi (${e?.name || e}).`, 'error');
    }
    return ev;
  }

  addSys(kind, text, extra = {}) { return this.addEvent('sys', { kind, text, ...extra }); }

  // Ogni tocco è anche l'occasione per riattivare ciò che iOS sospende senza gesto
  touch() {
    this.meter?.resume();
    if (this.wake.wanted && !this.wake.active) this.wake.request();
  }

  speaker(speakerId, atMs) {
    this.touch();
    if (this.currentSpeakerId === speakerId) return null;
    return this.addEvent('speaker', { speakerId }, atMs);
  }

  note(text, atMs) { return this.addEvent('note', { text }, atMs); }

  mark(atMs) { return this.addEvent('mark', { text: '' }, atMs); }

  async setEventText(ev, text) {
    ev.text = text;
    ev.updatedAt = Date.now();
    this.emit();
    await db.putEvent(ev);
  }

  // Annulla l'ultimo tocco fatto (speaker, nota o momento importante)
  async undo() {
    const mine = this.events.filter((e) => e.type !== 'sys');
    if (!mine.length) return null;
    const last = mine.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    this.events = this.events.filter((e) => e !== last);
    this.emit();
    await db.deleteEvent(last.id);
    return last;
  }

  async addParticipant(name) {
    const m = this.meeting;
    const p = { id: uid('p'), name, color: nextColor(m.participants.map((x) => x.color)) };
    m.participants = [...m.participants, p];
    this.emit();
    await db.putMeeting(m);
    return p;
  }

  // ---------- controllo continuo ----------

  onVisibility() {
    if (!this.active) return;
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      this.addSys('hidden', 'App non visibile (schermo bloccato o altra app)');
      return;
    }
    const dur = this.hiddenAt ? (Date.now() - this.hiddenAt) / 1000 : 0;
    this.hiddenAt = null;
    this.addSys('visible', `App di nuovo visibile dopo ${Math.round(dur)} s`, { dur });
    this.touch();
    if (dur >= 2) {
      this.setWarning('hidden', `L'app è rimasta nascosta per ${Math.round(dur)} s: in quel tratto iOS potrebbe non aver registrato. A fine riunione l'app verificherà l'audio.`, 'warn', 'dismiss');
      setTimeout(() => this.clearWarning('hidden'), 30000);
    }
    setTimeout(() => this.healthCheck(), 1500);
  }

  healthCheck() {
    if (this.status !== 'recording' || this.external) return;
    const track = this.track;
    if (!track || track.readyState === 'ended') this.onTrackEnded();
    else if (this.rec?.state === 'inactive') this.markInterrupted('Il registratore si è fermato.');
  }

  onTrackMute(muted) {
    if (!this.active) return;
    this.addSys(muted ? 'mute' : 'unmute', muted ? 'Microfono sospeso dal sistema' : 'Microfono di nuovo attivo');
    this.mutedSince = muted ? Date.now() : null;
    if (!muted) this.clearWarning('muted');
  }

  onTrackEnded() {
    if (this.status !== 'recording') return;
    this.addSys('ended', 'Il sistema ha chiuso il microfono');
    this.markInterrupted('Il sistema ha chiuso il microfono.');
  }

  onRecorderStopped(rec) {
    if (rec.expectedStop || rec !== this.rec || this.status !== 'recording') return;
    this.addSys('recorder-stop', 'Il registratore si è fermato da solo');
    this.markInterrupted('Il registratore si è fermato.');
  }

  async markInterrupted(reason) {
    if (this.status !== 'recording') return;
    this.status = 'interrupted';
    this.setWarning('interrupted', `${reason} Registrazione ferma: tocca «Riprendi».`, 'error', 'resume');
    const part = this.part;
    await this.saveChain;
    if (part?.status === 'recording') {
      part.endSec = part.lastChunkAt ? this.elapsed(part.lastChunkAt) : this.elapsed();
      part.status = 'interrupted';
      await db.putMeeting(this.meeting);
    }
    this.emit();
    // Tentativo automatico: se iOS lo rifiuta senza un tocco, resta il pulsante «Riprendi»
    if (document.visibilityState === 'visible') this.resume('auto-resume');
  }

  // Riprende in una nuova parte (nuovo file audio). reason 'resume' = tocco dell'utente.
  async resume(reason = 'resume') {
    if (this.resuming || !this.meeting || this.status === 'recording' || this.status === 'stopping') return;
    this.resuming = true;
    if (reason !== 'auto-resume') this.prepareInGesture();
    this.emit();
    try {
      if (!this.track || this.track.readyState !== 'live') await this.openMic();
      await this.startPart(reason);
      this.clearWarning('interrupted');
      this.clearWarning('muted');
      this.clearWarning('nodata');
    } catch (e) {
      this.status = 'interrupted';
      this.setWarning('interrupted', `Registrazione ferma: tocca «Riprendi». (${e?.message || e})`, 'error', 'resume');
    } finally {
      this.resuming = false;
      this.emit();
    }
  }

  // Chiude il file corrente e riparte con un nuovo accesso al microfono
  async restartMic() {
    if (this.status !== 'recording') { await this.resume('resume'); return; }
    this.prepareInGesture();
    this.status = 'interrupted';
    const rec = this.rec;
    const part = this.part;
    await rec?.stop();
    await this.saveChain;
    if (part?.status === 'recording') {
      part.endSec = this.elapsed();
      part.status = 'done';
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await db.putMeeting(this.meeting);
    await this.resume('restart-mic');
  }

  // Nuovo file senza buchi: parte il nuovo registratore, poi si ferma il vecchio
  async rotatePart() {
    if (this.rotating || this.status !== 'recording') return;
    this.rotating = true;
    const oldRec = this.rec;
    const oldPart = this.part;
    try {
      const newPart = await this.startPart('rotate');
      await oldRec.stop();
      await this.saveChain;
      oldPart.endSec = newPart.startSec;
      oldPart.status = 'done';
      await db.putMeeting(this.meeting);
    } catch (e) {
      this.addSys('error', `Divisione del file non riuscita: ${e?.message || e}`);
      this.autoRotateMin = 0;
      this.settings.rotateMin = 0;
    } finally {
      this.rotating = false;
      this.emit();
    }
  }

  watchdog() {
    if (!this.active) return;
    const now = Date.now();
    this.meter?.sample();
    if (this.status === 'recording' && document.visibilityState === 'visible') {
      this.checkScreen();
      if (!this.external) this.checkAudio(now);
    }
    this.dispatchEvent(new Event('tick'));
  }

  checkScreen() {
    if (!this.wake.supported) this.setWarning('wake', 'Questo browser non può tenere acceso lo schermo: imposta Blocco automatico su «Mai».', 'warn', 'dismiss');
    else if (!this.wake.active) this.setWarning('wake', 'Lo schermo potrebbe spegnersi: tocca qui per tenerlo acceso.', 'warn', 'wake');
    else this.clearWarning('wake');
  }

  checkAudio(now) {
    // arrivano i pezzi di audio?
    const ts = this.settings.timesliceMs;
    if (ts) {
      const since = now - (this.lastChunkAt ?? this.partStartedAtMs);
      if (since > ts * 3 + 3000) {
        if (this.lastChunkAt == null) {
          this.setWarning('nodata', 'Questo browser non salva l\'audio a pezzi: verrà salvato solo con Stop. Non chiudere l\'app.', 'warn', 'dismiss');
        } else {
          this.setWarning('nodata', `Nessun audio salvato da ${Math.round(since / 1000)} s.`, 'error', 'restart-mic');
        }
      } else if (this.warnings.get('nodata')?.action === 'restart-mic') {
        this.clearWarning('nodata');
      }
    }
    // microfono sospeso da iOS?
    const track = this.track;
    if (track?.readyState === 'ended') {
      this.onTrackEnded();
    } else if (track?.muted) {
      this.mutedSince ??= now;
      if (now - this.mutedSince > 5000) this.setWarning('muted', 'iOS ha sospeso il microfono. Se non riparte da solo, tocca «Riavvia microfono».', 'error', 'restart-mic');
    }
    // silenzio assoluto prolungato?
    if (this.meter?.running) {
      const silent = now - this.meter.lastSoundAt;
      if (silent > 20000) this.setWarning('silence', `Nessun suono dal microfono da ${Math.round(silent / 1000)} s: il microfono funziona?`, 'warn');
      else this.clearWarning('silence');
    }
    // nuovo file ogni N minuti (se impostato)
    const rot = this.settings.rotateMin || this.autoRotateMin;
    if (rot && now - this.partStartedAtMs > rot * 60000) this.rotatePart();
  }

  // ---------- fine ----------

  async stop() {
    if (!this.active || this.status === 'stopping') return null;
    const m = this.meeting;
    const stopSec = this.elapsed();
    this.status = 'stopping';
    this.emit();
    clearInterval(this.timer);
    await this.rec?.stop();
    await this.saveChain;
    const part = this.part;
    if (part?.status === 'recording') {
      part.endSec = stopSec;
      part.status = 'done';
    }
    // ultimo tentativo di scrivere su disco i pezzi rimasti in memoria
    for (const c of memoryChunks.filter((x) => x.meetingId === m.id)) {
      try {
        await db.putChunk(c);
        memoryChunks.splice(memoryChunks.indexOf(c), 1);
      } catch { break; }
    }
    m.endSec = stopSec;
    m.status = 'stopped';
    m.stoppedAt = Date.now();
    await this.addSys('stop', 'Fine registrazione');
    await db.putMeeting(m);
    this.teardown();
    this.clear();
    this.emit();
    return m.id;
  }

  teardown() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignora */ }
    this.meter?.close();
    this.wake.release();
  }
}

export const session = new RecordingSession();

// ---------- recupero dopo una chiusura improvvisa ----------

// Riunioni rimaste "in registrazione" perché Safari si è chiuso o il telefono si è spento
export async function findInterrupted() {
  const all = await db.getAllMeetings();
  return all.filter((m) => m.status === 'recording' && !(session.active && session.meeting?.id === m.id));
}

// Chiude le parti rimaste aperte usando i pezzi davvero salvati. Con stop=true chiude la riunione.
export async function finalizeInterrupted(meeting, { stop = false } = {}) {
  const stats = await db.chunkStats(meeting.id);
  const kept = [];
  for (const p of meeting.parts ?? []) {
    const s = stats.get(p.n);
    if (!s) continue; // parte senza audio salvato: la scartiamo
    p.chunks = s.count;
    p.bytes = s.bytes;
    if (p.status === 'recording') {
      p.endSec = Math.max(p.startSec, (s.lastAt - meeting.startedAt) / 1000);
      p.status = 'recovered';
    }
    kept.push(p);
  }
  meeting.parts = kept;
  if (stop) {
    const events = await db.getEvents(meeting.id);
    meeting.endSec = Math.max(0, ...kept.map((p) => p.endSec ?? 0), ...events.map((e) => e.t));
    meeting.status = 'stopped';
    meeting.stoppedAt = Date.now();
  }
  await db.putMeeting(meeting);
  return meeting;
}
