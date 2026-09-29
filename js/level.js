// Indicatore del livello del microfono (Web Audio). Serve solo a far vedere che il microfono
// sta captando davvero e a segnalare silenzi sospetti. Non influisce sulla registrazione.

export const SOUND_THRESHOLD = 0.0004; // RMS sotto cui consideriamo "silenzio assoluto"

export class LevelMeter {
  constructor() {
    // Va creato durante un tocco dell'utente (regola di iOS per l'audio)
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = AC ? new AC() : null;
      this.ctx?.resume?.().catch(() => {});
    } catch {
      this.ctx = null;
    }
    this.level = 0;
    this.lastSoundAt = Date.now();
    this.failed = !this.ctx;
  }

  attach(stream) {
    if (!this.ctx) return;
    try {
      this.src?.disconnect();
      this.src = this.ctx.createMediaStreamSource(stream);
      if (!this.an) {
        this.an = this.ctx.createAnalyser();
        this.an.fftSize = 1024;
        this.buf = new Float32Array(this.an.fftSize);
        // uscita a volume zero: garantisce che il grafo venga elaborato
        const sink = this.ctx.createGain();
        sink.gain.value = 0;
        this.an.connect(sink);
        sink.connect(this.ctx.destination);
      }
      this.src.connect(this.an);
      this.lastSoundAt = Date.now();
      this.failed = false;
    } catch {
      this.failed = true;
    }
  }

  get running() { return !!this.an && this.ctx?.state === 'running'; }

  sample() {
    if (!this.running) return null;
    this.an.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    this.level = Math.sqrt(sum / this.buf.length);
    if (this.level > SOUND_THRESHOLD) this.lastSoundAt = Date.now();
    return this.level;
  }

  // Dopo un'interruzione iOS mette il contesto in "interrupted"/"suspended": si riattiva con un tocco
  resume() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      this.ctx.resume?.().catch(() => {});
      this.lastSoundAt = Date.now();
    }
  }

  close() {
    try { this.src?.disconnect(); } catch { /* ignora */ }
    try { this.ctx?.close(); } catch { /* ignora */ }
    this.an = null;
  }
}
