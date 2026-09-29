// Diagnostica: verifica SUL PROPRIO iPhone cosa funziona davvero (formato, salvataggio a pezzi,
// comportamento con schermo bloccato / app in background). Da fare prima di una riunione vera.

import { h, toast } from '../ui.js';
import * as db from '../db.js';
import { PartRecorder, pickMimeType, supportedMimeTypes, getMicStream } from '../recorder.js';
import { detectContainer } from '../mp4.js';
import { analyzeAudio, mediaDuration } from '../audio.js';
import { LevelMeter } from '../level.js';
import { ScreenWake } from '../wakelock.js';
import { getSettings } from '../settings.js';
import { session } from '../session.js';
import { browserInfo, appVersion, isIOS } from '../env.js';
import { fmtBytes, fmtTime, baseMime } from '../util.js';
import { LiveTranscriber, transcriptionSupport, STATE_TEXT } from '../transcriber.js';

const DIAG_ID = '__diagnostica__';
const MARK = { ok: '✓', warn: '⚠', bad: '✗', info: 'ⓘ' };

export async function renderDiag(root) {
  const env = browserInfo();
  const [storage, version, blobTest] = await Promise.all([db.storageInfo(), appVersion(), testBlobStorage()]);
  const checks = featureChecks(env, storage, blobTest);
  const test = new DiagTest(() => drawTest());

  // Elementi stabili: si aggiornano solo i testi, così un tocco non cade su un pulsante appena sostituito
  const btn = h('button', { type: 'button', class: 'btn primary xl' });
  btn.addEventListener('click', () => { if (test.state === 'recording') test.stop(); else test.start(); });
  const liveEl = h('p', { class: 'mono' });
  const speechEl = h('p', { class: 'small' });
  // Su iOS la trascrizione può richiedere un tocco per partire
  const speechBtn = h('button', { type: 'button', class: 'btn small secondary', onclick: () => test.transcriber?.ensure() }, '📝 Attiva la trascrizione');
  const errorEl = h('p', { class: 'line bad' });
  const resultsEl = h('ul', { class: 'checks' });
  const playerBox = h('div', {});
  const logPre = h('pre', { class: 'preview' });
  const logBox = h('details', { class: 'small' }, h('summary', {}, 'Registro della prova'), logPre);
  const testBox = h('div', {}, btn, liveEl, speechEl, speechBtn, errorEl, resultsEl, playerBox, logBox);
  let shownResult = null;
  let shownPlayer = null;

  function drawTest() {
    const running = test.state === 'recording';
    btn.className = `btn xl ${running ? 'danger' : 'primary'}`;
    btn.disabled = test.state === 'starting' || test.state === 'analyzing';
    btn.textContent = running ? '■ Ferma e analizza'
      : test.state === 'analyzing' ? 'Analisi in corso…'
        : test.state === 'done' ? '▶ Ripeti la prova' : '▶ Avvia la prova';
    liveEl.hidden = !(test.startedAt && (running || test.state === 'analyzing'));
    if (!liveEl.hidden) {
      liveEl.textContent = `${fmtTime((Date.now() - test.startedAt) / 1000)} · ${test.chunks.length} pezzi salvati · livello ${levelBar(test.meter?.level)}`;
    }
    const tr = test.transcriber;
    speechEl.hidden = !(running && tr);
    if (!speechEl.hidden) {
      const heard = [...test.speech.map((s) => s.text), test.interim].filter(Boolean).join(' ');
      speechEl.textContent = `📝 trascrizione ${STATE_TEXT[tr.state] ?? tr.state}: ${heard ? `«${heard.slice(-160)}»` : 'parla vicino al telefono…'}`;
    }
    speechBtn.hidden = !(running && tr && ['paused', 'error', 'offline'].includes(tr.state));
    errorEl.hidden = !test.error;
    errorEl.textContent = test.error ? `✗ ${test.error}` : '';
    if (test.result !== shownResult) {
      shownResult = test.result;
      resultsEl.replaceChildren(...(test.result ?? []).map((r) => h('li', { class: `line ${r.level}` }, `${MARK[r.level]} ${r.text}`)));
    }
    if (test.playerEl !== shownPlayer) {
      shownPlayer = test.playerEl;
      playerBox.replaceChildren(...(test.playerEl ? [test.playerEl] : []));
    }
    logBox.hidden = !test.log.length;
    logPre.textContent = test.log.join('\n');
  }

  function report() {
    return [
      `ChiParla ${version} – diagnostica ${new Date().toISOString()}`,
      `Browser: ${env.ua}`,
      `Aperta come: ${env.standalone ? 'app da schermata Home' : 'Safari'}`,
      ...checks.map((c) => `${MARK[c.level]} ${c.label}: ${c.value}${c.note ? ` (${c.note})` : ''}`),
      '',
      'Prova di registrazione:',
      ...(test.result ?? []).map((r) => `${MARK[r.level]} ${r.text}`),
      '',
      ...test.log,
    ].join('\n');
  }

  drawTest();
  root.replaceChildren(h('div', { class: 'screen diag' },
    h('header', { class: 'topbar' }, h('a', { class: 'btn ghost small', href: '#/' }, '‹ Home'), h('h1', {}, 'Diagnostica')),
    h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Questo telefono'),
      h('p', { class: 'small' }, `Safari ${env.safari ?? '?'} · sistema riportato dal browser: iOS ${env.ios ?? '?'} · aperta come ${env.standalone ? 'app dalla schermata Home' : 'pagina di Safari'} · ChiParla ${version}`),
      h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: `line ${c.level}` },
        `${MARK[c.level]} ${c.label}: `, h('strong', {}, c.value), c.note ? h('span', { class: 'muted' }, ` – ${c.note}`) : null)))),
    h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Prova di registrazione'),
      h('p', { class: 'small' }, 'Usa le stesse impostazioni di una riunione vera. Per la prova decisiva: avvia, parla, blocca l\'iPhone per 20-30 secondi continuando a parlare, sbloccalo, torna qui e ferma la prova. Ripetila anche passando a un\'altra app.'),
      testBox),
    h('button', {
      type: 'button',
      class: 'btn secondary',
      onclick: async () => {
        try { await navigator.clipboard.writeText(report()); toast('Rapporto copiato'); } catch { toast('Copia non riuscita'); }
      },
    }, 'Copia il rapporto')));
  return () => test.destroy();
}

