# il Casato · Sala e Prenotazioni

Gestionale per la sala del ristorante **il Casato**: pianta interattiva con tavoli, prenotazioni, lista d'attesa, turni, chiusure, statistiche e personale con ruoli.

Funziona da telefono, tablet e PC. I dati sono condivisi in tempo reale tra tutti i dispositivi.

## Ruoli

| Ruolo | Cosa può fare |
|---|---|
| Amministratore | Tutto, comprese chiusure, turni e personale |
| Gestore di sala | Prenotazioni, stati, lista d'attesa, sale e tavoli |
| Cameriere | Solo guardare sala e prenotazioni |
| In attesa | Nessun accesso finché l'amministratore non assegna un ruolo |

I dipendenti si registrano da soli con email e password. L'amministratore assegna il ruolo da **Impostazioni › Personale**. I permessi sono controllati dal server (`firestore.rules`).

## Messa in funzione

1. **Firebase** (console.firebase.google.com): crea un progetto.
   - Authentication › attiva **Email/Password**.
   - Authentication › Impostazioni › Domini autorizzati › aggiungi `<tuo-utente>.github.io`.
   - Firestore Database › crea database in modalità produzione.
   - Firestore Database › **Regole**: incolla il contenuto di `firestore.rules` e pubblica.
   - Impostazioni progetto › aggiungi app Web › copia `firebaseConfig` dentro `config.js`.
2. **GitHub Pages**: Settings › Pages › Deploy from a branch › `main` / root.
3. Apri l'indirizzo della pagina, **registrati per primo** e premi «Sono il titolare: diventa amministratore».
4. Da Impostazioni puoi importare `dati-gestionale.json` per riportare le sale già create.

## File

- `index.html`: l'app completa.
- `config.js`: configurazione Firebase.
- `firestore.rules`: regole di sicurezza.
- `manifest.webmanifest`, `icon-*.png`: installazione come app sulla schermata Home.
