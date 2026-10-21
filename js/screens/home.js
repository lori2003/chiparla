// Schermata iniziale: nuova riunione, riunioni salvate, recupero di registrazioni interrotte.

import { h, toast, confirmDialog, promptDialog } from '../ui.js';
import * as db from '../db.js';
import { session, finalizeInterrupted } from '../session.js';
import { isBackedUp, restoreBackup } from '../backup.js';
import { fmtDateTime, fmtTime, fmtBytes } from '../util.js';
import { browserInfo, appVersion, isIOS } from '../env.js';
import { forceUpdate } from '../update.js';

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const meetingBytes = (m) => (m.parts ?? []).reduce((acc, p) => acc + (p.deleted ? 0 : p.bytes || 0), 0);

export async function renderHome(root) {
  const [meetings, storage] = await Promise.all([db.getAllMeetings(), db.storageInfo()]);
  meetings.sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt));
  const interrupted = meetings.filter((m) => m.status === 'recording' && !(session.active && session.meeting?.id === m.id));
  const saved = meetings.filter((m) => m.status !== 'recording' && !m.deletedAt);
  const trash = meetings.filter((m) => m.status !== 'recording' && m.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  const unsafe = saved.filter((m) => !isBackedUp(m));
  const env = browserInfo();
  const versionEl = h('span', {}, '…');
  appVersion().then((v) => { versionEl.textContent = v; });

  root.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('h1', { class: 'brand' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }), 'ChiParla'),
      h('div', { class: 'topbar-actions' },
        session.active ? null : updateButton(),
        h('a', { class: 'btn ghost small', href: '#/diagnostica' }, 'Diagnostica'))),
    session.active
      ? h('a', { class: 'banner banner-rec', href: `#/rec/${session.meeting.id}` }, '● Registrazione in corso: torna alla registrazione')
      : null,
    interrupted.map(recoveryCard),
    h('a', { class: 'btn primary xl', href: '#/nuova' }, '＋ Nuova riunione'),
    isIOS() && !env.standalone ? installHint() : null,
    isIOS() && env.standalone ? standaloneHint() : null,
    unsafe.length ? h('div', { class: 'card card-warn small' },
      h('strong', {}, `⚠ ${unsafe.length === 1 ? '1 riunione senza backup' : `${unsafe.length} riunioni senza backup`}. `),
      'Finché non salvi il backup in File, iCloud o sul computer, esiste solo dentro Safari, che può cancellare i dati dei siti. Tocca «Backup» sulla riunione.') : null,
    h('h2', { class: 'section-title' }, 'Riunioni salvate'),
    saved.length
      ? h('ul', { class: 'list' }, saved.map(meetingRow))
      : h('p', { class: 'muted' }, 'Nessuna riunione. Audio e timeline restano solo su questo telefono: nulla viene inviato a server.'),
    restoreButton(),
    trash.length ? trashCard(trash) : null,
    h('footer', { class: 'footer muted small' },
      h('p', {}, `Spazio usato: ${storage.usage != null ? fmtBytes(storage.usage) : 'n.d.'}`
        + `${storage.quota ? ` su ${fmtBytes(storage.quota)} disponibili` : ''}`),
      h('p', {}, `Archivio protetto dalla pulizia automatica: ${storage.persisted ? 'sì' : 'non garantito'} `,
        storage.persisted ? null : h('button', { class: 'link', type: 'button', onclick: askPersist }, 'richiedi')),
      h('p', {}, `Aperta come: ${env.standalone ? 'app dalla schermata Home' : 'pagina di Safari'} · versione `, versionEl))));
}

