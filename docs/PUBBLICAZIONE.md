# Pubblicazione su GitHub Pages, aggiornamenti e installazione su iPhone

GitHub Pages è gratuito e fornisce l'HTTPS obbligatorio per usare il microfono e il service worker. Serve solo i file dell'app: le registrazioni non passano mai da GitHub.

> **Nota:** con un account GitHub gratuito, Pages funziona solo con repository **pubblici**. Sarà visibile il codice dell'app, non i tuoi dati (che restano sull'iPhone).

## 1. Cosa pubblicare

Tutta la cartella del progetto, così com'è: `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, `css/`, `js/`, `icons/` (indispensabili) più `docs/`, `tests/`, `tools/`, `README.md`, `package.json` (utili, innocui online). Nessuna compilazione: GitHub Pages serve i file direttamente.

## 2. Primo caricamento

### Metodo A – solo dal browser (niente da installare)

1. Crea un account su [github.com](https://github.com) (gratuito) e accedi.
2. In alto a destra **+ → New repository**. Nome: `chiparla`. Visibilità: **Public**. Lascia **vuote** le opzioni "Add a README / .gitignore / license". **Create repository**.
3. Nella pagina del repository vuoto clicca il link **uploading an existing file**.
4. Da Esplora file apri la cartella del progetto (`chiparla`), seleziona **tutto il contenuto** (file e cartelle, non la cartella stessa) e trascinalo nella pagina. Attendi che compaiano tutti i file.
5. In basso **Commit changes**.
6. **Settings → Pages** (menu a sinistra). In *Build and deployment*: Source **Deploy from a branch**, Branch **main** e cartella **/ (root)** → **Save**.
7. Dopo 1-2 minuti in cima alla stessa pagina compare l'indirizzo: `https://TUO-UTENTE.github.io/chiparla/`. Se c'è l'opzione **Enforce HTTPS**, lasciala attiva.

### Metodo B – con git (il repository locale è già pronto con un primo commit)

Crea il repository vuoto su GitHub come ai punti 1-2, poi, dentro la cartella del progetto:

```bash
git remote add origin https://github.com/TUO-UTENTE/chiparla.git
```

```bash
git push -u origin main
```

Al primo push si apre il browser per l'accesso a GitHub (Git Credential Manager, incluso in Git per Windows). Poi attiva Pages come al punto 6.

### Metodo C – con GitHub CLI (`gh`), dentro la cartella del progetto

```bash
gh auth login
```

```bash
gh repo create chiparla --public --source . --push
```

```bash
gh api -X POST repos/TUO-UTENTE/chiparla/pages -f "source[branch]=main" -f "source[path]=/"
```

## 3. Installazione sull'iPhone

L'indirizzo di questa installazione è **https://lori2003.github.io/chiparla/**.

1. Apri **Safari** e vai all'indirizzo (con internet, la prima volta).
2. Per avere un'icona: tocca **Condividi** (quadrato con la freccia) → **Aggiungi alla schermata Home** (se non lo vedi, scorri l'elenco o tocca "Altro"). Su iOS 26 **disattiva «Apri come app web»**: così l'icona apre ChiParla in Safari, dove funziona la trascrizione in diretta. Tocca **Aggiungi**. (Su versioni precedenti di iOS l'icona apre sempre l'app web: in quel caso usa un segnalibro di Safari.)
3. Alla prima registrazione iOS chiede i permessi per il microfono e per il riconoscimento vocale: **Consenti**. Per non ripetere la domanda del microfono: *aA → Impostazioni sito web → Microfono → Consenti*.
4. Apri **Diagnostica** e fai le prove di [TEST.md](TEST.md).
5. La registrazione funziona anche senza internet (anche in modalità aereo); la trascrizione in diretta di solito richiede internet.

### Safari o app dalla Home?

Hanno **archivi separati**: le riunioni registrate in una non si vedono nell'altra. Scegline una.

