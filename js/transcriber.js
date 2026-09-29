// Trascrizione in diretta con il riconoscimento vocale del browser (Web Speech API).
//
// Su iPhone è lo stesso motore della dettatura di iOS: gratuito, ma
//  - funziona in Safari e NON nelle app aggiunte alla schermata Home;
//  - a seconda del telefono può elaborare l'audio sul dispositivo o sui server Apple;
//  - è instabile in modalità continua, quindi si usa una frase per sessione con riavvio automatico
//    (tra una frase e l'altra qualche parola può andare persa);
//  - il testo è approssimativo: la fonte affidabile resta il file audio.

import { isIOS, isStandalone } from './env.js';

const fakeMode = () => new URLSearchParams(location.search).has('fakespeech');
const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;

// { ok, reason } — se la trascrizione in diretta può funzionare qui
export function transcriptionSupport() {
  if (fakeMode()) return { ok: true, fake: true };
  if (!Recognition()) return { ok: false, reason: 'Questo browser non ha il riconoscimento vocale.' };
  if (isIOS() && isStandalone()) {
    return { ok: false, reason: 'Su iPhone la trascrizione in diretta funziona solo aprendo ChiParla in Safari, non dall\'app sulla schermata Home.' };
  }
  return { ok: true };
}

export const STATE_TEXT = {
  off: 'spenta',
  starting: 'avvio…',
  listening: 'attiva',
  waiting: 'attiva',
  paused: 'in pausa: tocca un nome',
  offline: 'senza internet: riprovo',
  denied: 'permesso negato',
  error: 'errore: riprovo',
  disabled: 'disattivata',
};

export class LiveTranscriber {
  constructor({ lang = 'it-IT', onFinal, onInterim, onState } = {}) {
    Object.assign(this, { onFinal, onInterim, onState });
    this.state = 'off';
    this.wanted = false;
    this.pending = '';
    this.speechAt = null;
    this.sessionAt = null;
    this.lastEventAt = 0;
    this.finals = 0;
    this.errors = [];
    const R = fakeMode() ? FakeRecognition : Recognition();
    if (!R) { this.state = 'disabled'; this.reason = 'non supportata'; return; }
    // Un'unica istanza riutilizzata: su iOS ricrearla a ogni frase fa suonare il segnale della dettatura
    this.rec = new R();
    this.rec.lang = lang;
    this.rec.continuous = false;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;
    this.rec.onstart = () => {
      this.sessionAt = Date.now();
      this.lastEventAt = Date.now();
      this.setState('listening');
    };
    this.rec.onspeechstart = () => {
      this.speechAt ??= Date.now();
      this.lastEventAt = Date.now();
    };
    this.rec.onresult = (e) => this.handleResult(e);
    this.rec.onerror = (e) => this.handleError(e);
    this.rec.onend = () => this.handleEnd();
  }

  get active() { return ['starting', 'listening', 'waiting'].includes(this.state); }

  setState(s, reason = null) {
    if (this.state === 'disabled' && s !== 'off') return;
    this.state = s;
    if (reason) this.reason = reason;
    this.onState?.(s);
  }

  // Avvio: se iOS lo rifiuta perché non c'è un tocco, riparte al primo tocco su un nome
  start() {
    if (!this.rec || this.state === 'disabled' || this.state === 'denied') return;
    this.wanted = true;
    this.begin(false);
  }

  begin(fromGesture = false) {
    if (!this.wanted || document.visibilityState !== 'visible') return;
    this.lastBeginFromGesture = fromGesture;
    try {
      this.rec.start();
      this.setState('starting');
      this.lastEventAt = Date.now();
    } catch (e) {
      if (e?.name !== 'InvalidStateError') this.setState('paused'); // serve un tocco
    }
  }

  // Ogni tocco sui nomi (gesto dell'utente) è l'occasione per riavviarla se si è fermata
  ensure() {
    if (this.wanted && ['paused', 'error', 'offline'].includes(this.state)) this.begin(true);
  }

