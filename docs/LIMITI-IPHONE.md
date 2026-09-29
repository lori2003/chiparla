# Limiti reali di iPhone (Safari / iOS) e come li gestisce ChiParla

Questo documento dice le cose come stanno: dove una web app su iPhone è affidabile, dove no, e cosa fa l'app per ridurre i rischi senza server né servizi a pagamento. Valido per iOS 17-26; ogni aggiornamento di iOS può cambiare qualcosa, per questo l'app ha la schermata **Diagnostica** che misura il comportamento reale del tuo telefono (vedi [TEST.md](TEST.md)).

Legenda: ✅ affidabile · ⚠️ funziona con limiti · ❌ non affidabile

## In breve

| Tema | Valutazione | Soluzione in ChiParla |
|---|---|---|
| Schermo bloccato durante la registrazione | ❌ | schermo tenuto acceso (Wake Lock), rilevamento, ripresa, verifica e correzione dei tempi; **modalità "solo timeline" con Memo Vocali** |
| App in background (altra app, chiamata) | ❌ | come sopra |
| Registrazioni lunghe (1-3 ore) in primo piano | ⚠️ | salvataggio ogni 5 s, memoria costante, file divisibili |
| Recupero dopo chiusura accidentale | ⚠️ | si perdono al massimo gli ultimi secondi |
| MediaRecorder / microfono in primo piano | ✅ | AAC in `.m4a` |
| Formato audio per le AI | ⚠️ | `.m4a` quasi sempre accettato; conversione gratuita se serve |
| IndexedDB e spazio | ⚠️ | esportare dopo ogni riunione |
| PWA sulla schermata Home | ⚠️ | archivio separato da Safari, Wake Lock da iOS 18.4 |
| Download dei file | ⚠️ | usare «Condividi» |
| Condivisione (Share Sheet) | ✅ | file preparati prima del tocco |
| Vibrazione | ❌ | feedback visivo; tentativo aptico non garantito |

---

## ❌ Schermo bloccato