function levelBar(level) {
  if (!level) return '▯▯▯▯▯';
  const n = Math.max(0, Math.min(5, Math.round(((20 * Math.log10(level) + 60) / 50) * 5)));
  return '▮'.repeat(n) + '▯'.repeat(5 - n);
}

function featureChecks(env, storage, blobTest) {
  const mime = pickMimeType();
  let canShareFiles = false;
  try { canShareFiles = !!navigator.canShare?.({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }); } catch { /* no */ }
  const c = (label, ok, value, note = '', level = ok ? 'ok' : 'bad') => ({ label, value, note, level });
  const speech = transcriptionSupport();
  return [
    c('Trascrizione in diretta', speech.ok, speech.ok ? 'disponibile' : 'non disponibile',
      speech.ok ? 'verifica con la prova qui sotto che funzioni insieme alla registrazione' : speech.reason, speech.ok ? 'ok' : 'warn'),
    c('Microfono', !!navigator.mediaDevices?.getUserMedia, navigator.mediaDevices?.getUserMedia ? 'disponibile' : 'non disponibile', 'serve https'),
    c('Registrazione (MediaRecorder)', mime !== null, mime === null ? 'non supportata' : 'supportata', mime === null ? 'aggiorna iOS (serve 14.5+)' : ''),
    c('Formato audio', !!mime, mime || 'predefinito del browser', `supportati: ${supportedMimeTypes().join(', ') || 'nessuno dei preferiti'}`, mime ? 'ok' : 'warn'),
    c('Schermo sempre acceso (Wake Lock)', 'wakeLock' in navigator, 'wakeLock' in navigator ? 'disponibile' : 'non disponibile',
      'wakeLock' in navigator ? 'nelle app da Home funziona da iOS 18.4' : 'imposta Blocco automatico su «Mai» durante le riunioni', 'wakeLock' in navigator ? 'ok' : 'warn'),
    c('Archivio locale (IndexedDB)', blobTest.ok, blobTest.ok ? (blobTest.asBuffer ? 'ok (audio salvato come ArrayBuffer)' : 'ok') : `errore ${blobTest.error ?? ''}`),
    c('Spazio', true, storage.quota ? `${fmtBytes(storage.usage)} usati su ${fmtBytes(storage.quota)}` : 'n.d.', '1 ora a 64 kbps ≈ 29 MB', 'info'),
    c('Protezione dalla pulizia automatica', !!storage.persisted, storage.persisted ? 'sì' : 'non garantita',
      storage.persisted ? '' : 'Safari può cancellare i dati di siti non usati da settimane: esporta sempre i file', storage.persisted ? 'ok' : 'warn'),
    c('Condivisione file', canShareFiles, canShareFiles ? 'disponibile' : 'non disponibile', canShareFiles ? '' : 'si userà il download', canShareFiles ? 'ok' : 'warn'),
    c('Vibrazione', typeof navigator.vibrate === 'function', typeof navigator.vibrate === 'function' ? 'disponibile' : 'non disponibile',
      isIOS() ? 'Safari non la supporta: si tenta il feedback degli interruttori di iOS 18, non garantito' : '', typeof navigator.vibrate === 'function' ? 'ok' : 'info'),
    c('Funzionamento offline', !!navigator.serviceWorker?.controller, navigator.serviceWorker?.controller ? 'attivo' : 'non ancora attivo',
      navigator.serviceWorker?.controller ? '' : 'si attiva dalla seconda apertura con internet', navigator.serviceWorker?.controller ? 'ok' : 'warn'),
  ];
}

