// Schermata 1: titolo, partecipanti, impostazioni → Avvia registrazione.

import { h, toast, openModal, promptDialog } from '../ui.js';
import { session } from '../session.js';
import { getSettings, saveSettings, getRecentNames, rememberNames } from '../settings.js';
import { uid, nextColor, splitNames, fmtDateTime, PALETTE } from '../util.js';

export function renderSetup(root) {
  const participants = [];
  const titleInput = h('input', { type: 'text', value: `Riunione ${fmtDateTime(Date.now())}`, enterkeyhint: 'next' });
  const nameInput = h('input', {
    type: 'text', placeholder: 'Nome (anche più nomi separati da virgola)', autocapitalize: 'words', enterkeyhint: 'done',
  });
  const list = h('ul', { class: 'chips' });
  const recentBox = h('div', { class: 'recent' });
  const startBtn = h('button', { type: 'button', class: 'btn primary xl' }, '🎙 Avvia registrazione');

  const has = (name) => participants.some((p) => p.name.toLowerCase() === name.toLowerCase());

  function add(names) {
    for (const name of names) {
      if (!name || has(name)) continue;
      participants.push({ id: uid('p'), name, color: nextColor(participants.map((p) => p.color)) });
    }
    draw();
  }

  function addFromInput() {
    const names = splitNames(nameInput.value);
    nameInput.value = '';
    add(names);
  }

  function draw() {
    list.replaceChildren(...participants.map((p, i) => h('li', { class: 'chip', style: { '--c': p.color } },
      h('button', {
        type: 'button',
        class: 'chip-color',
        'aria-label': `Cambia colore di ${p.name}`,
        onclick: () => {
          p.color = PALETTE[(PALETTE.indexOf(p.color) + 1) % PALETTE.length];
          draw();
        },
      }),
      h('button', {
        type: 'button',
        class: 'chip-name',
        onclick: () => promptDialog('Rinomina partecipante', { value: p.name }).then((v) => {
          if (v && !has(v)) { p.name = v; draw(); }
        }),
      }, p.name),
      i > 0 ? h('button', {
        type: 'button', class: 'chip-btn', 'aria-label': `Sposta ${p.name} su`,
        onclick: () => { participants.splice(i - 1, 0, participants.splice(i, 1)[0]); draw(); },
      }, '↑') : null,
      h('button', {
        type: 'button', class: 'chip-btn', 'aria-label': `Rimuovi ${p.name}`,
        onclick: () => { participants.splice(i, 1); draw(); },
      }, '✕'))));
    if (!participants.length) list.append(h('li', { class: 'muted small' }, 'Aggiungi le persone presenti: diventeranno i pulsanti da toccare.'));
    const recent = getRecentNames().filter((n) => !has(n)).slice(0, 16);
    recentBox.replaceChildren(...(recent.length
      ? [h('span', { class: 'muted small' }, 'Recenti: '), ...recent.map((n) => h('button', { type: 'button', class: 'pill', onclick: () => add([n]) }, `＋ ${n}`))]
      : []));
  }

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
  });

  startBtn.addEventListener('click', async () => {
    if (nameInput.value.trim()) addFromInput();
    if (!participants.length) {
      toast('Aggiungi almeno un partecipante');
      nameInput.focus();
      return;
    }
    const meeting = {
      id: uid('r'),
      title: titleInput.value.trim() || `Riunione ${fmtDateTime(Date.now())}`,
      createdAt: Date.now(),
      participants: participants.map((p) => ({ ...p })),
      parts: [],
      status: 'new',
      externalAudio: getSettings().externalAudio,
    };
    startBtn.disabled = true;
    startBtn.textContent = 'Attivo il microfono…';
    try {
      await session.start(meeting); // chiamata diretta: su iOS deve partire dentro il tocco
      rememberNames(meeting.participants.map((p) => p.name));
      location.hash = `#/rec/${meeting.id}`;
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = '🎙 Avvia registrazione';
      openModal({
        title: 'Registrazione non avviata',
        body: h('p', {}, err?.message || String(err)),
        actions: [{ label: 'OK', class: 'primary' }],
      });
    }
  });

  draw();
  root.replaceChildren(h('div', { class: 'screen setup' },
    h('header', { class: 'topbar' },
      h('a', { class: 'btn ghost small', href: '#/' }, '‹ Indietro'),
      h('h1', {}, 'Nuova riunione')),
    h('label', { class: 'field' }, h('span', {}, 'Titolo'), titleInput),
    h('section', { class: 'field' },
      h('span', {}, 'Partecipanti'),
      h('div', { class: 'add-row' }, nameInput, h('button', { type: 'button', class: 'btn secondary', onclick: addFromInput }, 'Aggiungi')),
      list,
      recentBox),
    settingsPanel(),
    h('div', { class: 'sticky-bottom' },
      startBtn,
      h('p', { class: 'muted small center' }, 'Prima riunione importante? Fai prima la prova in ', h('a', { href: '#/diagnostica' }, 'Diagnostica'), '.'))));
}

function settingsPanel() {
  const s = getSettings();
  const select = (key, options) => h('select', { onchange: (e) => saveSettings({ [key]: Number(e.target.value) }) },
    options.map(([v, label]) => h('option', { value: String(v), selected: s[key] === v }, label)));
  const check = (key, label) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => saveSettings({ [key]: e.target.checked }) }),
    h('span', {}, label));
  return h('details', { class: 'card settings' },
    h('summary', {}, 'Impostazioni di registrazione'),
    h('label', { class: 'field' }, h('span', {}, 'Qualità audio'),
      select('bitrate', [[64000, 'Standard – 64 kbps (~29 MB/ora)'], [96000, 'Buona – 96 kbps (~43 MB/ora)'], [128000, 'Alta – 128 kbps (~58 MB/ora)']])),
    h('label', { class: 'field' }, h('span', {}, 'Dividi l\'audio in più file'),
      select('rotateMin', [[0, 'No, un solo file'], [15, 'Ogni 15 minuti'], [30, 'Ogni 30 minuti'], [60, 'Ogni 60 minuti']])),
    h('p', { class: 'muted small' }, 'Più file = meno audio a rischio se iOS chiude l\'app, ma più file da caricare nell\'AI.'),
    check('externalAudio', 'Solo timeline: l\'audio lo registro con un\'altra app (es. Memo Vocali, che continua anche a schermo bloccato)'),
    h('p', { class: 'muted small' }, 'In questa modalità ChiParla non usa il microfono. Avvia prima Memo Vocali, poi ChiParla; alla fine allinei i tempi nella timeline.'),
    check('processing', 'Riduzione rumore ed eco (sconsigliata per registrare una stanza: abbassa le voci lontane)'),
    check('haptics', 'Vibrazione al tocco (non garantita su iPhone)'),
    check('meter', 'Indicatore del livello del microfono'));
}
