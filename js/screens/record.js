// Schermata 2: registrazione. Timer grande, REC, speaker attuale, pulsanti enormi, azioni in basso
// (zona raggiungibile col pollice).

import { h, toast, confirmDialog, promptDialog, openModal } from '../ui.js';
import * as db from '../db.js';
import { session, finalizeInterrupted } from '../session.js';
import { haptic } from '../haptics.js';
import { fmtTime, fmtClock, fmtDuration, textColorFor } from '../util.js';
import { STATE_TEXT } from '../transcriber.js';

// tasti delle persone, nell'ordine dei pulsanti
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const ACTION_LABEL = {
  resume: 'Riprendi',
  'restart-mic': 'Riavvia microfono',
  wake: 'Tieni acceso',
  dismiss: '✕',
};

export async function renderRecord(root, id) {
  if (!(session.active && session.meeting?.id === id)) return renderNotActive(root, id);

  document.body.classList.add('recording');
  const timerEl = h('div', { class: 'rec-timer', 'aria-live': 'off' }, '00:00:00');
  const labelEl = h('span', { class: 'rec-label' }, 'REC');
  const statusEl = h('div', { class: 'rec-status' }, h('span', { class: 'rec-dot' }), labelEl);
  const saveEl = h('span', {});
  const wakeEl = h('span', {});
  const healthEl = h('div', { class: 'rec-health' }, saveEl, wakeEl);
  // Barra del livello del microfono: si muove quando qualcuno parla
  const micFill = h('span', { class: 'mic-fill' });
  const micBar = h('div', { class: 'mic-bar', title: 'Livello del microfono' }, micFill);
  const warnEl = h('div', { class: 'rec-warnings' });
  const currentName = h('strong', {}, '');
  const currentSince = h('span', { class: 'rec-since' }, '');
  const currentEl = h('div', { class: 'rec-current' }, h('small', {}, 'Sta parlando'), currentName, currentSince);
  // Testo in diretta: la prova visibile che il telefono sta sentendo le voci
  const liveState = h('span', { class: 'live-state' }, '');
  const liveBody = h('p', { class: 'live-body' });
  const liveEl = h('div', { class: 'live-text', 'aria-live': 'polite' },
    h('div', { class: 'live-head' }, h('span', {}, '📝 Testo in diretta'), liveState), liveBody);
  const grid = h('div', { class: 'speaker-grid' });
  let gridCount = -1;

  const addBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Aggiungi partecipante',
    onclick: () => promptDialog('Aggiungi partecipante', { placeholder: 'Nome', ok: 'Aggiungi' }).then((name) => {
      if (name) session.addParticipant(name);
    }),
  }, '＋');

  const undoBtn = h('button', {
    type: 'button',
    class: 'act',
    onclick: async () => {
      haptic();
      const ev = await session.undo();
      toast(ev ? `Annullato: ${describe(ev)}` : 'Niente da annullare');
    },
  }, h('span', { class: 'act-ico' }, '↶'), 'Annulla', h('span', { class: 'key-hint', 'aria-hidden': 'true' }, 'Z'));

  const noteBtn = h('button', {
    type: 'button',
    class: 'act',
    onclick: () => {
      haptic();
      noteDialog(Date.now()); // il momento della nota è quello del tocco, non del salvataggio
    },
  }, h('span', { class: 'act-ico' }, '✎'), 'Nota', h('span', { class: 'key-hint', 'aria-hidden': 'true' }, 'N'));

  // Nota generale o sulla persona che sta parlando (quella selezionata al momento del tocco).
  // Va aperta dentro il tocco perché iOS mostri la tastiera.
  let lastScope = 'general';
  function noteDialog(at) {
    const t = session.elapsed(at);
    const cur = session.meeting.participants.find((x) => x.id === session.currentSpeakerId) ?? null;
    let scope = cur && lastScope === 'person' ? 'person' : 'general';
    const text = h('textarea', { rows: 4 });
    const hint = h('p', { class: 'small' });
    const seg = h('div', { class: 'seg' });
    const draw = (warnNobody = false) => {
      seg.replaceChildren(
        h('button', { type: 'button', class: scope === 'general' ? 'on' : '', onclick: () => { scope = 'general'; draw(); text.focus(); } }, '📝 Generale'),
        h('button', {
          type: 'button',
          class: `${scope === 'person' ? 'on' : ''}${cur ? '' : ' off'}`,
          onclick: () => {
            if (!cur) { draw(true); return; }
            scope = 'person';
            draw();
            text.focus();
          },
        }, cur ? `👤 Su ${cur.name}` : '👤 Su chi parla'));
      if (warnNobody) {
        hint.className = 'small note-warn';
        hint.textContent = '⚠ Non hai selezionato nessuno. Per una nota su una persona chiudi, tocca il nome di chi parla e poi di nuovo «Nota». Intanto puoi scrivere una nota generale.';
      } else {
        hint.className = 'small muted';
        hint.textContent = scope === 'person'
          ? `Nota su ${cur.name}: nelle esportazioni compare sotto il suo nome.`
          : cur ? `Nota sulla riunione. Per una nota solo su ${cur.name} scegli «Su ${cur.name}».`
            : 'Nota sulla riunione. Per una nota su una persona, seleziona prima chi parla toccando il suo nome.';
      }
      text.placeholder = scope === 'person' ? `Cosa vuoi annotare su ${cur.name}?` : 'Scrivi la nota…';
    };
    draw();
    openModal({
      title: `Nota a ${fmtTime(t)}`,
      body: h('div', { class: 'edit-form' }, seg, hint, text),
      actions: [
        { label: 'Annulla', value: null, class: 'secondary' },
        {
          label: 'Salva',
          class: 'primary',
          onClick: () => {
            const v = text.value.trim();
            if (!v) { toast('Scrivi il testo della nota'); return false; }
            const about = scope === 'person' ? cur : null;
            lastScope = scope;
            session.note(v, at, about?.id ?? null);
            toast(about ? `Nota su ${about.name} salvata (${fmtTime(t)})` : `Nota salvata (${fmtTime(t)})`);
            return true;
          },
        },
      ],
      onOpen: () => text.focus(),
    });
  }

  const markBtn = h('button', {
    type: 'button',
    class: 'act',
    onclick: async () => {
      haptic();
      const ev = await session.mark(Date.now());
      if (!ev) return;
      toast(`★ Momento importante ${fmtTime(ev.t)}`, {
        action: 'Aggiungi testo',
        onAction: () => promptDialog(`Momento importante ${fmtTime(ev.t)}`, { multiline: true, placeholder: 'Cosa è successo?' })
          .then((text) => { if (text) session.setEventText(ev, text); }),
      });
    },
  }, h('span', { class: 'act-ico' }, '★'), 'Importante', h('span', { class: 'key-hint', 'aria-hidden': 'true' }, 'I'));

  const stopBtn = h('button', {
    type: 'button',
    class: 'act act-stop',
    onclick: async () => {
      const ok = await confirmDialog('Terminare la registrazione?',
        'Audio e timeline vengono salvati sul telefono. Dopo potrai correggere i tempi ed esportare.',
        { ok: 'Termina', cancel: 'Continua a registrare', danger: true });
      if (!ok) return;
      stopBtn.disabled = true;
      const meetingId = await session.stop();
      if (meetingId) location.hash = `#/timeline/${meetingId}`;
    },
  }, h('span', { class: 'act-ico' }, '■'), 'Stop');

  root.replaceChildren(h('div', { class: 'rec-screen' },
    h('div', { class: 'rec-top' }, statusEl, timerEl, addBtn),
    micBar,
    healthEl,
    warnEl,
    currentEl,
    liveEl,
    grid,
    h('div', { class: 'rec-actions' }, undoBtn, noteBtn, markBtn, stopBtn)));

  function buildGrid() {
    const ps = session.meeting.participants;
    gridCount = ps.length;
    layoutGrid();
    grid.replaceChildren(...ps.map((p, i) => {
      const key = KEYS[i];
      const b = h('button', {
        type: 'button',
        class: 'speaker-btn',
        style: { '--c': p.color, '--fg': textColorFor(p.color) },
        dataset: { id: p.id },
        'aria-pressed': 'false',
        'aria-keyshortcuts': key,
      }, key ? h('span', { class: 'key-hint', 'aria-hidden': 'true' }, key) : null, h('span', { class: 'speaker-name' }, p.name));
      // Il cambio avviene appena il dito tocca lo schermo, senza aspettare che si alzi:
      // pulsante, "Sta parlando" e testo in diretta passano subito alla nuova persona
      const select = (at) => {
        b.classList.remove('pulse');
        void b.offsetWidth;
        b.classList.add('pulse');
        return session.speaker(p.id, at);
      };
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        b.downAt = Date.now();
        b.pending = select(b.downAt);
      });
      // il dito è partito da qui per scorrere la griglia (molti partecipanti): non era un cambio
      b.addEventListener('pointercancel', async () => {
        if (!b.downAt) return;
        b.downAt = null;
        const ev = await b.pending;
        if (ev) session.removeEvent(ev);
      });
      b.addEventListener('click', () => {
        // il "click" (dito alzato) è il gesto che iOS richiede per vibrazione, trascrizione e schermo acceso
        haptic();
        session.touch();
        if (b.downAt && Date.now() - b.downAt < 3000) { b.downAt = null; return; }
        select(Date.now()); // tastiera o lettore dello schermo: nessun pointerdown
      });
      return b;
    }));
  }

  // Colonne: le meno possibili (nomi più grandi e leggibili) purché tutti i pulsanti stiano nello
  // schermo senza scorrere. Telefono: 1 colonna fino a 3 persone, poi 2, 3 solo se non c'è posto.
  // Schermi larghi (PC, tablet in orizzontale): fino a 3 persone affiancate, poi fino a 6 colonne.
  function layoutGrid() {
    const n = gridCount;
    const w = grid.clientWidth;
    const wide = w >= 700;
    let cols = n <= 3 ? (wide ? Math.max(1, n) : 1) : 2;
    const maxCols = wide ? Math.max(cols, Math.min(6, Math.floor(w / 200))) : 3;
    const rowsFit = Math.max(1, Math.floor((grid.clientHeight + 10) / 62)); // righe da almeno 52 px + spazio
    while (cols < maxCols && Math.ceil(n / cols) > rowsFit) cols++;
    const value = `repeat(${cols}, minmax(0, 1fr))`;
    if (grid.style.gridTemplateColumns !== value) grid.style.gridTemplateColumns = value;
    grid.dataset.cols = String(cols);
  }

  function update() {
    if (!session.active) return;
    if (session.meeting.participants.length !== gridCount) buildGrid();
    const cur = session.currentSpeakerId;
    for (const b of grid.children) {
      const on = b.dataset.id === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const p = session.meeting.participants.find((x) => x.id === cur);
    currentEl.style.setProperty('--c', p?.color ?? 'transparent');
    currentEl.style.setProperty('--fg', p ? textColorFor(p.color) : 'inherit');
    currentEl.classList.toggle('empty', !p);
    currentName.textContent = p ? p.name : 'Tocca il nome di chi parla';

    const st = session.status;
    statusEl.dataset.state = st;
    labelEl.textContent = { starting: 'AVVIO', recording: 'REC', interrupted: 'FERMO', stopping: 'SALVO…' }[st] ?? st;

    renderWarnings();
    renderLive();
  }

  // Chi aveva la parola in un certo istante (ultimo tocco prima di quel momento)
  function speakerAtTime(t) {
    const id = session.speakerIdAt(t);
    return session.meeting.participants.find((p) => p.id === id) ?? null;
  }

  // Ultima frase riconosciuta (con chi la stava dicendo) + testo provvisorio in corso
  function renderLive() {
    if (!session.active) return;
    const t = session.transcriber;
    liveEl.classList.toggle('off', !t);
    if (!t) {
      liveState.textContent = '';
      liveBody.replaceChildren(h('span', { class: 'live-muted' },
        `Non attivo: ${session.transcribeInfo ?? 'spento'}. L'audio viene registrato comunque.`));
      return;
    }
    liveState.textContent = STATE_TEXT[t.state] ?? t.state;
    liveState.classList.toggle('on', t.active);
    const last = session.eventIndex.lastSpeech;
    const interim = session.interim;
    if (!last && !interim) {
      liveBody.replaceChildren(h('span', { class: 'live-muted' }, t.active
        ? 'In ascolto… qui compare il testo di chi parla.'
        : (t.reason || 'In pausa: tocca un nome per riattivarla.')));
      return;
    }
    // Ultima frase salvata (con chi l'ha detta) e, su una riga a parte, il testo in corso
    // attribuito a chi sta parlando adesso: dopo un tocco su un nome si vede subito il cambio
    const room = interim ? Math.max(40, 110 - interim.length) : 150;
    let finalText = last ? last.text : '';
    if (finalText.length > room) finalText = `…${finalText.slice(-room)}`;
    const who = last ? speakerAtTime((last.t + (last.end ?? last.t)) / 2) : null;
    const cur = session.meeting.participants.find((x) => x.id === session.currentSpeakerId) ?? null;
    const whoEl = (p) => (p ? h('span', { class: 'live-who', style: { '--c': p.color } }, `${p.name}: `) : null);
    liveBody.replaceChildren(...[
      finalText ? h('span', { class: `live-line${interim ? ' live-prev' : ''}` }, whoEl(who), h('span', { class: 'live-final' }, finalText)) : null,
      interim ? h('span', { class: 'live-line' }, whoEl(cur), h('span', { class: 'live-interim' }, interim)) : null,
    ].filter(Boolean));
  }

  // Gli avvisi restano gli stessi elementi finché esistono: se ne aggiorna solo il testo
  // (un pulsante ricreato mentre lo si tocca perderebbe il tocco)
  const warnItems = new Map();
  function renderWarnings() {
    for (const [key, item] of warnItems) {
      const w = session.warnings.get(key);
      if (!w || w.action !== item.action || w.level !== item.level) {
        item.el.remove();
        warnItems.delete(key);
      }
    }
    for (const [key, w] of session.warnings) {
      const item = warnItems.get(key);
      if (item) {
        if (item.textEl.textContent !== w.text) item.textEl.textContent = w.text;
        continue;
      }
      const textEl = h('span', {}, w.text);
      const el = h('div', { class: `warn warn-${w.level}` }, textEl,
        w.action ? h('button', { type: 'button', class: 'warn-btn', onclick: () => onWarningAction(key) }, ACTION_LABEL[w.action] ?? 'OK') : null);
      warnItems.set(key, { el, textEl, action: w.action, level: w.level });
      warnEl.append(el);
    }
  }

  function onWarningAction(key) {
    const w = session.warnings.get(key);
    if (!w) return;
    if (w.action === 'resume') session.resume('resume');
    else if (w.action === 'restart-mic') session.restartMic();
    else if (w.action === 'wake') session.wake.request();
    else session.clearWarning(key);
  }

  function tick() {
    if (!session.active) return;
    const now = Date.now();
    const el = session.elapsed(now);
    timerEl.textContent = fmtTime(el);
    const lastSp = session.eventIndex.lastSpeaker;
    currentSince.textContent = lastSp ? `da ${fmtClock(el - lastSp.t)}` : '';
    if (session.external) saveEl.textContent = '🎙 audio con un\'altra app';
    else {
      saveEl.textContent = session.lastChunkAt
        ? `💾 salvato ${Math.max(0, Math.round((now - session.lastChunkAt) / 1000))} s fa`
        : (session.status === 'recording' ? '💾 in attesa del primo salvataggio' : '💾 —');
    }
    micBar.hidden = !session.meter;
    wakeEl.textContent = session.wake.active ? '☀ schermo acceso' : '☾ schermo non bloccato';
    wakeEl.classList.toggle('bad', !session.wake.active);
    session.meter?.sample(); // livello aggiornato 4 volte al secondo
    const lvl = session.meter?.level ?? 0;
    const pct = lvl > 0 ? Math.min(100, Math.max(0, ((20 * Math.log10(lvl) + 60) / 50) * 100)) : 0;
    micFill.style.width = `${pct}%`;
  }

  buildGrid();
  update();
  tick();
  session.addEventListener('change', update);
  session.addEventListener('transcript', renderLive);
  // Scorciatoie da tastiera (PC, tablet con tastiera): 1-9 e 0 = persone, N nota, I importante, Z annulla.
  // Ignorate mentre si scrive o è aperta una finestra; la pressione è anche il "gesto" che serve al browser.
  function onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !session.active) return;
    if (document.getElementById('modal')?.open) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = e.key.toLowerCase();
    const i = KEYS.indexOf(k);
    let btn = null;
    if (i !== -1) btn = grid.children[i]?.matches('.speaker-btn') ? grid.children[i] : null;
    else if (k === 'n') btn = noteBtn;
    else if (k === 'i') btn = markBtn;
    else if (k === 'z') btn = undoBtn;
    if (!btn) return;
    e.preventDefault();
    btn.click();
  }
  document.addEventListener('keydown', onKey);

  const timer = setInterval(tick, 250);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layoutGrid()) : null;
  resize?.observe(grid);
  return () => {
    clearInterval(timer);
    resize?.disconnect();
    document.removeEventListener('keydown', onKey);
    session.removeEventListener('change', update);
    session.removeEventListener('transcript', renderLive);
    document.body.classList.remove('recording');
  };
}

