# il Casato · Sala e Prenotazioni

Gestionale per la sala del ristorante **il Casato**: pianta interattiva con tavoli (anche da unire trascinandoli uno sull'altro), prenotazioni, lista d'attesa, turni, chiusure, statistiche e personale con ruoli.

Funziona da telefono, tablet e PC e si installa sulla schermata Home. I dati sono condivisi tra tutti i dispositivi (aggiornamento ogni pochi secondi) e restano consultabili anche offline.

## Accesso e ruoli

I dipendenti si registrano da soli con nome, email e password. **Il primo account registrato è il titolare** (amministratore). Gli altri restano «in attesa» finché l'amministratore non assegna un ruolo da **Impostazioni › Personale**.

| Ruolo | Cosa può fare |
|---|---|
| Amministratore | Tutto, comprese chiusure, turni e personale |
| Gestore di sala | Prenotazioni, stati, lista d'attesa, sale e tavoli |
| Cameriere | Solo guardare sala e prenotazioni |
| In attesa | Nessun accesso |

Password dimenticata: l'amministratore ne imposta una nuova da Impostazioni › Personale.

## Server (Google Sheets)

Dati e account sono in un foglio Google con lo script [`apps-script/Code.gs`](apps-script/Code.gs):

- foglio **Dati**: sale, tavoli, prenotazioni e impostazioni (una riga per documento);
- foglio **Utenti**: account; le password sono salvate solo come impronta con sale.

I permessi sono verificati dallo script, non dal telefono.

Per aggiornare lo script: foglio › Estensioni › Apps Script › incolla `Code.gs` › Salva › Esegui il deployment › Gestisci deployment › ✏️ › Nuova versione › Esegui il deployment (Esegui come: Me, Accesso: Chiunque). L'indirizzo resta lo stesso.

`config.js` contiene l'indirizzo dell'App web dello script.