  handleResult(e) {
    this.lastEventAt = Date.now();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = String(r[0]?.transcript ?? '').trim();
      if (!text) continue;
      // stima dell'inizio frase: il primo risultato arriva circa un secondo dopo l'inizio del parlato
      this.speechAt ??= Date.now() - 900;
      if (r.isFinal) this.commit(text);
      else interim = interim ? `${interim} ${text}` : text;
    }
    this.pending = interim;
    this.onInterim?.(interim);
  }

  commit(text) {
    const startMs = this.speechAt ?? this.sessionAt ?? Date.now();
    this.speechAt = null;
    this.pending = '';
    this.finals += 1;
    this.onFinal?.({ text, startMs, endMs: Date.now() });
    this.onInterim?.('');
  }

  // Salva come frase definitiva il testo provvisorio (su iOS "isFinal" a volte non arriva)
  flush() {
    if (this.pending) this.commit(this.pending);
  }

  handleError(e) {
    const err = e?.error || 'unknown';
    this.lastEventAt = Date.now();
    if (err === 'no-speech' || err === 'aborted') return; // silenzio o interruzione voluta
    this.errors.push(err);
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      // senza un tocco iOS può rifiutare: si riprova al primo tocco prima di considerarlo un rifiuto
      if (!this.lastBeginFromGesture && err === 'not-allowed') { this.setState('paused'); return; }
      this.wanted = false;
      this.setState('denied', 'Trascrizione non autorizzata: su iPhone controlla Impostazioni → Privacy e sicurezza → Riconoscimento vocale e il microfono per Safari. L\'audio viene registrato comunque.');
    } else if (err === 'network') {
      this.setState('offline', 'Serve internet (o la dettatura sul dispositivo) per la trascrizione.');
    } else {
      this.setState('error', `Errore del riconoscimento vocale: ${err}`);
    }
  }

  handleEnd() {
    this.flush();
    if (!this.wanted || this.state === 'denied' || this.state === 'disabled') {
      if (this.state !== 'denied' && this.state !== 'disabled') this.setState('off');
      return;
    }
    if (document.visibilityState !== 'visible') { this.setState('paused'); return; }
    const retryLater = this.state === 'offline' || this.state === 'error';
    if (!retryLater) this.setState('waiting');
    setTimeout(() => this.begin(), retryLater ? 10000 : 250);
  }

  // Chiamato ogni secondo: sblocca il riconoscimento se resta "in ascolto" senza dare segni di vita
  watchdog(now = Date.now()) {
    const stuck = (this.state === 'listening' && now - this.lastEventAt > 20000)
      || (this.state === 'starting' && now - this.lastEventAt > 8000);
    if (stuck) {
      try { this.rec.abort(); } catch { /* ignora */ }
      if (this.state === 'starting') this.setState('paused');
    }
  }

  onVisibility(visible) {
    if (!this.rec || !this.wanted) return;
    if (!visible) {
      this.flush();
      try { this.rec.abort(); } catch { /* ignora */ }
      this.setState('paused');
    } else {
      this.begin();
    }
  }

  stop() {
    this.wanted = false;
    this.flush();
    try { this.rec?.abort(); } catch { /* ignora */ }
    if (this.state !== 'disabled' && this.state !== 'denied') this.setState('off');
  }

  disable(reason) {
    this.stop();
    this.setState('disabled', reason);
  }
}

// Riconoscimento finto per provare l'app sul computer: aggiungere ?fakespeech all'indirizzo
class FakeRecognition {
  static count = 0;

  constructor() {
    this.running = false;
    this.timers = [];
  }

  start() {
    if (this.running) throw new DOMException('già avviato', 'InvalidStateError');
    this.running = true;
    this.timers.push(setTimeout(() => this.onstart?.(), 30));
    const words = `questa è la frase di prova numero ${++FakeRecognition.count}`.split(' ');
    let i = 0;
    const tick = () => {
      if (!this.running) return;
      i += 1;
      const r = [{ transcript: words.slice(0, i).join(' '), confidence: 0.9 }];
      r.isFinal = i >= words.length;
      this.onresult?.({ resultIndex: 0, results: [r] });
      if (r.isFinal) {
        this.running = false;
        this.timers.push(setTimeout(() => this.onend?.(), 30));
      } else {
        this.timers.push(setTimeout(tick, 350));
      }
    };
    this.timers.push(setTimeout(tick, 600));
  }

  stop() { this.abort(); }

  abort() {
    if (!this.running) return;
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    setTimeout(() => this.onend?.(), 20);
  }
}
