# Prove da fare prima di una riunione vera

Tempo totale: circa 30 minuti più una prova lunga. Falle **sull'iPhone che userai**, **in Safari** (è l'unico modo per avere la trascrizione in diretta; l'app web dalla Home ha comportamenti e archivio diversi). Ripetile dopo ogni aggiornamento importante di iOS.

Annota i risultati nella tabella in fondo: ti diranno se puoi fidarti della registrazione con ChiParla o se conviene la modalità "solo timeline" con Memo Vocali.

## 0. Preparazione

- iOS aggiornato (consigliato 18.4 o successivo). *Impostazioni → Generali → Info*.
- Risparmio energetico **disattivato**, batteria carica o caricabatterie collegato.
- ChiParla aperta almeno una volta con internet (per l'uso offline).

## 1. Funzioni del telefono (1 minuto)

**Diagnostica → Questo telefono.** Atteso: ✓ su Microfono, Registrazione, Formato audio (`audio/mp4…`), Schermo sempre acceso, Archivio locale, Condivisione file, Funzionamento offline. La Vibrazione su iPhone può risultare non disponibile: è normale.

❗ Se *Schermo sempre acceso* non è disponibile: durante le riunioni imposta *Blocco automatico → Mai*.

## 2. Prova in primo piano (2 minuti)

**Diagnostica → Avvia la prova**, parla normalmente per 60 secondi a 1-2 metri dal telefono, poi **Ferma e analizza**. Durante la prova sotto il contatore compare il testo riconosciuto (se compare «Attiva la trascrizione», toccalo: la prima volta iOS chiede il permesso).

Atteso:
- ✓ Salvataggio progressivo: un pezzo circa ogni 5 s;
- ✓ Formato MP4 frammentato: recuperabile dopo una chiusura improvvisa;
- ✓ **Trascrizione in diretta insieme alla registrazione: N frasi** (il testo sarà approssimativo);
- ✓ Audio e timer coincidono (differenza entro 1-2 s) e nessun avviso di "salti" nell'audio;
- ascoltando la prova la voce si capisce bene anche da lontano, senza interruzioni.

❗ Se il salvataggio progressivo manca: imposta «Dividi l'audio ogni 15 minuti». Se la voce è bassa: avvicina il telefono o prova l'altra impostazione del microfono.
❗ Se la trascrizione risulta spenta perché «disturbava la registrazione», o se nell'audio senti buchi: in «Nuova riunione» disattiva la trascrizione in diretta (l'audio viene prima) e ottieni il testo dopo, dando l'audio all'AI.
❗ Se non compare nessuna frase: controlla di essere in Safari, di avere internet e i permessi (*Impostazioni → Privacy e sicurezza → Riconoscimento vocale*).

## 3. Prova schermo bloccato — la più importante (3 minuti)

1. Diagnostica → **Avvia la prova**, parla.
2. Dopo 15 s **blocca l'iPhone** con il tasto laterale e **continua a parlare** (conta ad alta voce da 1 a 30).
3. Dopo 30 s sblocca, torna in ChiParla, parla ancora 10 s, **Ferma e analizza**.
4. Leggi il risultato e **ascolta il tratto bloccato**.

Possibili esiti:
- «iOS ha chiuso il microfono» → con lo schermo bloccato la registrazione si ferma (ChiParla ripartirebbe in un nuovo file al ritorno).
- «quel tratto NON è stato registrato e il file è più corto» → ChiParla a fine riunione propone «Correggi i tempi».
- «la durata è rimasta allineata» → ascolta: se senti il conteggio iOS ha continuato a registrare; se è silenzio, ha registrato vuoto ma i tempi restano giusti.

Ripeti la prova nell'altra modalità (Safari ↔ app dalla Home) e tieni quella che si comporta meglio.

## 4. Prova cambio app (2 minuti)

Come la 3, ma invece di bloccare lo schermo apri Messaggi per 20 s e torna in ChiParla.

## 5. Prova chiusura improvvisa e recupero (4 minuti)

1. **Nuova riunione** con 3 nomi di prova → Avvia.
2. Per 2 minuti tocca i nomi, aggiungi una Nota e un ★ Importante.
3. **Chiudi Safari/l'app dal selettore delle app** (scorri verso l'alto) senza premere Stop.
4. Riapri ChiParla: deve comparire **«Registrazione interrotta»**.
5. Tocca **Riprendi**, registra altri 30 s con un paio di tocchi, poi **Stop**.

Atteso nella timeline: «File audio 1 … recuperato dopo una chiusura improvvisa», «File audio 2 …», «Audio mancante da … a …»; tutti i tocchi presenti. Tocca ▶ su un evento del file 1: l'audio deve partire e arrivare fino a pochi secondi prima della chiusura.

