// Schermata 1: titolo, partecipanti, impostazioni → Avvia registrazione.

import { h, toast, openModal, promptDialog, confirmDialog } from '../ui.js';
import { session } from '../session.js';
import {
  getSettings, saveSettings, getRecentNames, rememberNames, LANGUAGES, getGroups, saveGroup, deleteGroup,
} from '../settings.js';
import {
  uid, nextColor, splitNames, parseNameList, fmtDateTime, PALETTE,
} from '../util.js';
import { transcriptionSupport } from '../transcriber.js';

export function renderSetup(root) {
  const participants = [];
  const defaultTitle = `Riunione ${fmtDateTime(Date.now())}`;
  const titleInput = h('input', { type: 'text', value: defaultTitle, enterkeyhint: 'next' });
  const nameInput = h('input', {
    type: 'text', placeholder: 'Nome (anche più nomi separati da virgola)', autocapitalize: 'words', enterkeyhint: 'done',
  });
  const list = h('ul', { class: 'chips' });
  const recentBox = h('div', { class: 'recent' });
  const groupsBox = h('div', { class: 'recent groups' });
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
    drawGroups();
  }

  // ---------- gruppi (es. Presidenza): tutti i nomi con un tocco ----------

  function drawGroups() {
    const groups = getGroups();
    groupsBox.replaceChildren(...[
      h('span', { class: 'muted small' }, 'Gruppi: '),
      ...groups.map((g) => h('button', { type: 'button', class: 'pill group-pill', onclick: () => useGroup(g) },
        `👥 ${g.name}${g.names.length ? ` (${g.names.length})` : ''}`)),
      participants.length ? h('button', { type: 'button', class: 'pill', onclick: saveAsGroup }, '💾 Salva come gruppo') : null,
      groups.length ? h('button', { type: 'button', class: 'pill', onclick: manageGroups }, '✎ Gestisci') : null,
    ].filter(Boolean)); // replaceChildren scriverebbe "null" come testo
  }

  // Elenco incollato dal verbale: una persona per riga; numeri, punti elenco e ruoli si tolgono da soli
  function askNames(group) {
    return promptDialog(group.names.length ? `Modifica «${group.name}»` : `Nominativi: ${group.name}`, {
      value: group.names.join('\n'),
      multiline: true,
      placeholder: 'Mario Rossi\nAnna Bianchi\n…',
      hint: 'Incolla l\'elenco dei nominativi (per esempio dal verbale): una persona per riga o separate da virgola. '
        + 'Numerazione, punti elenco e ruoli come «– Presidente» o «(Segretario)» vengono tolti da soli. Resta salvato su questo dispositivo.',
    }).then((text) => {
      if (text == null) return null;
      const names = parseNameList(text);
      if (!names.length) { toast('Nessun nome riconosciuto'); return null; }
      saveGroup(group.name, names);
      return names;
    });
  }

  function useGroup(g) {
    const apply = (names) => {
      if (!names) return;
      const before = participants.length;
      add(names);
      if (titleInput.value === defaultTitle) titleInput.value = `${g.name} ${fmtDateTime(Date.now())}`;
      toast(`${g.name}: ${participants.length - before} persone aggiunte`);
    };
    if (g.names.length) apply(g.names); else askNames(g).then(apply);
  }

  function saveAsGroup() {
    promptDialog('Salva come gruppo', { placeholder: 'Nome del gruppo, es. Presidenza', ok: 'Salva' }).then(async (name) => {
      if (!name) return;
      const exists = getGroups().find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (exists && !await confirmDialog(`Sostituire «${exists.name}»?`, `Il gruppo avrà questi ${participants.length} nomi al posto dei ${exists.names.length} attuali.`, { ok: 'Sostituisci' })) return;
      saveGroup(exists?.name ?? name, participants.map((p) => p.name));
      drawGroups();
      toast(`Gruppo «${exists?.name ?? name}» salvato`);
    });
  }

  function manageGroups() {
    openModal({
      title: 'Gruppi',
      body: h('ul', { class: 'list' }, getGroups().map((g) => h('li', { class: 'item' },
        h('div', { class: 'item-main' },
          h('strong', {}, g.name),
          h('span', { class: 'muted small' }, g.names.length ? g.names.join(', ') : 'nessun nome')),
        h('button', { type: 'button', class: 'btn small secondary', onclick: () => askNames(g).then(() => drawGroups()) }, 'Modifica'),
        h('button', {
          type: 'button',
          class: 'btn small ghost icon-only',
          'aria-label': `Elimina il gruppo ${g.name}`,
          onclick: async () => {
            if (!await confirmDialog(`Eliminare il gruppo «${g.name}»?`, 'Si cancella solo l\'elenco dei nomi: le riunioni non vengono toccate.', { ok: 'Elimina', danger: true })) return;
            deleteGroup(g.name);
            drawGroups();
          },
        }, '🗑')))),
      actions: [{ label: 'Chiudi', class: 'secondary' }],
    });
  }

  // un elenco su più righe incollato nel campo (che ne terrebbe una sola) aggiunge tutti i nomi
  nameInput.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    add(parseNameList(text));
  });

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
      groupsBox,
      recentBox),
    transcriptionCard(),
    settingsPanel(),
    h('div', { class: 'sticky-bottom' },
      startBtn,
      h('p', { class: 'muted small center' }, 'Prima riunione importante? Fai prima la prova in ', h('a', { href: '#/diagnostica' }, 'Diagnostica'), '.'))));
}

// Trascrizione in diretta: in vista, perché cambia il risultato (testo nei file esportati)
function transcriptionCard() {
  const s = getSettings();
  const support = transcriptionSupport();
  return h('div', { class: `card small ${support.ok ? '' : 'card-warn'}` },
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: support.ok && s.transcribe, disabled: !support.ok,
        onchange: (e) => saveSettings({ transcribe: e.target.checked }),
      }),
      h('span', {}, h('strong', {}, '📝 Trascrizione in diretta'),
        ' — il testo di chi parla compare sullo schermo e finisce nei file esportati.')),
    support.ok
      ? h('p', { class: 'muted' }, 'Usa il riconoscimento vocale del telefono (lo stesso della dettatura: può passare dai server Apple). '
        + 'Il testo è approssimativo; l\'audio resta la fonte affidabile. Lingua: ',
      h('select', { class: 'inline-select', onchange: (e) => saveSettings({ lang: e.target.value }) },
        LANGUAGES.map(([v, label]) => h('option', { value: v, selected: s.lang === v }, label))))
      : h('p', {}, support.reason, ' L\'audio viene registrato comunque e il testo si può ottenere dopo, dando l\'audio a un\'AI.'));
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
