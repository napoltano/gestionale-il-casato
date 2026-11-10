# il Casato · Sala e Prenotazioni

Gestionale per la sala del ristorante **il Casato**: pianta interattiva con tavoli (anche da unire trascinandoli uno sull'altro), prenotazioni, lista d'attesa, turni, chiusure, statistiche, **menu con ingredienti e prezzi**, **ordini ai tavoli** e **pagina della pizzeria** in tempo reale.

Funziona da telefono, tablet e PC e si installa sulla schermata Home. I dati sono condivisi tra tutti i dispositivi (aggiornamento ogni pochi secondi) e restano consultabili anche offline.

## Accesso e ruoli

I dipendenti si registrano da soli con nome, email e password. **Il primo account registrato è il titolare** (amministratore). Gli altri restano «in attesa» finché l'amministratore non assegna un ruolo da **Impostazioni › Personale**.

| Ruolo | Cosa può fare |
|---|---|
| Amministratore | Tutto, comprese chiusure, turni e personale |
| Gestore di sala | Prenotazioni, stati, lista d'attesa, sale e tavoli |
| Cameriere | Guarda sala e prenotazioni, prende gli ordini ai tavoli |
| Pizzaiolo | Pagina Pizzeria: vede le pizze ordinate con il tavolo e le segna fatte |
| In attesa | Nessun accesso |

Password dimenticata: l'amministratore ne imposta una nuova da Impostazioni › Personale.

## Menu e ordini

- **Menu** (solo amministratore): piatti per reparto (Antipasti, Primi, Secondi, Contorni, Pizze, Dolci, Bevande, Vini) con ingredienti, **14 allergeni** (Reg. UE 1169/2011), prezzo e disponibilità; **Aggiunte** a pagamento.
- **Ordine** dal tavolo: ogni piatto si personalizza (togli ingredienti, aggiunte, richiesta) e ha la sua **uscita** (1ª, 2ª, 3ª, dolci). La prima uscita parte subito, le altre quando il cameriere preme «Manda».
- **Reparti**: ogni comanda va alla pagina giusta — **Pizzeria**, **Cucina** o **Bar** (configurabile per reparto). Si segna fatto piatto per piatto o tutto il tavolo; il cameriere riceve l'avviso «pronto».
- **Invia alla sala**: dai reparti si manda al pass anche un solo piatto pronto; quando un reparto finisce tutto il tavolo la sala viene avvisata da sola. I camerieri vedono il riquadro «Da ritirare al pass» (con suono e, se attivate, notifiche) e premono «Ritirato e servito».
- **Senza rete**: le modifiche restano sul telefono e partono appena torna la connessione.
- **Conto**: coperto, sconto, alla romana, pagamento per piatti, contanti/carta, **stampa del preconto** (non fiscale) e della comanda.
- **Seggioloni** per bambini sulle prenotazioni, visibili sulla pianta.
- **Menu con QR code** (`menu.html`): i clienti vedono piatti, prezzi e allergeni.
- **Statistiche**: incassi, scontrino medio, piatti e pizze più venduti, tempi di preparazione, metodi di pagamento.

| Ruolo | Pagina |
|---|---|
| Pizzaiolo | Pizzeria |
| Cuoco | Cucina |
| Barista | Bar |

## Server (Google Sheets)

Dati e account sono in un foglio Google con lo script [`apps-script/Code.gs`](apps-script/Code.gs):

- foglio **Dati**: sale, tavoli, prenotazioni e impostazioni (una riga per documento);
- foglio **Utenti**: account; le password sono salvate solo come impronta con sale;
- foglio **Archivio**: ogni giorno ordini (dopo 3 giorni), conti (7) e prenotazioni (45) passano qui, così l'app resta veloce; le statistiche li leggono comunque;
- **backup automatico** giornaliero su Drive, cartella «il Casato · Backup», conservato 30 giorni (importabile dall'app).

Il file `apps-script/appsscript.json` limita i permessi dello script al solo foglio collegato e ai file che crea su Drive.

I permessi sono verificati dallo script, non dal telefono.

Per aggiornare lo script: foglio › Estensioni › Apps Script › incolla `Code.gs` › Salva › Esegui il deployment › Gestisci deployment › ✏️ › Nuova versione › Esegui il deployment (Esegui come: Me, Accesso: Chiunque). L'indirizzo resta lo stesso.

`config.js` contiene l'indirizzo dell'App web dello script.