| | Safari (scheda) | App dalla schermata Home |
|---|---|---|
| **Trascrizione in diretta** | **sì** | **no** (iOS la consente solo in Safari) |
| Schermo intero, senza barra di Safari | no | sì (meno tocchi accidentali) |
| Schermo sempre acceso (Wake Lock) | da iOS 16.4 | da **iOS 18.4** |
| Dati protetti dalla pulizia automatica di Safari | no (rischio se non apri il sito per molti giorni) | sì |
| Permesso microfono ricordato | sì, se imposti «Consenti» (aA → Impostazioni sito web → Microfono) | può essere richiesto a ogni apertura |
| Pulsante «Scarica» | funziona (cartella Download) | poco affidabile: usa «Condividi» |
| Registrazione con app in background o schermo bloccato | **non affidabile** | **non affidabile** |

**Consiglio:** usa **Safari** (anche tramite l'icona con «Apri come app web» disattivato), perché è l'unico modo per avere la trascrizione in diretta. Esporta dopo ogni riunione, così la pulizia automatica di Safari non è un problema. L'app web dalla Home ha senso solo se rinunci alla trascrizione in diretta (per esempio in modalità "solo timeline" con Memo Vocali).

## 4. Pubblicare un aggiornamento

1. Modifica i file.
2. In `sw.js` **aumenta `VERSION`** (es. `'1.0.0'` → `'1.0.1'`). È ciò che fa scaricare la nuova versione agli iPhone: senza, continuerebbero a usare la copia in cache.
3. Pubblica:
   - via web: nel repository **Add file → Upload files**, trascina i file modificati (sovrascrivono i precedenti) → **Commit changes**;
   - via git: `git add -A`, `git commit -m "descrizione"`, `git push`.
4. Attendi 1-2 minuti (scheda **Actions** del repository: "pages build and deployment" deve diventare verde).
5. Sull'iPhone apri l'app con internet: dopo qualche secondo compare **«Nuova versione disponibile – Aggiorna»**. L'app **non si aggiorna mai durante una registrazione**: il messaggio compare dopo lo Stop. Se non compare, chiudi del tutto l'app (scorri verso l'alto nel selettore app) e riaprila; GitHub Pages può tenere in cache i file fino a 10 minuti.

## 5. Configurazione PWA (cosa fa ogni pezzo)

**`manifest.webmanifest`**
- `name`, `short_name`: nome sotto l'icona.
- `start_url: "./"`, `scope: "./"`, `id: "./"`: percorsi relativi, così l'app funziona nella sottocartella `/chiparla/` di GitHub Pages.
- `display: "standalone"`: schermo intero senza barra del browser; `orientation: "portrait"`.
- `background_color`, `theme_color`: colore di avvio e della barra di stato.
- `icons`: 192 e 512 px più una versione *maskable* (con margine di sicurezza) per Android.

**`index.html`**
- `viewport-fit=cover` e margini `env(safe-area-inset-*)` nel CSS: niente contenuti sotto notch e barra Home.
- `apple-touch-icon` (180×180, senza trasparenza): l'icona che usa iOS.
- `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`: compatibilità con le versioni meno recenti di iOS.

**`sw.js` (service worker)**
- All'installazione mette in cache tutti i file dell'app (elenco `ASSETS`, scaricati con `cache: 'reload'` per non prendere copie vecchie). Il test `tests/pwa.test.mjs` controlla che nell'elenco non manchi nessun file.
- Online e offline risponde prima dalla cache (avvio immediato, funziona senza rete); sul computer (`localhost`) prima dalla rete, per vedere subito le modifiche.
- La cache ha il nome `chiparla-VERSION`: con una nuova versione quella vecchia viene cancellata.
- **Nessun aggiornamento automatico**: la nuova versione resta in attesa finché l'utente tocca «Aggiorna», che l'app mostra solo quando non si sta registrando (un ricaricamento a metà riunione interromperebbe la registrazione).
- I dati delle riunioni non passano dal service worker: stanno in IndexedDB.

**`.nojekyll`**: dice a GitHub Pages di pubblicare i file così come sono, senza elaborarli.