async function testBlobStorage() {
  try {
    const blob = new Blob([new Uint8Array(1000)], { type: 'application/octet-stream' });
    await db.putChunk({ meetingId: DIAG_ID, part: 0, seq: 0, data: blob, size: 1000, at: Date.now() });
    const back = await db.getChunks(DIAG_ID, 0);
    await db.deleteChunks(DIAG_ID, 0);
    const d = back[0]?.data;
    const size = d instanceof Blob ? d.size : d?.byteLength;
    return { ok: size === 1000, asBuffer: !!back[0]?.asBuffer };
  } catch (e) {
    return { ok: false, error: e?.name || String(e) };
  }
}

class DiagTest {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.state = 'idle';
    this.reset();
  }

  reset() {
    this.log = [];
    this.chunks = [];
    this.hidden = [];
    this.hiddenAt = null;
    this.trackEvents = [];
    this.result = null;
    this.error = null;
    this.container = null;
    this.startedAt = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.playerEl = null;
    this.transcriber = null;
    this.speech = [];
    this.interim = '';
    this.speechInfo = null;
    this.interference = false;
  }

  addLog(text) {
    const t = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    this.log.push(`${fmtTime(t)}  ${text}`);
    this.onUpdate();
  }

  async start() {
    if (session.active) { toast('C\'è una registrazione in corso: prima fermala'); return; }
    this.reset();
    this.state = 'starting';
    const settings = getSettings();
    this.meter = new LevelMeter(); // dentro il tocco
    this.wake = new ScreenWake();
    this.wake.request();
    this.onUpdate();
    try {
      this.stream = await getMicStream(settings.processing);
      await db.deleteChunks(DIAG_ID);
      this.meter.attach(this.stream);
      const track = this.stream.getAudioTracks()[0];
      for (const type of ['mute', 'unmute', 'ended']) {
        track.addEventListener(type, () => {
          this.trackEvents.push(type);
          this.addLog(`microfono: ${type}`);
          // come nella registrazione vera: se con la trascrizione attiva il microfono si sospende, la si spegne
          if (type === 'mute' && document.visibilityState === 'visible' && this.transcriber?.active) {
            this.interference = true;
            this.transcriber.disable('spenta: disturbava la registrazione');
            this.addLog('trascrizione spenta: il microfono della registrazione si è sospeso');
          }
        });
      }
      this.onVis = () => {
        if (document.visibilityState === 'hidden') {
          this.hiddenAt = Date.now();
          this.addLog('app nascosta (schermo bloccato o altra app)');
        } else if (this.hiddenAt) {
          const d = (Date.now() - this.hiddenAt) / 1000;
          this.hidden.push(d);
          this.hiddenAt = null;
          this.addLog(`app di nuovo visibile dopo ${d.toFixed(1)} s`);
          this.wake.request();
          this.meter.resume();
        }
      };
      document.addEventListener('visibilitychange', this.onVis);
      this.mime = pickMimeType();
      let seq = 0;
      this.save = Promise.resolve();
      this.rec = new PartRecorder({
        stream: this.stream,
        mimeType: this.mime,
        bitrate: settings.bitrate,
        timesliceMs: settings.timesliceMs,
        onChunk: (b) => {
          const s = seq++;
          const at = Date.now();
          this.chunks.push({ at, size: b.size });
          this.addLog(`pezzo ${s + 1}: ${fmtBytes(b.size)}`);
          this.save = this.save
            .then(() => db.putChunk({ meetingId: DIAG_ID, part: 1, seq: s, data: b, size: b.size, at }))
            .catch((e) => this.addLog(`errore di salvataggio: ${e?.name || e}`));
          if (s === 0) detectContainer(b).then((c) => { this.container = c; this.addLog(`contenitore: ${c.kind} ${c.types?.join(' ') ?? ''}`); });
        },
        onError: (e) => this.addLog(`errore del registratore: ${e?.name || e}`),
        onStop: () => this.addLog('registratore fermato'),
      });
      this.startedAt = await this.rec.start();
      this.mime = this.rec.mimeType || this.mime;
      this.state = 'recording';
      this.addLog(`prova avviata (${this.mime || 'formato predefinito'}, un pezzo ogni ${settings.timesliceMs / 1000} s)`);
      this.startTranscription(settings);
      this.timer = setInterval(() => { this.meter.sample(); this.transcriber?.watchdog(); this.onUpdate(); }, 500);
    } catch (e) {
      this.cleanupMedia();
      this.state = 'idle';
      this.error = e?.message || String(e);
      this.onUpdate();
    }
  }

  // Stessa trascrizione della registrazione vera, per verificare che le due cose convivano
  startTranscription(settings) {
    const support = transcriptionSupport();
    if (!settings.transcribe) { this.speechInfo = 'spenta nelle impostazioni'; return; }
    if (!support.ok) { this.speechInfo = support.reason; return; }
    this.transcriber = new LiveTranscriber({
      lang: settings.lang,
      onFinal: ({ text }) => { this.speech.push({ text }); this.addLog(`testo: «${text}»`); },
      onInterim: (text) => { this.interim = text; },
      onState: (s) => this.addLog(`trascrizione: ${STATE_TEXT[s] ?? s}`),
    });
    this.transcriber.start();
  }

  async stop() {
    if (this.state !== 'recording') return;
    this.transcriber?.stop();
    const stoppedAt = Date.now();
    if (this.hiddenAt) { this.hidden.push((stoppedAt - this.hiddenAt) / 1000); this.hiddenAt = null; }
    this.state = 'analyzing';
    this.onUpdate();
    await this.rec.stop();
    await this.save;
    this.cleanupMedia();
    const stored = await db.getChunks(DIAG_ID, 1);
    const blob = stored.length ? new Blob(stored.map((c) => c.data), { type: baseMime(this.mime) }) : null;
    let analysis = null;
    let playerDur = null;
    if (blob) {
      try { analysis = await analyzeAudio(blob, this.mime); } catch (e) { this.addLog(`analisi non riuscita: ${e?.message || e}`); }
      playerDur = await mediaDuration(blob);
      this.url = URL.createObjectURL(blob);
      const audio = h('audio', { controls: true, src: this.url });
      audio.setAttribute('playsinline', '');
      this.playerEl = h('div', { class: 'player' }, h('p', { class: 'small' }, 'Ascolta la prova:'), audio);
    }
    this.addLog(`fine: ${stored.length} pezzi salvati, ${fmtBytes(blob?.size ?? 0)}; durata analizzata ${analysis?.durationSec?.toFixed(2) ?? '?'} s, dal lettore ${playerDur?.toFixed(2) ?? '?'} s`);
    this.result = interpret({
      wall: (stoppedAt - this.startedAt) / 1000,
      chunks: this.chunks,
      stoppedAt,
      hidden: this.hidden,
      trackEvents: this.trackEvents,
      container: this.container,
      analysis,
      playerDur,
      mime: this.mime,
      stored: stored.length,
      speech: {
        info: this.speechInfo,
        texts: this.speech.map((s) => s.text),
        errors: this.transcriber?.errors ?? [],
        state: this.transcriber?.state ?? null,
        interference: this.interference,
      },
    });
    this.state = 'done';
    this.onUpdate();
  }

  cleanupMedia() {
    clearInterval(this.timer);
    this.transcriber?.stop();
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.meter?.close();
    this.wake?.release();
  }

  destroy() {
    if (this.state === 'recording') this.rec?.stop();
    this.cleanupMedia();
    if (this.url) URL.revokeObjectURL(this.url);
    db.deleteChunks(DIAG_ID).catch(() => {});
  }
}

