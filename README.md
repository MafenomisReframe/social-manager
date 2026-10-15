# Social Manager

Applicazione multi-tenant di Re-Frame Communication per gestire i social dei clienti. È autonoma rispetto al gestionale Re-Frame.

- **Online:** https://social-manager.simone-87d.workers.dev (protetta da Cloudflare Access)
- **Stack:** React 18 + Vite (frontend), Cloudflare Worker in JavaScript (API), Cloudflare D1 (`social-manager-db`, binding `DB`)
- **Deploy:** automatico da GitHub (`main`) tramite Cloudflare

## Struttura

```
index.html            pagina che carica src/main.jsx
vite.config.js        build del frontend (output in dist/)
worker.js             API /api/* con verifica JWT di Cloudflare Access
wrangler.jsonc        Worker, assets, D1 e POLICY_AUD (non rimuovere nei deploy)
migrations/           schema SQL di riferimento
src/
  main.jsx, App.jsx   avvio e composizione delle pagine
  router.jsx          indirizzi delle pagine (/clienti/<id>/social, ...)
  api.js              chiamate al backend e messaggi d'errore
  shared/validation.js  regole sui campi cliente, usate da frontend E Worker
  components/         menu, intestazione, etichetta "Demo"
  pages/              Dashboard, Clienti, Scheda cliente, pagine dimostrative
  data/demo.js        unici dati finti dell'app (marcati "Demo" in interfaccia)
```

## Cosa è reale e cosa è demo

Reali: login, elenco clienti, creazione cliente, scheda cliente con anagrafica e riferimenti social (validati e salvati in D1, con registro in `audit_events`).

Demo (etichetta "Demo" visibile): pubblicazioni, calendario, contenuti, chat Segnalazioni, Brand Interview, Creative Lab. Nessun account social è collegato via OAuth.

## Sviluppo locale

```
npm install
npm run dev        # solo frontend
npm run build      # genera dist/ usata dal Worker
```

## Database

Le tabelle sono state create a mano dalla Console D1 e contengono dati reali: **non azzerare il database**. Verificato il 15/10/2026: tutte le tabelle di `0001_initial.sql` esistono tranne `reports`.

## Sicurezza

D1 non isola i tenant da solo: ogni endpoint deve verificare utente, appartenenza e ruolo e filtrare per tenant. Non inserire token o credenziali nel repository.