**Cosa succede davvero**
- Una pagina web non può chiedere a iOS di registrare in background. Le app native lo fanno con un permesso apposito (modalità audio in background) che ai siti non è disponibile.
- Le segnalazioni degli sviluppatori concordano: con lo schermo bloccato o Safari in background la cattura audio delle pagine viene sospesa ([Apple Developer Forums, 2025](https://developer.apple.com/forums/thread/774239)). Per le app che usano WebKit, gli ingegneri WebKit confermano che il microfono viene silenziato in background se l'app non ha la modalità audio in background ([bug WebKit 226620](https://bugs.webkit.org/show_bug.cgi?id=226620)).
- Nello stesso bug una segnalazione del 2024 riporta che in Safari il microfono continuava mentre nell'app aggiunta alla Home si fermava. Non è documentato da Apple e può cambiare da una versione all'altra: **va considerato non affidabile**.
- Che cosa finisce nel file durante la sospensione non è documentato: silenzio al posto del tratto (i tempi restano giusti), tratto "saltato" (file più corto, i tempi successivi scivolano) oppure registrazione chiusa. Per le sospensioni del microfono WebKit tende a inserire campioni di silenzio ([bug WebKit 279432](https://bugs.webkit.org/show_bug.cgi?id=279432)), ma per il background non ci sono garanzie. **La prova in Diagnostica ti dice quale caso avviene sul tuo iPhone.**

**Cosa fa ChiParla**
- Tiene lo schermo acceso con il **Wake Lock** per tutta la registrazione (Safari da iOS 16.4; app dalla Home da iOS 18.4: [WebKit, Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)). Lo richiede di nuovo al ritorno e a ogni tocco; se non riesce mostra un avviso con il pulsante «Tieni acceso».
- Registra come evento ogni volta che l'app sparisce e ricompare, con la durata.
- Al ritorno controlla il microfono: se iOS l'ha chiuso, **riparte da sola in un nuovo file audio** (se iOS non lo consente senza un tocco compare «Riprendi»).
- A fine riunione **misura la durata vera di ogni file** leggendone la struttura e la confronta con il tempo trascorso. Se il tratto nascosto manca dal file, propone **«Correggi i tempi»**; tutto viene riportato nei file esportati (sezione "Qualità della registrazione").
- **Modalità "solo timeline"** (Impostazioni di registrazione): l'audio lo registra **Memo Vocali**, app nativa e gratuita di Apple che continua anche a schermo bloccato; ChiParla non usa il microfono e segna solo chi parla. Alla fine allinei i tempi indicando a che punto del file audio hai avviato ChiParla. È la soluzione più robusta se temi interruzioni.

**Cosa fai tu**
- Tieni ChiParla aperta e in primo piano. Non premere il tasto laterale (blocca subito lo schermo, Wake Lock o no).
- Se il Wake Lock non è disponibile: *Impostazioni → Schermo e luminosità → Blocco automatico → Mai* (poi rimettilo).
- Disattiva *Risparmio energetico*: forza il blocco automatico dopo 30 secondi (non è verificato che il Wake Lock lo superi).
- Opzionale: *Impostazioni → Accessibilità → Accesso guidato*. Con tre clic sul tasto laterale l'iPhone resta dentro l'app (niente uscite accidentali); nelle opzioni di Accesso guidato puoi impostare anche il blocco automatico dello schermo.

## ❌ App in background (altra app, notifiche, chiamate)

**Cosa succede davvero**: passare a un'altra app ha lo stesso effetto dello schermo bloccato. Inoltre, in background JavaScript si ferma e iOS può chiudere del tutto la pagina se serve memoria. Una **chiamata**, **Siri**, la **dettatura** della tastiera o un'altra app che registra prendono il microfono: la registrazione della pagina viene sospesa; alla fine dell'interruzione WebKit di norma riattiva il microfono ([commit WebKit](https://github.com/WebKit/WebKit/commit/439677029dc8350cb7a128fa96cc51f8b0c59496)), ma non è garantito. Anche collegare cuffie o AirPods a metà riunione può cambiare il microfono in uso.

**Cosa fa ChiParla**: registra gli eventi (app nascosta, microfono sospeso/riattivato/chiuso, dispositivi audio cambiati), controlla ogni secondo che arrivino dati audio e che il microfono sia attivo, avvisa con il pulsante giusto («Riprendi», «Riavvia microfono») e, se la pagina viene chiusa, al riavvio propone il recupero.

**Cosa fai tu**: attiva *Non disturbare* (o una modalità Full immersion) per evitare chiamate e notifiche; in alternativa la **modalità aereo** (ChiParla funziona offline). Scrivi le note con la tastiera, **non con la dettatura**. Collega eventuali cuffie prima di iniziare, non durante.

## ⚠️ Registrazioni lunghe

**Cosa succede davvero**
- Non c'è un limite di durata documentato per MediaRecorder. Il rischio reale è che iOS chiuda la pagina (memoria, calore, errore) o che l'app finisca in background.
- Registrare tutto in memoria fino allo Stop sarebbe pericoloso: sono noti arresti di Safari con registrazioni video lunghe tenute in memoria ([Apple Developer Forums](https://developer.apple.com/forums/thread/694867)).
- Spazio: 64 kbps ≈ 29 MB/ora (3 ore ≈ 90 MB). Lo schermo acceso consuma batteria.

**Cosa fa ChiParla**: ogni ~5 s il pezzo di audio va su IndexedDB e non resta in memoria, quindi la RAM usata non cresce con la durata. L'unione dei pezzi per l'esportazione usa i file su disco; la verifica finale legge l'audio a finestre da 512 KB. Opzione «Dividi l'audio ogni 15/30/60 minuti» per avere più file indipendenti (utile anche con servizi che limitano la dimensione dei file). Se il formato prodotto non fosse recuperabile dopo un crash, divide automaticamente in file da 10 minuti.

**Cosa fai tu**: per riunioni oltre un'ora usa il caricabatterie; tieni almeno 1 GB libero; fai una prova della durata reale ([TEST.md](TEST.md), prova 6).

## ⚠️ Recupero dopo una chiusura accidentale

**Cosa succede davvero**: se Safari si chiude (scorrimento nel selettore app, crash, telefono spento) la pagina muore. Restano su disco i pezzi già salvati. Safari registra MP4 frammentato (un'intestazione e poi frammenti indipendenti): i pezzi salvati formano un file leggibile anche se incompleto ([addpipe](https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/)). Il salvataggio a intervalli (`timeslice`) è supportato da Safari 14 ([bug WebKit 202233](https://bugs.webkit.org/show_bug.cgi?id=202233)).

**Cosa fa ChiParla**: alla riapertura la Home mostra «Registrazione interrotta» con **Riprendi** (l'audio continua in un nuovo file e la timeline segna il buco) o **Chiudi e salva**. Il file recuperato viene verificato come gli altri. In prova (browser Chromium, stesso formato AAC/MP4 frammentato) un file interrotto dopo 70 s è stato ricostruito e decodificato per intero: 70,2 s.

**Limiti**: si perdono gli ultimi ~5 s prima della chiusura. Se iOS chiude Safari mentre è in background, l'audio salvato finisce quando la pagina è stata sospesa. **Da verificare sul tuo iPhone** con la prova 5 di [TEST.md](TEST.md).

## ✅ MediaRecorder e microfono (in primo piano)

- MediaRecorder è attivo di default da Safari 14.1 / iOS 14.5; formato nativo MP4 con AAC ([WebKit](https://webkit.org/blog/11353/mediarecorder-api/)). Safari 18.4 aggiunge WebM/Opus, Safari 26 ALAC e PCM ([Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)). ChiParla sceglie AAC in MP4 (`.m4a`), il più compatibile.
- Serve HTTPS (GitHub Pages lo fornisce). Il permesso si chiede al primo uso: in Safari puoi renderlo permanente da *aA → Impostazioni sito web → Microfono → Consenti*. Nell'app dalla Home iOS può richiederlo a ogni apertura.
- Elaborazione del microfono (cancellazione eco, riduzione rumore) spenta di default: è pensata per le chiamate e abbassa le voci lontane dal telefono.
- Il telefono va appoggiato al centro del tavolo, con il bordo inferiore (dove c'è il microfono) libero e non coperto dalla custodia.

## ⚠️ Formato audio e compatibilità con le AI

- Il `.m4a` di Safari ha la durata a zero nell'intestazione: iPhone, Mac e VLC lo leggono bene, alcuni programmi (per esempio Lettore multimediale di Windows) non mostrano la durata o non permettono di spostarsi ([addpipe](https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/)). ChiParla misura comunque la durata vera da sé.
- La maggior parte dei servizi AI accetta `.m4a`. Se uno lo rifiuta, sul computer si converte gratis con [ffmpeg](https://ffmpeg.org/): `ffmpeg -i riunione.m4a -c copy riunione-ok.m4a` (riscrive l'intestazione senza perdita) oppure `ffmpeg -i riunione.m4a -ac 1 -b:a 64k riunione.mp3`.

## ⚠️ IndexedDB e spazio

- Quota ampia: da Safari 17 fino a circa il 60% del disco per sito ([WebKit, Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)).
- Pulizia automatica: Safari cancella i dati scritti dai siti che non usi da **7 giorni di utilizzo** di Safari; le app aggiunte alla Home hanno un conteggio proprio e di fatto ne sono escluse ([WebKit, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). *Impostazioni → Safari → Cancella cronologia e dati* elimina tutto. La navigazione privata cancella i dati alla chiusura della scheda: non usarla.
- `navigator.storage.persist()` viene chiesto dall'app; Safari lo concede con criteri propri (più spesso alle app dalla Home).
- **Regola pratica: esporta dopo ogni riunione.** Il telefono non è un archivio.

## ⚠️ PWA (app dalla schermata Home)

- Si installa a mano: *Condividi → Aggiungi alla schermata Home*. Da iOS 26 ogni sito aggiunto si apre come app web ([Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- Service worker e uso offline: ✅.
- **Archivio separato da Safari**: le riunioni non passano da una all'altra.
- Wake Lock solo da iOS 18.4. Nessuna esecuzione in background.
- Nell'Unione Europea le app dalla Home funzionano: nel 2024 Apple ha ritirato il piano di rimuoverle.

## ⚠️ Download dei file

«Scarica» usa il download di Safari (conferma, poi cartella *Download* dell'app File). Nelle app aggiunte alla Home i download da pagina sono storicamente poco affidabili: **usa «Condividi»**.

## ✅ Condivisione (Share Sheet)

- Condivisione di file supportata da iOS 15: «Salva su File», AirDrop, Mail, Messaggi…
- iOS la permette solo come risposta diretta a un tocco ([WebKit, User Activation](https://webkit.org/blog/13862/the-user-activation-api/)): ChiParla prepara i file quando apri la schermata Esporta, così la condivisione parte subito al tocco.
- Si passano solo i file, senza titolo o testo: con testo aggiunto iOS può condividere il testo al posto dei file ([MDN, issue 32019](https://github.com/mdn/content/issues/32019)).
- File audio grandi: meglio AirDrop o «Salva su File» che Mail.

## ❌ Vibrazione

Safari su iPhone non supporta `navigator.vibrate`. Da iOS 18 un interruttore `<input type="checkbox" switch>` produce un feedback aptico quando cambia stato e ChiParla lo sfrutta ([ios-haptics](https://github.com/tijnjh/ios-haptics)); è un comportamento non documentato che alcune fonti danno come non più funzionante nelle versioni recenti di iOS. Il riscontro affidabile è quello visivo: pulsante pieno nel colore della persona, "PARLA", riquadro "Sta parlando". La vibrazione si può disattivare nelle impostazioni.

## ⚠️ Precisione dei tempi

- L'orologio è quello del telefono, con lo zero nel momento in cui il registratore parte davvero; lo scarto su ore è trascurabile.
- Il tempo del tocco è preso quando il dito tocca lo schermo.
- Il limite vero è umano: si tocca 0,5-2 s dopo il cambio di voce. Il Markdown lo spiega all'AI; «Sposta tempi» può compensare (es. −1 s su tutto).

## Cosa non facciamo apposta

- **Trucchi per restare vivi in background** (audio muto in loop, video nascosti): non documentati, possono smettere di funzionare a ogni aggiornamento e possono interferire con la sessione audio della registrazione. Se serve l'audio a schermo bloccato, la strada affidabile e gratuita è la modalità "solo timeline" con Memo Vocali.
- **Invio dell'audio a server o API**: escluso dai vincoli e comunque non risolverebbe il background.
