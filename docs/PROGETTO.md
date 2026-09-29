# ChiParla – progetto

Indice: [1. Vincoli e scelte](#1-vincoli-e-scelte-tecniche) · [2. Architettura](#2-architettura) · [3. Flusso utente](#3-flusso-utente) · [4. Wireframe](#4-wireframe) · [5. Struttura dei dati](#5-struttura-dei-dati) · [6. Cartelle e codice](#6-cartelle-e-codice) · [7. IndexedDB](#7-indexeddb) · [8. Registrazione audio](#8-registrazione-audio) · [9. Sistema dei tempi](#9-sistema-dei-tempi-speaker) · [10. Esportazioni](#10-esportazioni) · [11. Funzioni future](#11-funzioni-future-dopo-lmvp)

GitHub Pages, PWA e installazione: [PUBBLICAZIONE.md](PUBBLICAZIONE.md). Limiti di iPhone: [LIMITI-IPHONE.md](LIMITI-IPHONE.md). Prove: [TEST.md](TEST.md).

---

## 1. Vincoli e scelte tecniche

| Vincolo | Scelta |
|---|---|
| Costo zero, niente server | Sito statico su GitHub Pages; nessuna chiamata a servizi esterni |
| Dati solo sul telefono | IndexedDB per riunioni, eventi e audio; localStorage solo per impostazioni e nomi recenti |
| Uso da iPhone, una mano | Pulsanti grandi, azioni in basso (zona del pollice), schermata di registrazione scura e senza scorrimento |
| Niente AI integrata | L'app produce solo AUDIO + TIMELINE + NOTE; l'AI la scegli tu dopo |
| Robustezza | Salvataggio a pezzi ogni 5 s, ogni tocco salvato subito, recupero dopo chiusura, verifica finale dell'audio |

**Perché JavaScript puro e niente framework.** L'app ha 4 schermate e uno stato piccolo. React/Vue/Vite porterebbero una fase di compilazione, dipendenze npm da aggiornare e un passaggio in più per pubblicare, senza vantaggi concreti a questa scala. Con i moduli ES nativi (supportati da Safari da anni) si modifica un file, si fa commit e GitHub Pages lo pubblica così com'è. Un framework avrebbe senso se l'interfaccia crescesse molto (molte schermate, più persone a svilupparla). TypeScript si può aggiungere in futuro senza cambiare la pubblicazione: commenti JSDoc + controllo con `tsc --checkJs`.

**Perché MediaRecorder** (e non Web Audio + WAV). MediaRecorder usa l'encoder AAC nativo di iOS: file piccoli (~29 MB/ora a 64 kbps), poca CPU e batteria. Registrare in WAV con Web Audio richiederebbe ~115 MB/ora e codice più fragile su iOS.

---

## 2. Architettura

```
                    GitHub Pages (solo file statici: html, css, js, icone)
                                   │  prima apertura / aggiornamenti
                                   ▼
┌──────────────────────────── iPhone: Safari o app dalla Home ─────────────────────────────┐
│                                                                                           │
│  Service worker (sw.js) ── cache dell'interfaccia → funziona offline                      │
│                                                                                           │
│  Schermate (js/screens)            Logica pura (testata)          Piattaforma              │
│  ┌─────────────┐  eventi   ┌──────────────────┐            ┌──────────────────────────┐  │
│  │ record.js   │──────────▶│ session.js       │───────────▶│ getUserMedia + MediaRec. │  │
│  │ setup/home  │◀──stato───│ (registrazione,  │◀─ pezzi ───│ (microfono → AAC/fMP4)   │  │
│  │ edit/export │           │  controlli,      │  ogni 5 s  └──────────────────────────┘  │
│  │ diag        │           │  ripresa)        │───────────▶ Wake Lock, Web Audio (livello)│
│  └─────┬───────┘           └────────┬─────────┘                                          │
│        │                            │ scrive subito                                       │
│        ▼                            ▼                                                     │
│  timeline.js, exporters.js   db.js ─ IndexedDB: meetings · events · chunks               │
│  mp4.js, audio.js            (verifica e ricostruzione dei file audio)                    │
│        │                                                                                  │
│        ▼                                                                                  │
│  File .m4a · .md · .json · .csv · .txt ──▶ Condividi (Salva su File / AirDrop / Mail)     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

| Modulo | Ruolo |
|---|---|
| `app.js` | router a hash (`#/`, `#/nuova`, `#/rec/<id>`, `#/timeline/<id>`, `#/export/<id>`, `#/diagnostica`); durante la registrazione blocca la navigazione sulla schermata REC; registra il service worker e propone gli aggiornamenti solo quando non si registra |
| `session.js` | sessione di registrazione: microfono, parti audio, salvataggio dei pezzi, eventi, controllo ogni secondo (pezzi che arrivano, microfono sospeso, silenzio, schermo), ripresa, rotazione dei file, recupero dopo chiusura |
| `recorder.js` | scelta del formato, vincoli del microfono, `PartRecorder` (una istanza di MediaRecorder = un file) |
| `db.js` | IndexedDB con riconnessione automatica e ripiego Blob → ArrayBuffer |
| `timeline.js` | tocchi → interventi, tempo di parola, intervalli in background, verifica allineamento, spostamento tempi |
| `exporters.js` | JSON, CSV, TXT, Markdown per AI, nomi dei file |
| `mp4.js` | legge le strutture MP4 frammentate di Safari: formato recuperabile?, durata reale, salti nei tempi |
| `audio.js` | ricompone i file dai pezzi, misura la durata, salva i risultati della verifica |
| `wakelock.js`, `level.js`, `haptics.js` | schermo acceso, livello del microfono, vibrazione (dove possibile) |

---

## 3. Flusso utente

```
Home ──▶ Nuova riunione ──(Avvia: permesso microfono la prima volta)──▶ Registrazione
 ▲  ▲                                                                   │  tocchi sui nomi
 │  │                                                                   │  Annulla · Nota · ★
 │  │   Safari chiuso per errore / telefono spento                      │
 │  └── Home mostra «Registrazione interrotta» ◀─────────────────────────┤
 │         ├─ Riprendi ─────────▶ Registrazione (nuovo file audio, buco segnato)
 │         └─ Chiudi e salva ─┐                                         │ Stop (con conferma)
 │                            ▼                                         ▼
 └──────────── Esporta ◀──── Timeline: verifica audio, ascolto, correzioni
```

Durante la registrazione:

```
tocco su un nome ──▶ evento {speaker, t} salvato ──▶ pulsante colorato + "Sta parlando: …" + vibrazione*
schermo bloccato / altra app ──▶ evento "app nascosta" ──▶ al ritorno: controllo microfono
        └─ microfono chiuso da iOS? ──▶ ripresa automatica in un nuovo file (o pulsante «Riprendi»)
ogni 5 s ──▶ pezzo di audio su IndexedDB ("💾 salvato 2 s fa")
```
\* la vibrazione su iPhone non è garantita (vedi limiti).

---

## 4. Wireframe

Tutte le schermate sono pensate per un iPhone tenuto con una mano: le azioni frequenti stanno in basso.

**Home**
```
┌───────────────────────────────┐
│ ● ChiParla        Diagnostica │
│ ┌───────────────────────────┐ │
│ │⚠ Registrazione interrotta │ │  ← solo dopo una chiusura improvvisa
│ │ [Riprendi] [Chiudi e salva]│ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │      ＋ Nuova riunione     │ │
│ └───────────────────────────┘ │
│ Riunioni salvate              │
│ ┌───────────────────────────┐ │
│ │ Comitato       [Esporta]  │ │
│ │ 28/09 10:30 · 01:10:23    │ │
│ └───────────────────────────┘ │
│ Spazio usato · versione       │
└───────────────────────────────┘
```

**Schermata 1 – Nuova riunione**
```
┌───────────────────────────────┐
│ ‹ Indietro     Nuova riunione │
│ Titolo                        │
│ [Riunione 28/09/2026 10:30  ] │
│ Partecipanti                  │
│ [Nome, anche più…] [Aggiungi] │
│ ▌● Marco                  ✕   │  ← tocco sul pallino: cambia colore
│ ▌● Giulia             ↑   ✕   │  ← tocco sul nome: rinomina
│ ▌● Luca               ↑   ✕   │
│ Recenti: [＋Anna] [＋Paolo]    │
│ ▸ Impostazioni registrazione  │
│                               │
│ ┌───────────────────────────┐ │
│ │   🎙 Avvia registrazione   │ │
│ └───────────────────────────┘ │
└───────────────────────────────┘
```

**Schermata 2 – Registrazione** (sempre scura, niente scorrimento)
```
┌───────────────────────────────┐
│ ● REC     00:12:34        ＋  │  ← timer grande; ＋ = persona arrivata dopo
│ 💾 salvato 2 s fa ☀ acceso ▮▮▮ │  ← salvataggio, schermo, livello microfono
│ ⚠ avvisi solo se servono [Azione]│
│ ┌───────────────────────────┐ │
│ │STA PARLANDO Giulia da 1:23│ │  ← nel colore di Giulia
│ └───────────────────────────┘ │
│ ┌────────────┐ ┌────────────┐ │
│ │            │ │████████████│ │
│ │   Marco    │ │██ Giulia ██│ │  ← attivo = pieno + "PARLA"
│ │            │ │████████████│ │
│ └────────────┘ └────────────┘ │
│ ┌────────────┐ ┌────────────┐ │
│ │    Luca    │ │    Anna    │ │
│ └────────────┘ └────────────┘ │
│[↶ Annulla][✎ Nota][★ Import.][■ Stop]│
└───────────────────────────────┘
```
Da 1 a 3 persone: pulsanti a tutta larghezza; da 4 a 8: due colonne; oltre: tre colonne.

**Schermata 3 – Timeline modificabile**
```
┌───────────────────────────────┐
│ ‹ Home     Comitato   Esporta›│
│ 28/09 · durata 01:10:23 · 42 interventi │
│ ✓ File audio 01:10:21 · allineato       │  ← verifica automatica
│ ▶ ━━━━●━━━━━━━━  00:12:04      │  ← lettore, resta in alto
│ [＋ Evento] [⇆ Sposta tempi] ☐ tecnici  │
│ [00:00:00] ● Marco  → 00:01:42 · 1:42 ▶ │
│ [00:01:35] ✎ Decidere il budget       ▶ │
│ [00:01:42] ● Giulia → 00:03:15 · 1:33 ▶ │
│ [00:02:00] ★ Momento importante       ▶ │
│ Partecipanti e tempo di parola          │
│ Marco ▇▇▇▇▇▇▇▇▇  32:10 · 46% · 18×     │
│ ┌───────────────────────────┐ │
│ │      Esporta i file ›     │ │
│ └───────────────────────────┘ │
└───────────────────────────────┘
Tocco su un evento → «Modifica evento»:
  Momento [00:01:42.4] [−5 s][−1 s][+1 s][+5 s][⏱ Posizione audio]
  Tipo    [Chi parla | ✎ Nota | ★ Importante]
  Chi     [Marco] [Giulia] [Luca]
  [Elimina]                 [Annulla] [Salva]
```

**Schermata 4 – Esporta**
```
┌───────────────────────────────┐
│ ‹ Timeline        Esporta     │
│ Comitato · 01:10:23 · 3 persone · 42 interventi │
│ ▸ ⚠ avvisi sulla registrazione (se ci sono)     │
│ ┌───────────────────────────┐ │
│ │  ⬆ Condividi tutti i file │ │  ← Salva su File / AirDrop / Mail
│ └───────────────────────────┘ │
│ 🎧 Audio · 28,4 MB  [Condividi] [Scarica] │
│ 🤖 Markdown per AI  [Condividi] [Scarica] │
│ { } JSON            [Condividi] [Scarica] │
│ ▦ CSV               [Condividi] [Scarica] │
│ ≡ TXT               [Condividi] [Scarica] │
│ [Copia il Markdown]           │
│ ▸ Anteprima del Markdown      │
│ ▸ Libera spazio / elimina     │
└───────────────────────────────┘
```

**Diagnostica**: funzioni disponibili su questo iPhone, spazio, e una «prova di registrazione» che misura salvataggio a pezzi, formato, durata reale e comportamento con schermo bloccato.

---

## 5. Struttura dei dati

### Riunione (store `meetings`)
```json
{
  "id": "rmul9n7ho-076a90b5",
  "title": "Comitato di settembre",
  "createdAt": 1790601000000,
  "startedAt": 1790601012345,
  "status": "stopped",
  "endSec": 4223.4,
  "participants": [
    { "id": "pmul9n0qq-474f5e7e", "name": "Marco", "color": "#E53935" }
  ],
  "parts": [
    {
      "n": 1, "startSec": 0, "endSec": 4223.4,
      "mimeType": "audio/mp4;codecs=mp4a.40.2", "ext": "m4a",
      "bytes": 30512345, "chunks": 845, "status": "done", "container": "fmp4",
      "audioDurSec": 4223.1, "audioSpanSec": 4223.1, "audioGaps": [], "audioCheckedAt": 1790605300000
    }
  ],
  "settings": { "bitrate": 64000, "timesliceMs": 5000, "rotateMin": 0, "processing": false },
  "corrections": []
}
```
- `status`: `recording` (in corso o interrotta da una chiusura improvvisa) → `stopped`.
- `startedAt`: istante (orologio del telefono) in cui il registratore è davvero partito: è lo zero della timeline.
- `parts`: ogni parte è un file audio. `startSec`/`endSec` sono in tempo riunione. Stati: `recording`, `done`, `interrupted` (iOS ha chiuso il microfono), `recovered` (ricostruita dopo una chiusura improvvisa).
- `audioDurSec` / `audioSpanSec` / `audioGaps`: risultati della verifica finale (durata dei campioni audio, estensione dei tempi nel file, salti).

### Evento (store `events`)
```json
{ "id": "e…", "meetingId": "r…", "type": "speaker", "t": 102.37, "speakerId": "p…", "createdAt": 1790601114715 }
{ "id": "e…", "meetingId": "r…", "type": "note",    "t": 95.2,   "text": "Decidere il budget", "createdAt": … }
{ "id": "e…", "meetingId": "r…", "type": "mark",    "t": 120.4,  "text": "", "createdAt": … }
{ "id": "e…", "meetingId": "r…", "type": "sys",     "t": 1200.1, "kind": "hidden", "text": "App non visibile …", "createdAt": … }
```
`t` = secondi dall'inizio della riunione. I `sys` registrano ciò che succede al sistema: `start`, `part-start`, `hidden`/`visible`, `mute`/`unmute`, `ended`, `recorder-stop`, `error`, `device`, `container`, `stop`.

### Pezzo di audio (store `chunks`)
```json
{ "meetingId": "r…", "part": 1, "seq": 17, "data": "<Blob audio/mp4>", "size": 40123, "at": 1790601100000 }
```
Chiave `[meetingId, part, seq]`: i pezzi di un file si leggono già in ordine.

### Impostazioni (localStorage)
`chiparla.settings.v1` (qualità, divisione in file, riduzione rumore, vibrazione, indicatore) e `chiparla.recentNames.v1` (ultimi 30 nomi usati).

---

## 6. Cartelle e codice

La struttura completa è nel [README](../README.md#struttura). Tutti i file sono serviti così come sono: nessuna compilazione. Punti di ingresso:

- `index.html` carica `css/app.css` e `js/app.js` (modulo ES).
- `js/app.js` sceglie la schermata in base all'hash dell'indirizzo.
- La logica senza interfaccia (`timeline.js`, `exporters.js`, `mp4.js`, `util.js`) non tocca il DOM ed è coperta dai test in `tests/`.

---

## 7. IndexedDB

- Database `chiparla`, versione 1, tre store: `meetings` (chiave `id`), `events` (chiave `id`, indice `meetingId`), `chunks` (chiave composta `[meetingId, part, seq]`).
- **Ogni pezzo di audio viene scritto insieme allo stato della riunione nella stessa transazione**: se Safari si chiude, ciò che è su disco è sempre coerente (numero di pezzi, byte, ultimo salvataggio).
- **Ogni tocco viene scritto subito** (una transazione per evento).
- **Riconnessione**: su iOS la connessione a IndexedDB può chiudersi dopo il background ("Connection to Indexed Database server lost"); `db.js` riapre il database e ripete l'operazione una volta.
- **Blob o ArrayBuffer**: i pezzi si salvano come Blob (su disco, senza occupare RAM); se una versione di Safari rifiuta i Blob, si ripiega su ArrayBuffer.
- **Spazio**: `navigator.storage.estimate()` in Home e Diagnostica; `navigator.storage.persist()` viene chiesto all'avvio della registrazione (Safari lo concede soprattutto alle app aggiunte alla Home).
- **Se la scrittura fallisce** (spazio pieno), i pezzi restano in memoria, compare un avviso rosso e allo Stop l'app riprova a salvarli; l'esportazione li include comunque finché la pagina resta aperta.
- **Pulizia**: dalla schermata Esporta si può eliminare solo l'audio o l'intera riunione (non esiste un cestino).

---

## 8. Registrazione audio

1. **Formato**: si prova in ordine `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`. Su iPhone si ottiene AAC in MP4 frammentato → file `.m4a`, il più compatibile con lettori e servizi di trascrizione.
2. **Microfono**: `echoCancellation`, `noiseSuppression`, `autoGainControl` disattivati di default (quelle elaborazioni sono pensate per le chiamate e tendono ad abbassare le voci lontane dal telefono); si possono attivare nelle impostazioni.
3. **Qualità**: 64 kbps mono (~29 MB/ora) di default; 96 o 128 kbps a scelta.
4. **Salvataggio a pezzi**: `MediaRecorder.start(5000)` → ogni ~5 s un pezzo (`dataavailable`) che viene scritto subito su IndexedDB. Safari produce MP4 frammentato: un'intestazione iniziale (`ftyp` + `moov`) e poi coppie `moof` + `mdat`. Concatenando i pezzi salvati si ottiene un file valido anche se la registrazione è stata interrotta a metà (verificato in automatico con `mp4.js` e dalla prova in Diagnostica).
5. **Controllo del formato**: al primo pezzo `detectContainer()` verifica che l'intestazione venga prima dei dati. Se un browser producesse un MP4 classico (indice scritto solo alla fine, quindi illeggibile dopo un crash), l'app passa automaticamente a file da 10 minuti per limitare la perdita.
6. **Parti (file audio)**: si apre una nuova parte quando si riprende dopo una chiusura improvvisa, quando iOS chiude il microfono, con «Riavvia microfono», oppure ogni N minuti se lo si imposta. Nella divisione programmata il nuovo registratore parte prima che il vecchio si fermi: nessun buco.
7. **Controlli ogni secondo** (solo con l'app visibile): arrivano i pezzi? il microfono è sospeso (`muted`) o chiuso (`ended`)? c'è silenzio assoluto da 20 s? lo schermo è tenuto acceso? Ogni problema diventa un avviso nella schermata REC, con il pulsante per risolverlo quando serve (Riprendi, Riavvia microfono, Tieni acceso).
8. **Schermo e background**: il Wake Lock tiene lo schermo acceso; `visibilitychange` registra quando l'app sparisce e torna. Al ritorno l'app riattiva il Wake Lock, controlla il microfono e, se iOS l'ha chiuso, riprende in un nuovo file.
9. **Verifica finale**: aprendo la timeline, `mp4.js` legge ogni file (a finestre da 512 KB, senza caricarlo tutto in memoria) e ricava la durata vera dell'audio sommando le durate dei campioni, più eventuali salti nei tempi. Il confronto con il tempo trascorso dice se timeline e audio sono allineati.
10. **Stop**: attende l'ultimo pezzo (con un limite di 5 s, perché su alcune versioni di iOS l'evento `stop` può mancare), spegne il microfono (sparisce il pallino arancione) e rilascia il Wake Lock.

---

## 9. Sistema dei tempi (speaker)

**Orologio.** Lo zero è l'istante in cui MediaRecorder parte davvero (evento `start` del primo file). Ogni tocco salva `t = (istante del tocco − inizio) / 1000`. L'istante è preso quando il dito **tocca** il pulsante (`pointerdown`), non quando si solleva: ~0,1 s più preciso. I secondi sono salvati al millisecondo; nelle esportazioni sono arrotondati al decimo.

**Dai tocchi agli interventi** (`buildSegments`):
1. si ordinano gli eventi `speaker` per tempo;
2. si taglia la riunione in intervalli ai tempi dei tocchi e ai confini dei file audio;
3. ogni intervallo appartiene all'ultimo speaker toccato; intervalli consecutivi dello stesso speaker si uniscono;
4. un tratto iniziale senza speaker più corto di 3 s (il tempo di reazione per il primo tocco) viene attribuito al primo speaker; se è più lungo resta «(nessuno indicato)»;
5. gli intervalli senza audio registrato (fra due file) restano nella timeline con `audio_part: null`.

```
tocchi:  0 Marco · 102 Giulia · 195 Luca · 307 Marco · Stop a 400
         └──────────┴───────────┴────────────┴──────────┘
segmenti: Marco 0→102 · Giulia 102→195 · Luca 195→307 · Marco 307→400
```

**Correzioni**: Annulla (ultimo tocco fatto, anche dopo un riavvio dell'app), modifica persona e tempo (con ±1/±5 s e «posizione audio» dal lettore), eliminazione con possibilità di annullare, aggiunta manuale, «Sposta tempi» (tutti i tocchi da un certo punto in poi di N secondi, per esempio −1 s per compensare il tempo di reazione).

**Allineamento dopo un'interruzione** (`driftCheck`): per ogni file si confronta la durata vera dell'audio con il tempo trascorso:
- differenza entro 2 s → ✓ allineato;
- audio più corto e differenza uguale al tempo in cui l'app è rimasta nascosta → quel tratto non è stato registrato e il file lo "salta": i tocchi successivi sono in ritardo rispetto all'audio. Il pulsante **Correggi i tempi** sposta indietro i tocchi successivi a ogni interruzione e registra la correzione nelle esportazioni;
- il file contiene salti nei tempi → i tempi restano corretti per i programmi che rispettano i salti; l'avviso lo spiega;
- differenza non spiegabile → avviso e strumento «Sposta tempi».

---

## 10. Esportazioni

Nome dei file: `AAAA-MM-GG_HHMM_titolo`. Con più file audio: `…_audio-parte1.m4a`, `…_audio-parte2.m4a`.

| File | Contenuto | Per chi |
|---|---|---|
| `…_audio.m4a` | l'audio (AAC) | AI / trascrizione / ascolto |
| `…_per-AI.md` | istruzioni per l'AI, timeline (anche per singolo file con tempi relativi), momenti importanti, note, tempo di parola, qualità della registrazione | ChatGPT, NotebookLM, … insieme all'audio |
| `….json` | tutto: riunione, partecipanti, file audio, `segments`, note, momenti, tempo di parola, eventi grezzi, avvisi, correzioni | script, altre AI |
| `….csv` | una riga per intervento, nota e momento importante (UTF-8 con BOM, separatore virgola) | Excel, fogli di calcolo |
| `….txt` | tocchi e interventi nel formato `00:01:42 → 00:03:15 \| Giulia` | lettura veloce |

`segments` nel JSON segue il formato richiesto, più `audio_part` (il file audio di riferimento):
```json
[
  { "speaker": "Marco",  "start_seconds": 0,   "end_seconds": 102, "start": "00:00:00", "end": "00:01:42", "audio_part": 1 },
  { "speaker": "Giulia", "start_seconds": 102, "end_seconds": 195, "start": "00:01:42", "end": "00:03:15", "audio_part": 1 }
]
```

Colonne CSV: `type,speaker,start,end,start_seconds,end_seconds,duration_seconds,audio_part,text` con `type` = `segment`, `note` o `highlight`. In Excel italiano aprilo da *Dati → Da testo/CSV* (il separatore è la virgola).

**Come usarli con un'AI**: carica l'audio e il file `_per-AI.md` nella stessa conversazione (ChatGPT) o come fonti dello stesso notebook (NotebookLM) e chiedi, per esempio: *«Trascrivi l'audio attribuendo le frasi secondo la timeline del file Markdown, poi fai sintesi, decisioni e azioni.»* Le istruzioni per l'AI sono già scritte dentro il Markdown.

**Consegna dei file su iPhone**: «Condividi» apre il foglio di condivisione di iOS (Salva su File, AirDrop, Mail, …) ed è la strada più affidabile, anche nell'app aggiunta alla Home. «Scarica» usa il download di Safari (cartella Download dell'app File).

---

## 11. Funzioni future (dopo l'MVP)

Tutte realizzabili restando gratuite e senza server:

1. **Backup e importazione** di una riunione (JSON + audio) per spostarla fra Safari e l'app da Home o su un altro telefono.
2. **Conversione locale in WAV/MP3** per i servizi che non accettano `.m4a`: su iOS 26 con WebCodecs (`AudioDecoder`), che decodifica a pezzi senza esaurire la memoria.
3. **Trascrizione nel telefono** con Whisper in WebAssembly (whisper.cpp o transformers.js): gratuita ma lenta e pesante su iPhone per riunioni lunghe; più realistica su computer.
4. **Script di allineamento** (Python o Node, sul computer): unisce la trascrizione con timestamp di Whisper e il `segments` del JSON per produrre «chi ha detto cosa» senza AI a pagamento.
5. Pulsante **«Più voci / Altro»** per sovrapposizioni e ospiti non in elenco.
6. **Compensazione automatica del tempo di reazione** (es. −1 s su ogni tocco) come impostazione.
7. **Categorie per i momenti**: decisione, azione, domanda, con esportazione dedicata.
8. **Forma d'onda** nella timeline per correggere i confini a colpo d'occhio.
9. **Promemoria di esportazione** per le riunioni non ancora esportate.