// Scarica e installa subito l'ultima versione pubblicata (mai durante una registrazione)
function updateButton() {
  const btn = h('button', {
    type: 'button',
    class: 'btn small secondary',
    onclick: async () => {
      if (session.active) { toast('Non si aggiorna durante una registrazione: prima premi Stop.'); return; }
      const ok = await confirmDialog('Passare all\'ultima versione?',
        'ChiParla scarica di nuovo tutti i suoi file e si riavvia. Riunioni, audio, backup e impostazioni restano dove sono: non vengono toccati. Senza internet non cambia nulla.',
        { ok: 'Aggiorna ora' });
      if (!ok) return;
      btn.disabled = true;
      try {
        await forceUpdate({ onStep: (t) => { btn.textContent = t; } });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '⟳ Ultima versione';
        toast(e?.message || String(e), { ms: 6000 });
      }
    },
  }, '⟳ Ultima versione');
  return btn;
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
  const bytes = meetingBytes(m);
  return h('li', { class: 'item' },
    h('a', { class: 'item-main', href: `#/timeline/${m.id}` },
      h('strong', {}, m.title),
      h('span', { class: 'muted small' },
        `${fmtDateTime(m.startedAt || m.createdAt)} · ${fmtTime(m.endSec || 0)} · ${m.participants.length} persone · ${bytes ? fmtBytes(bytes) : m.externalAudio ? 'audio con altra app' : 'senza audio'}`),
      isBackedUp(m)
        ? h('span', { class: 'badge ok' }, `✓ backup del ${fmtDateTime(m.backupAt)}`)
        : h('span', { class: 'badge warn' }, '⚠ nessun backup')),
    h('a', { class: `btn small ${isBackedUp(m) ? 'secondary' : 'primary'}`, href: `#/export/${m.id}` }, isBackedUp(m) ? 'Esporta' : 'Backup'),
    h('button', { type: 'button', class: 'btn small ghost icon-only', 'aria-label': `Elimina «${m.title}»`, onclick: () => moveToTrash(m) }, '🗑'));
}

// ---------- eliminazione in due passi: prima nel cestino, poi (solo a mano) per sempre ----------

async function moveToTrash(m) {
  const ok = await confirmDialog(`Spostare «${m.title}» nel cestino?`,
    'Audio e timeline restano sul telefono e si possono ripristinare dal cestino in fondo alla Home. Nulla viene cancellato finché non lo elimini dal cestino.',
    { ok: 'Sposta nel cestino', danger: true });
  if (!ok) return;
  m.deletedAt = Date.now();
  await db.putMeeting(m);
  toast('Spostata nel cestino', {
    action: 'Annulla',
    onAction: async () => { delete m.deletedAt; await db.putMeeting(m); rerender(); },
  });
  rerender();
}

async function restoreFromTrash(m) {
  delete m.deletedAt;
  await db.putMeeting(m);
  toast(`«${m.title}» ripristinata`);
  rerender();
}

// Cancellazione definitiva: se non esiste un backup va scritto ELIMINA, per non farlo per sbaglio
export async function confirmForever(list) {
  const unsafe = list.filter((m) => !isBackedUp(m));
  const what = list.length === 1 ? `«${list[0].title}»` : `${list.length} riunioni`;
  if (!unsafe.length) {
    return confirmDialog(`Eliminare per sempre ${what}?`, 'Audio, timeline e note verranno cancellati da questo telefono. Il backup che hai salvato resta valido per ripristinarle.',
      { ok: 'Elimina per sempre', danger: true });
  }
  const v = await promptDialog(`Eliminare per sempre ${what}?`, {
    placeholder: 'ELIMINA',
    ok: 'Elimina per sempre',
    hint: `⚠ ${unsafe.length === 1 ? 'Questa riunione non ha' : `${unsafe.length} di queste riunioni non hanno`} un backup: dopo non si potranno più recuperare in nessun modo. Per confermare scrivi ELIMINA.`,
  });
  if (v == null) return false;
  if (v.trim().toUpperCase() !== 'ELIMINA') { toast('Non eliminata: bisognava scrivere ELIMINA'); return false; }
  return true;
}

