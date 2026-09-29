// Screen Wake Lock: tiene lo schermo acceso durante la registrazione.
// iOS: Safari 16.4+; nelle app aggiunte alla schermata Home funziona da iOS 18.4.
// Il blocco viene rilasciato automaticamente quando la pagina va in background:
// al ritorno va richiesto di nuovo (meglio durante un tocco).

export class ScreenWake {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    this.sentinel = null;
    this.wanted = false;
    this.error = null;
    this.onchange = null;
  }

  get active() { return !!this.sentinel && !this.sentinel.released; }

  // Chiamare senza await prima: la richiesta parte subito, dentro il gesto dell'utente
  async request() {
    this.wanted = true;
    if (!this.supported || this.active || this.pending || document.visibilityState !== 'visible') return this.active;
    this.pending = true;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.onchange?.();
      });
      this.error = null;
    } catch (e) {
      this.error = e;
    } finally {
      this.pending = false;
    }
    this.onchange?.();
    return this.active;
  }

  async release() {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    try { await s?.release(); } catch { /* già rilasciato */ }
    this.onchange?.();
  }
}