## 6. Riunione simulata della durata reale (la durata delle tue riunioni)

Metti in riproduzione una trasmissione radio o un podcast con più voci (da un altro dispositivo), avvia una riunione e tocca i nomi di tanto in tanto. Durante la prova non toccare nient'altro.

Controlla a fine prova:
- batteria consumata e temperatura del telefono;
- nessun avviso rosso durante la registrazione; il riquadro «Testo in diretta» è rimasto «attiva» per tutta la prova;
- in timeline: «✓ … Allineato alla timeline» e il testo sotto gli interventi, attribuito alle persone giuste;
- esportazione: dimensione del file (~29 MB/ora a 64 kbps) e tempo per preparare i file;
- l'audio si ascolta fino alla fine.

## 7. Interruzioni (5 minuti, facoltativa ma utile)

Durante una prova di registrazione: fatti chiamare da qualcuno (rifiuta o rispondi), invoca Siri, ricevi una notifica, collega le cuffie Bluetooth. Guarda gli avvisi di ChiParla e cosa riporta la timeline (spunta «eventi tecnici»). Capirai cosa evitare in riunione (di solito: *Non disturbare* attivo, niente cuffie, note scritte e non dettate).

## 8. Esportazione e AI (5 minuti)

1. **Esporta → Condividi tutti i file → Salva su File**: apri il `.m4a` dall'app File e verifica che si ascolti.
2. Invia i file al computer (AirDrop, o salvali in iCloud Drive).
3. Carica **audio + `_per-AI.md`** nel servizio AI che userai (ChatGPT, NotebookLM, …) e chiedi: *«Trascrivi l'audio attribuendo le frasi secondo la timeline del file Markdown, poi sintesi, decisioni e azioni.»* Controlla che le attribuzioni tornino.
4. Apri il `.csv` nel foglio di calcolo (in Excel: *Dati → Da testo/CSV*).

❗ Se il servizio rifiuta il `.m4a`: convertilo con ffmpeg (vedi [LIMITI-IPHONE.md](LIMITI-IPHONE.md), sezione "Formato audio e compatibilità con le AI").

## 9. Offline (2 minuti)

Attiva la modalità aereo, apri ChiParla, fai una registrazione di 30 s ed esportala con «Salva su File». La registrazione deve funzionare; la trascrizione in diretta probabilmente no (di solito serve internet) e il riquadro lo segnala.

## 10. Modalità "solo timeline" con Memo Vocali (se ti serve la massima sicurezza)

1. Apri **Memo Vocali** e avvia la registrazione.
2. Apri ChiParla, *Impostazioni di registrazione → Solo timeline*, avvia la riunione **dicendo ad alta voce «via»**.
3. Blocca e sblocca lo schermo, cambia app: Memo Vocali continua a registrare.
4. Stop in ChiParla, poi ferma Memo Vocali.
5. In Memo Vocali trova a che secondo hai detto «via» (es. 0:07), in ChiParla scrivilo nel riquadro «Allinea» della timeline.
6. Esporta il Markdown da ChiParla e l'audio da Memo Vocali (Condividi → Salva su File).

## Tabella dei risultati

| Prova | Safari | App dalla Home | Note |
|---|---|---|---|
| 1. Funzioni | | | |
| 2. Primo piano (pezzi / formato / durata) | | | |
| 2. Trascrizione insieme alla registrazione (frasi? buchi nell'audio?) | | | |
| 3. Schermo bloccato (esito) | | | |
| 4. Cambio app (esito) | | | |
| 5. Recupero dopo chiusura | | | |
| 6. Prova lunga (durata / batteria / allineato?) | | | |
| 8. AI accetta i file? | | | |
| 9. Offline | | | |

## Checklist prima di ogni riunione

- [ ] Batteria carica o caricabatterie; Risparmio energetico spento
- [ ] *Non disturbare* attivo (o modalità aereo)
- [ ] Almeno 1 GB libero
- [ ] Riunione precedente già esportata
- [ ] Telefono al centro del tavolo, microfono (bordo in basso) libero
- [ ] ChiParla aperta **in Safari** (con internet, se vuoi la trascrizione)
- [ ] Partecipanti inseriti, **Avvia**, controlla «💾 salvato … s fa», «☀ schermo acceso», la barra verde che si muove e il riquadro «Testo in diretta» che mostra le frasi
- [ ] Durante: app sempre in primo piano; note con la tastiera, non dettate
- [ ] Dopo: **Stop**, controlla la timeline, **Esporta → Salva su File**
