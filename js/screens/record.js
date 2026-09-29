// Schermata 2: registrazione. Timer grande, REC, speaker attuale, pulsanti enormi, azioni in basso
// (zona raggiungibile col pollice).

import { h, toast, confirmDialog, promptDialog, openModal } from '../ui.js';
import * as db from '../db.js';
import { session, finalizeInterrupted } from '../session.js';
import { haptic } from '../haptics.js';
import { fmtTime, fmtClock, fmtDuration, textColorFor } from '../util.js';
import { sortEvents } from '../timeline.js';

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
  const meterFill = h('span', { class: 'meter-fill' });
  const healthEl = h('div', { class: 'rec-health' }, saveEl, wakeEl, h('span', { class: 'meter', title: 'Livello microfono' }, meterFill));
  const warnEl = h('div', { class: 'rec-warnings' });
  const currentName = h('strong', {}, '');
  const currentSince = h('span', { class: 'rec-since' }, '');
  const currentEl = h('div', { class: 'rec-current' }, h('small', {}, 'Sta parlando'), currentName, currentSince);
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
  }, h('span', { class: 'act-ico' }, '↶'), 'Annulla');

  const noteBtn = h('button', {
    type: 'button',
    class: 'act',
    onclick: () => {
      const at = Date.now(); // il momento della nota è quello del tocco, non del salvataggio
      const t = session.elapsed(at);
      haptic();
      promptDialog(`Nota a ${fmtTime(t)}`, { multiline: true, placeholder: 'Scrivi la nota…' }).then((text) => {
        if (!text) return;
        session.note(text, at);
        toast(`Nota salvata (${fmtTime(t)})`);
      });
    },
  }, h('span', { class: 'act-ico' }, '✎'), 'Nota');

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
  }, h('span', { class: 'act-ico' }, '★'), 'Importante');

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
    healthEl,
    warnEl,
    currentEl,
    grid,
    h('div', { class: 'rec-actions' }, undoBtn, noteBtn, markBtn, stopBtn)));

  function buildGrid() {
    const ps = session.meeting.participants;
    gridCount = ps.length;
    const cols = ps.length <= 3 ? 1 : ps.length <= 8 ? 2 : 3;
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    grid.replaceChildren(...ps.map((p) => {
      const b = h('button', {
        type: 'button',
        class: 'speaker-btn',
        style: { '--c': p.color, '--fg': textColorFor(p.color) },
        dataset: { id: p.id },
        'aria-pressed': 'false',
      }, h('span', { class: 'speaker-name' }, p.name));
      // il tempo si prende quando il dito tocca lo schermo (più preciso del "click")
      b.addEventListener('pointerdown', () => { b.downAt = Date.now(); });
      b.addEventListener('click', () => {
        const at = b.downAt && Date.now() - b.downAt < 1500 ? b.downAt : Date.now();
        b.downAt = null;
        haptic();
        b.classList.remove('pulse');
        void b.offsetWidth;
        b.classList.add('pulse');
        session.speaker(p.id, at);
      });
      return b;
    }));
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
    const lastSp = sortEvents(session.events.filter((e) => e.type === 'speaker')).pop();
    currentSince.textContent = lastSp ? `da ${fmtClock(el - lastSp.t)}` : '';
    if (session.external) saveEl.textContent = '🎙 audio con un\'altra app';
    else {
      saveEl.textContent = session.lastChunkAt
        ? `💾 salvato ${Math.max(0, Math.round((now - session.lastChunkAt) / 1000))} s fa`
        : (session.status === 'recording' ? '💾 in attesa del primo salvataggio' : '💾 —');
    }
    meterFill.parentElement.hidden = !session.meter;
    wakeEl.textContent = session.wake.active ? '☀ schermo acceso' : '☾ schermo non bloccato';
    wakeEl.classList.toggle('bad', !session.wake.active);
    const lvl = session.meter?.level ?? 0;
    const pct = lvl > 0 ? Math.min(100, Math.max(0, ((20 * Math.log10(lvl) + 60) / 50) * 100)) : 0;
    meterFill.style.width = `${pct}%`;
  }

  buildGrid();
  update();
  tick();
  session.addEventListener('change', update);
  const timer = setInterval(tick, 250);
  return () => {
    clearInterval(timer);
    session.removeEventListener('change', update);
    document.body.classList.remove('recording');
  };
}

function describe(ev) {
  const t = fmtTime(ev.t);
  if (ev.type === 'speaker') return `${session.meeting?.participants.find((p) => p.id === ev.speakerId)?.name ?? 'speaker'} (${t})`;
  if (ev.type === 'note') return `nota (${t})`;
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