// Traduce le misure in conclusioni comprensibili
export function interpret(r) {
  const out = [];
  const ok = (text) => out.push({ level: 'ok', text });
  const warn = (text) => out.push({ level: 'warn', text });
  const bad = (text) => out.push({ level: 'bad', text });
  const info = (text) => out.push({ level: 'info', text });

  if (!r.stored) {
    bad('Nessun audio salvato: la registrazione non funziona in questo browser o il microfono è bloccato.');
    return out;
  }
  const before = r.chunks.filter((c) => c.at < r.stoppedAt - 300);
  if (before.length >= 2) {
    const avg = (before[before.length - 1].at - before[0].at) / 1000 / (before.length - 1);
    ok(`Salvataggio progressivo: ${before.length} pezzi durante la prova, circa uno ogni ${avg.toFixed(1)} s. Se Safari si chiude si perdono solo gli ultimi secondi.`);
  } else if (r.wall > 15) {
    bad('Salvataggio progressivo assente: l\'audio arriva solo allo Stop. Se Safari si chiude durante la riunione quel file va perso: nelle impostazioni scegli «Dividi l\'audio ogni 15 minuti».');
  } else {
    info('Prova troppo breve per verificare il salvataggio progressivo: falla durare almeno 30 secondi.');
  }

  if (r.container?.recoverable) ok(`Formato ${r.container.kind === 'fmp4' ? 'MP4 frammentato' : r.container.kind} (${r.mime}): i pezzi salvati restano leggibili anche dopo una chiusura improvvisa.`);
  else if (r.container?.recoverable === false) bad(`Formato ${r.container.kind}: dopo una chiusura improvvisa il file potrebbe non essere leggibile. ChiParla dividerà l'audio in file da 10 minuti.`);

  // trascrizione in diretta insieme alla registrazione
  const sp = r.speech;
  if (sp?.info) {
    info(`Trascrizione in diretta non provata: ${sp.info}.`);
  } else if (sp) {
    const words = sp.texts.join(' ').split(/\s+/).filter(Boolean).length;
    if (sp.interference) {
      bad('Con la trascrizione attiva il microfono della registrazione si è sospeso: in riunione ChiParla la spegnerà da sola per proteggere l\'audio. Puoi disattivarla da «Nuova riunione».');
    } else if (sp.texts.length) {
      ok(`Trascrizione in diretta insieme alla registrazione: ${sp.texts.length} frasi, ${words} parole — «${sp.texts.join(' ').slice(0, 160)}»`);
    } else {
      warn(`Nessuna frase trascritta${sp.errors.length ? ` (errori: ${[...new Set(sp.errors)].join(', ')})` : ''}${sp.state ? `, stato: ${STATE_TEXT[sp.state] ?? sp.state}` : ''}. Parla vicino al telefono e ripeti la prova; se resta vuota, qui la trascrizione non funziona (l'audio sì).`);
    }
    if (r.analysis?.gaps?.length && !r.hidden.length) {
      warn('Nel file audio ci sono piccoli salti anche senza interruzioni: la trascrizione potrebbe disturbare la registrazione. Ascolta la prova; nel dubbio disattivala.');
    }
  }

  const a = r.analysis?.durationSec ?? r.playerDur;
  if (a == null) {
    warn('Durata dell\'audio non misurabile: ascolta la prova per controllarla.');
    return out;
  }
  const diff = r.wall - a;
  const hiddenTot = r.hidden.reduce((x, y) => x + y, 0);
  info(`Durata audio ${a.toFixed(1)} s, tempo trascorso ${r.wall.toFixed(1)} s (differenza ${diff.toFixed(1)} s).`);
  if (hiddenTot < 1) {
    if (Math.abs(diff) <= 1.5) ok('Audio e timer coincidono.');
    else warn('Audio e timer non coincidono anche senza interruzioni: ascolta la prova per capire.');
    info('Per vedere cosa succede con lo schermo bloccato ripeti la prova bloccando l\'iPhone per 20-30 secondi mentre parli.');
  } else if (r.trackEvents.includes('ended')) {
    bad(`App nascosta per ${hiddenTot.toFixed(0)} s: iOS ha chiuso il microfono. In una riunione la registrazione si fermerebbe; ChiParla prova a riprenderla in un nuovo file quando torni all'app.`);
  } else if (Math.abs(diff) <= 1.5) {
    warn(`App nascosta per ${hiddenTot.toFixed(0)} s: la durata è rimasta allineata al timer. Ascolta quel tratto: se senti la tua voce iOS ha continuato a registrare; se è silenzio ha registrato vuoto, ma i tempi restano giusti.`);
  } else if (Math.abs(diff - hiddenTot) <= Math.max(1.5, hiddenTot * 0.25)) {
    if (r.analysis?.spanSec != null && Math.abs(r.wall - r.analysis.spanSec) <= 1.5) {
      warn(`App nascosta per ${hiddenTot.toFixed(0)} s: quel tratto non contiene audio, ma il file conserva i tempi (salto nei timestamp).`);
    } else {
      bad(`App nascosta per ${hiddenTot.toFixed(0)} s: quel tratto NON è stato registrato e il file è più corto. A fine riunione ChiParla propone di correggere i tempi.`);
    }
  } else {
    warn('La differenza di durata non coincide con il tempo in background: ascolta la prova per capire cosa è successo.');
  }
  if (r.trackEvents.includes('mute')) info(`Il sistema ha sospeso il microfono${r.trackEvents.includes('unmute') ? ' e poi l\'ha riattivato' : ''}.`);
  if (r.analysis?.gaps?.length) info(`Salti nei tempi del file: ${r.analysis.gaps.map((g) => `${g.durSec.toFixed(1)} s dopo ${g.atSec.toFixed(1)} s`).join(', ')}.`);
  return out;
}
