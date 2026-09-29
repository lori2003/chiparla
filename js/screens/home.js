// Schermata iniziale: nuova riunione, riunioni salvate, recupero di registrazioni interrotte.

import { h, toast } from '../ui.js';
import * as db from '../db.js';
import { session, finalizeInterrupted } from '../session.js';
import { fmtDateTime, fmtTime, fmtBytes } from '../util.js';
import { browserInfo, appVersion, isIOS } from '../env.js';

export async function renderHome(root) {
  const [meetings, storage] = await Promise.all([db.getAllMeetings(), db.storageInfo()]);
  meetings.sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt));
  const interrupted = meetings.filter((m) => m.status === 'recording' && !(session.active && session.meeting?.id === m.id));
  const saved = meetings.filter((m) => m.status !== 'recording');
  const env = browserInfo();
  const versionEl = h('span', {}, '…');
  appVersion().then((v) => { versionEl.textContent = v; });

  root.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('h1', { class: 'brand' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }), 'ChiParla'),
      h('a', { class: 'btn ghost small', href: '#/diagnostica' }, 'Diagnostica')),
    session.active
      ? h('a', { class: 'banner banner-rec', href: `#/rec/${session.meeting.id}` }, '● Registrazione in corso: torna alla registrazione')
      : null,
    interrupted.map(recoveryCard),
    h('a', { class: 'btn primary xl', href: '#/nuova' }, '＋ Nuova riunione'),
    isIOS() && !env.standalone ? installHint() : null,
    h('h2', { class: 'section-title' }, 'Riunioni salvate'),
    saved.length
      ? h('ul', { class: 'list' }, saved.map(meetingRow))
      : h('p', { class: 'muted' }, 'Nessuna riunione. Audio e timeline restano solo su questo telefono: nulla viene inviato a server.'),
    h('footer', { class: 'footer muted small' },
      h('p', {}, `Spazio usato: ${storage.usage != null ? fmtBytes(storage.usage) : 'n.d.'}`
        + `${storage.quota ? ` su ${fmtBytes(storage.quota)} disponibili` : ''}`),
      h('p', {}, `Archivio protetto dalla pulizia automatica: ${storage.persisted ? 'sì' : 'non garantito'} `,
        storage.persisted ? null : h('button', { class: 'link', type: 'button', onclick: askPersist }, 'richiedi')),
      h('p', {}, `Aperta come: ${env.standalone ? 'app dalla schermata Home' : 'pagina di Safari'} · versione `, versionEl))));
}

async function askPersist() {
  try {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Archivio protetto ✓' : 'Il browser non l\'ha concesso: installa l\'app sulla schermata Home e riprova.');
  } catch {
    toast('Funzione non disponibile su questo browser.');
  }
}

function recoveryCard(m) {
  return h('div', { class: 'card card-warn' },
    h('strong', {}, `Registrazione interrotta: «${m.title}»`),
    h('p', { class: 'small' }, 'L\'app si è chiusa senza Stop (Safari chiuso, telefono spento o memoria piena). L\'audio salvato fino a quel momento e tutti i tocchi sono al sicuro.'),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: `#/rec/${m.id}` }, 'Riprendi'),
      h('button', {
        class: 'btn secondary',
        type: 'button',
        onclick: async () => {
          await finalizeInterrupted(m, { stop: true });
          location.hash = `#/timeline/${m.id}`;
        },
      }, 'Chiudi e salva')));
}

function meetingRow(m) {
  const bytes = (m.parts ?? []).reduce((acc, p) => acc + (p.deleted ? 0 : p.bytes || 0), 0);
  return h('li', { class: 'item' },
    h('a', { class: 'item-main', href: `#/timeline/${m.id}` },
      h('strong', {}, m.title),
      h('span', { class: 'muted small' },
        `${fmtDateTime(m.startedAt || m.createdAt)} · ${fmtTime(m.endSec || 0)} · ${m.participants.length} persone · ${bytes ? fmtBytes(bytes) : m.externalAudio ? 'audio con altra app' : 'senza audio'}`)),
    h('a', { class: 'btn small secondary', href: `#/export/${m.id}` }, 'Esporta'));
}

function installHint() {
  return h('details', { class: 'card hint' },
    h('summary', {}, 'Installa come app sull\'iPhone'),
    h('ol', { class: 'small' },
      h('li', {}, 'In Safari tocca il pulsante Condividi (quadrato con la freccia).'),
      h('li', {}, 'Scegli «Aggiungi alla schermata Home» e conferma.'),
      h('li', {}, 'Da quel momento apri ChiParla dall\'icona: funziona anche senza internet.')),
    h('p', { class: 'small' }, h('strong', {}, 'Importante: '),
      'l\'app sulla Home ha un archivio separato da Safari. Le riunioni registrate qui in Safari non compaiono nell\'app e viceversa: scegli una delle due e usa sempre quella.'));
}