async function deleteForever(list) {
  if (!await confirmForever(list)) return;
  for (const m of list) await db.deleteMeeting(m.id);
  toast(list.length === 1 ? 'Eliminata per sempre' : `${list.length} riunioni eliminate per sempre`);
  rerender();
}

function trashCard(trash) {
  const bytes = trash.reduce((acc, m) => acc + meetingBytes(m), 0);
  return h('details', { class: 'card trash' },
    h('summary', {}, `🗑 Cestino (${trash.length}${bytes ? ` · ${fmtBytes(bytes)}` : ''})`),
    h('p', { class: 'small muted' }, 'Le riunioni nel cestino non vengono mai cancellate da sole: restano finché non le elimini qui.'),
    h('ul', { class: 'list' }, trash.map((m) => h('li', { class: 'item' },
      h('div', { class: 'item-main' },
        h('strong', {}, m.title),
        h('span', { class: 'muted small' }, `${fmtDateTime(m.startedAt || m.createdAt)} · ${fmtTime(m.endSec || 0)} · nel cestino dal ${fmtDateTime(m.deletedAt)}`),
        isBackedUp(m) ? h('span', { class: 'badge ok' }, '✓ con backup') : h('span', { class: 'badge warn' }, '⚠ nessun backup')),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => restoreFromTrash(m) }, 'Ripristina'),
      h('button', { type: 'button', class: 'btn small danger', onclick: () => deleteForever([m]) }, 'Elimina')))),
    trash.length > 1 ? h('button', { type: 'button', class: 'btn small danger', onclick: () => deleteForever(trash) }, 'Svuota il cestino') : null);
}

// ---------- ripristino da un file di backup ----------

function restoreButton() {
  const input = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn secondary', onclick: () => input.click() }, '⤒ Ripristina un backup (.zip)');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    btn.disabled = true;
    try {
      const m = await restoreBackup(file, {
        onProgress: (what, f) => { btn.textContent = `${what} ${Math.round((f || 0) * 100)}%`; },
      });
      toast(`Riunione «${m.title}» ripristinata`);
      location.hash = `#/timeline/${m.id}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '⤒ Ripristina un backup (.zip)';
      toast(`Ripristino non riuscito: ${e?.message || e}`, { ms: 8000 });
    }
  });
  return h('div', { class: 'row restore-row' }, btn, input,
    h('span', { class: 'muted small' }, 'Il file creato con «Backup completo»: la riunione torna con audio, timeline e testo.'));
}

function installHint() {
  return h('details', { class: 'card hint' },
    h('summary', {}, 'Icona sulla schermata Home'),
    h('p', { class: 'small' }, 'La trascrizione in diretta funziona solo in Safari. Per avere comunque un\'icona:'),
    h('ol', { class: 'small' },
      h('li', {}, 'In Safari tocca Condividi (quadrato con la freccia) → «Aggiungi alla schermata Home».'),
      h('li', {}, 'Disattiva «Apri come app web» (iOS 26 e successivi), poi «Aggiungi»: l\'icona aprirà ChiParla in Safari, con la trascrizione.'),
      h('li', {}, 'Funziona anche senza internet; la trascrizione però di solito richiede internet.')),
    h('p', { class: 'small' }, h('strong', {}, 'Nota: '),
      'se la aggiungi come app web ha un archivio separato da Safari (le riunioni non si vedono da una all\'altra) e niente trascrizione in diretta.'));
}

// Aperta dall'icona come app web: tutto funziona tranne la trascrizione in diretta
function standaloneHint() {
  const url = location.href.split('#')[0].split('?')[0];
  return h('div', { class: 'card card-warn small' },
    h('strong', {}, 'Qui la trascrizione in diretta non funziona. '),
    'iOS la consente solo in Safari: apri ',
    h('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace(/^https?:\/\//, '')),
    ' in Safari. Le riunioni già registrate in questa app restano qui (l\'archivio è separato): esportale da qui.');
}
