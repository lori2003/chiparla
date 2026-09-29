# ChiParla

Web app per iPhone, **gratuita e senza server**: registri l'audio di una riunione, tocchi il nome di chi sta parlando e alla fine ottieni **audio + timeline degli interventi + note**, pronti da dare a un'AI (ChatGPT, NotebookLM, …) per sapere chi ha detto cosa.

- Tutto resta sull'iPhone (IndexedDB). GitHub Pages serve solo i file dell'app: nessun dato della riunione esce dal telefono finché non lo esporti tu.
- Nessuna API, nessun database, nessun abbonamento: costo zero.
- Installabile sulla schermata Home, funziona anche offline (anche in modalità aereo).
- HTML + CSS + JavaScript puro: nessun framework, nessuna compilazione.

## Come si usa

1. **Nuova riunione** → titolo e partecipanti (anche più nomi insieme: `Marco, Giulia, Luca`).
2. **Avvia registrazione** → timer grande, REC, nome di chi parla, pulsanti enormi con i nomi.
3. Quando cambia chi parla **tocchi il suo nome**. In basso: **Annulla**, **Nota**, **★ Importante**, **Stop**.
4. **Timeline** → ascolti l'audio, correggi persona e tempi, aggiungi o elimini eventi.
5. **Esporta** → audio `.m4a`, Markdown per AI, JSON, CSV, TXT → «Salva su File», AirDrop o Mail.

Esempio: i tocchi `00:00:00 Marco · 00:01:42 Giulia · 00:03:15 Luca · 00:05:07 Marco` diventano

```
00:00:00 → 00:01:42 | Marco
00:01:42 → 00:03:15 | Giulia
00:03:15 → 00:05:07 | Luca
00:05:07 → 00:06:40 | Marco
```

## Prima di usarla in una riunione vera

- **Tieni ChiParla aperta, in primo piano e con lo schermo acceso.** Con lo schermo bloccato o passando a un'altra app, iOS può sospendere il microfono di una pagina web e nessun sito può impedirlo. ChiParla tiene lo schermo acceso, segnala ogni interruzione, riparte in un nuovo file audio e a fine riunione controlla che audio e timeline siano allineati (e propone la correzione se non lo sono). Dettagli: [docs/LIMITI-IPHONE.md](docs/LIMITI-IPHONE.md).
- **Fai prima le prove in «Diagnostica»** sul tuo iPhone: ti dice che cosa succede davvero con il tuo modello e la tua versione di iOS, compreso lo schermo bloccato. Protocollo completo: [docs/TEST.md](docs/TEST.md).
- L'app aggiunta alla **schermata Home ha un archivio separato** da Safari: scegli una delle due e usa sempre quella.
- **Esporta dopo ogni riunione**: il telefono non è un archivio sicuro (Safari può cancellare i dati dei siti non usati da tempo).

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/PROGETTO.md](docs/PROGETTO.md) | architettura, flusso utente, wireframe, struttura dei dati, IndexedDB, registrazione audio, sistema dei tempi, esportazioni, funzioni future |
| [docs/PUBBLICAZIONE.md](docs/PUBBLICAZIONE.md) | GitHub Pages passo passo, aggiornamenti, installazione su iPhone, configurazione PWA |
| [docs/LIMITI-IPHONE.md](docs/LIMITI-IPHONE.md) | limiti reali di Safari/iOS (schermo bloccato, background, registrazioni lunghe, …) e come li gestisce l'app |
| [docs/TEST.md](docs/TEST.md) | prove da fare prima di una riunione vera e checklist per ogni riunione |

## Struttura

```
chiparla/
├── index.html              pagina unica dell'app
├── manifest.webmanifest    configurazione PWA (nome, icone, schermo intero)
├── sw.js                   service worker: cache per l'uso offline
├── .nojekyll               GitHub Pages serve i file così come sono
├── css/app.css             stile (pensato per iPhone, una mano)
├── icons/                  icone per schermata Home e manifest
├── js/
│   ├── app.js              avvio, navigazione fra schermate, aggiornamenti
│   ├── session.js          registrazione: pezzi di audio, eventi, controlli, ripresa
│   ├── recorder.js         microfono e MediaRecorder
│   ├── db.js               IndexedDB (riunioni, eventi, pezzi di audio)
│   ├── timeline.js         dai tocchi agli interventi (logica pura, testata)
│   ├── exporters.js        JSON, CSV, TXT, Markdown per AI (logica pura, testata)
│   ├── mp4.js              lettura dei file MP4 di Safari: durata reale e salti
│   ├── audio.js            ricostruzione e verifica dei file audio
│   ├── wakelock.js · level.js · haptics.js · settings.js · env.js · ui.js · util.js
│   └── screens/            home, setup, record, edit (timeline), export, diag
├── tests/                  test automatici (node --test)
├── tools/serve.mjs         server locale per provarla sul computer
└── docs/                   documentazione
```

## Sviluppo sul computer

Serve solo [Node.js](https://nodejs.org/) (per test e server locale; GitHub Pages non ne ha bisogno).

```bash
npm test
```

```bash
node tools/serve.mjs
```

Poi apri `http://localhost:8080/?fakemic`: `?fakemic` sostituisce il microfono con un tono di prova, utile per provare il flusso sul PC. Sul computer il service worker legge sempre i file aggiornati; su GitHub Pages usa la cache (vedi [aggiornamenti](docs/PUBBLICAZIONE.md#4-pubblicare-un-aggiornamento)).

## Privacy

Nessun analytics, nessun cookie, nessuna richiesta verso servizi esterni. Il codice è pubblico (GitHub Pages gratuito richiede un repository pubblico), le tue registrazioni no: stanno solo nel tuo iPhone e nei file che esporti tu.