function describe(ev) {
  const t = fmtTime(ev.t);
  if (ev.type === 'speaker') return `${session.meeting?.participants.find((p) => p.id === ev.speakerId)?.name ?? 'speaker'} (${t})`;
  if (ev.type === 'note') {
    const about = ev.aboutId ? session.meeting?.participants.find((p) => p.id === ev.aboutId)?.name : null;
    return about ? `nota su ${about} (${t})` : `nota (${t})`;
  }
  if (ev.type === 'mark') return `momento importante (${t})`;
  return t;
}

// La riunione risulta "in registrazione" ma la sessione non è attiva: l'app è stata chiusa
async function renderNotActive(root, id) {
  let meeting = await db.getMeeting(id);
  if (!meeting) { location.replace('#/'); return undefined; }
  if (meeting.status !== 'recording') { location.replace(`#/timeline/${id}`); return undefined; }
  meeting = await finalizeInterrupted(meeting); // chiude i file rimasti aperti con l'audio salvato
  const saved = (meeting.parts ?? []).reduce((acc, p) => acc + ((p.endSec ?? p.startSec) - p.startSec), 0);
  const resumeBtn = h('button', { type: 'button', class: 'btn primary xl' }, '▶ Riprendi la registrazione');
  resumeBtn.addEventListener('click', async () => {
    resumeBtn.disabled = true;
    resumeBtn.textContent = 'Attivo il microfono…';
    try {
      await session.start(meeting); // dentro il tocco: microfono, audio e schermo acceso
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      resumeBtn.disabled = false;
      resumeBtn.textContent = '▶ Riprendi la registrazione';
      openModal({ title: 'Impossibile riprendere', body: h('p', {}, err?.message || String(err)), actions: [{ label: 'OK', class: 'primary' }] });
    }
  });
  root.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'topbar' }, h('a', { class: 'btn ghost small', href: '#/' }, '‹ Home'), h('h1', {}, meeting.title)),
    h('div', { class: 'card card-warn' },
      h('strong', {}, 'La registrazione si è interrotta'),
      h('p', {}, `L'app è stata chiusa senza premere Stop. Sono stati salvati ${fmtDuration(saved)} di audio e tutti i tocchi.`),
      h('p', { class: 'small' }, 'Se riprendi, l\'audio continua in un nuovo file e la timeline segna il tratto mancante.')),
    resumeBtn,
    h('button', {
      type: 'button',
      class: 'btn secondary xl',
      onclick: async () => {
        await finalizeInterrupted(meeting, { stop: true });
        location.hash = `#/timeline/${id}`;
      },
    }, 'Chiudi e vai alla timeline')));
  return undefined;
}
