# Second Chance Patente

Piccola webapp **self-hosted** per salvare le domande della patente che sbagli e rifarle come quiz, in stile scheda d'esame ministeriale. Pensata per girare su un Raspberry Pi: **FastAPI + SQLite**, frontend in JavaScript puro (nessuna build, nessuna dipendenza), tema scuro e minimale, responsive (PC, tablet, telefono) e installabile come **PWA**.

L'app non contiene le domande ufficiali: le inserisci tu, man mano che le sbagli. Salvare una domanda richiede pochi secondi.

---

## Indice

- [Funzionalità](#funzionalità)
- [Installazione con Docker](#installazione-con-docker)
- [Come raggiungere l'app (rete, HTTPS e PWA)](#come-raggiungere-lapp-rete-https-e-pwa)
- [Configurazione](#configurazione)
- [Come si usa](#come-si-usa)
- [Argomenti e suggerimento automatico](#argomenti-e-suggerimento-automatico)
- [Modalità quiz](#modalità-quiz)
- [Backup e ripristino](#backup-e-ripristino)
- [Aggiornamento](#aggiornamento)
- [Sicurezza](#sicurezza)
- [Struttura del progetto](#struttura-del-progetto)
- [API](#api)
- [Sviluppo e test](#sviluppo-e-test)
- [Limiti noti](#limiti-noti)
- [Installazione manuale](#installazione-manuale-senza-docker)

---

## Funzionalità

### Aggiungere una domanda in pochi secondi
- Un'unica schermata: **testo → Vero/Falso → Salva**. L'immagine è facoltativa.
- **Immagine con `Ctrl+V`**: fai uno screenshot e incolla, ovunque ti trovi nella pagina. In alternativa trascina il file sull'area immagine o usa "scegli file" (da telefono apre fotocamera/galleria).
- Le immagini vengono **ridimensionate nel browser** (max 1200 px) prima dell'invio, per tenere leggero il Raspberry.
- **Argomento suggerito in automatico** mentre scrivi (vedi [sotto](#argomenti-e-suggerimento-automatico)): se è giusto non tocchi niente, altrimenti un tap su un altro argomento.
- **"Mantieni l'argomento"**: utile se inserisci di seguito più domande dello stesso capitolo.
- Dopo il salvataggio il form si svuota e il cursore torna nel testo, pronto per la prossima.
- **Annulla** subito dopo il salvataggio (pulsante nella notifica).
- **Rilevamento duplicati**: se salvi una domanda già presente, non ne crea una seconda: la segna come *sbagliata di nuovo* nelle statistiche (e, se mancavano, aggiunge immagine e argomento).
- Scorciatoie: `Ctrl+Invio` salva · `Alt+V` Vero · `Alt+F` Falso.

### Elenco delle domande
- Ricerca nel testo, filtro per argomento e per stato (*da ripassare*, *mai viste*, *padroneggiate*).
- Per ogni domanda: miniatura, risposta, argomento, giuste/sbagliate.
- Modifica (testo, risposta, argomento, immagine — anche incollandola) ed eliminazione.

### Quiz in stile scheda ministeriale
- Schermata ispirata alla scheda d'esame: schede *Domande 1-10 / 11-20 / 21-30*, numeri delle domande colorati per stato, **immagine a sinistra**, testo a destra, pulsanti **Vero / Falso**, timer, frecce avanti/indietro.
- Sei modalità: [Simulazione esame, Ripasso intelligente, Le più sbagliate, Mai viste, Per argomento, Libera](#modalità-quiz).
- **Simulazione esame**: 30 domande, 20 minuti, massimo 3 errori, nessuna correzione fino alla fine; puoi cambiare le risposte e navigare liberamente. Allo scadere del tempo il quiz termina da solo.
- Nelle altre modalità puoi scegliere il numero di domande e se vedere **subito** se la risposta è giusta.
- **Risultati**: punteggio, tempo, *promosso/bocciato* (simulazione), elenco degli errori con la tua risposta e quella corretta, pulsante **"Rifai gli errori"**.
- Scorciatoie da tastiera: `V` / `F` rispondono, `←` `→` (o `Invio`) navigano.
- Un quiz interrotto (ricarica della pagina, telefono bloccato) **si riprende** da dove l'avevi lasciato.

### Statistiche
- Domande salvate, percentuale di risposte corrette, quiz svolti, simulazioni superate.
- Domande **da ripassare**, **padroneggiate** (3 risposte giuste di fila), **mai viste**.
- Giorni consecutivi di allenamento.
- Grafico degli ultimi 20 quiz (punti rossi = simulazione non superata) e attività degli ultimi 14 giorni.
- Precisione **per argomento** e classifica delle **domande più ostiche**.

### Altro
- **Argomenti modificabili**: 25 argomenti di partenza, aggiungi/rinomina/elimina e personalizza le parole chiave per il suggerimento.
- **Backup / ripristino** in un clic (zip con domande, immagini, statistiche, argomenti).
- **Protezione con password** (utente singolo).
- **PWA**: installabile su telefono, tablet e PC; l'interfaccia si apre subito anche con connessione lenta.
- **Responsive**: barra laterale su PC, barra in basso su telefono/tablet.
- Tema scuro minimale, nessun tracciamento, nessun servizio esterno.

---

## Installazione con Docker

Il modo consigliato. Serve solo Docker con il plugin Compose (su Raspberry Pi OS: `curl -fsSL https://get.docker.com | sh`, poi `sudo usermod -aG docker $USER` e riaccedi). L'immagine funziona su Raspberry a 32 e 64 bit.

```bash
git clone https://github.com/<tuo-utente>/second-chance-patente.git
cd second-chance-patente

cp .env.example .env
nano .env                      # imposta PATENTE_PASSWORD

docker compose up -d --build   # prima build: qualche minuto sul Raspberry
```

Apri `http://<ip-del-raspberry>:8000`, entra con la password e inizia. Il container riparte da solo a ogni accensione (`restart: unless-stopped`).

**Dati**: restano nella cartella `./data` accanto al progetto (`patente.db` + `images/` + `secret.key`). Sono l'unica cosa da salvare nei backup e sopravvivono a rebuild e aggiornamenti.

**Comandi utili**

| Cosa | Comando |
|---|---|
| Log in tempo reale | `docker compose logs -f` |
| Stato (e healthcheck) | `docker compose ps` |
| Fermare / riavviare | `docker compose stop` · `docker compose restart` |
| Spegnere e rimuovere il container (i dati restano) | `docker compose down` |

Altra porta: `PORT=9000` nel `.env`. Fuso orario diverso: `TZ=...`. Per HTTPS, accesso da fuori casa e installazione come app vedi [Come raggiungere l'app](#come-raggiungere-lapp-rete-https-e-pwa).

> Installazione senza Docker (venv + systemd): vedi [Installazione manuale](#installazione-manuale-senza-docker).

---

## Come raggiungere l'app (rete, HTTPS e PWA)

L'app funziona su semplice HTTP, ma i browser abilitano **service worker e "Installa app" solo su HTTPS** (o su `localhost`). Scegli lo scenario che ti serve:

| Scenario | HTTPS / PWA | Porte aperte sul router | Serve un dominio | Accesso da fuori casa |
|---|---|---|---|---|
| [1. Solo rete locale](#1-solo-rete-locale-default) | no (solo HTTP) | no | no | no |
| [2. Tailscale](#2-tailscale-consigliato-per-uso-personale) | sì | no | no | sì, dai tuoi dispositivi |
| [3. Caddy + dominio](#3-caddy--dominio-proprio) | sì | 80 e 443 | sì | sì, da chiunque abbia la password |
| [4. Cloudflare Tunnel](#4-cloudflare-tunnel) | sì | no | sì (su Cloudflare) | sì, da chiunque abbia la password |

Le variabili usate negli esempi vanno nel file `.env` (vedi [Configurazione](#configurazione)). Per gli scenari 2-4 imposta sempre **`BIND=127.0.0.1`** (l'app non è più raggiungibile direttamente dalla rete) e **`FORWARDED_ALLOW_IPS=*`** (l'app si fida degli header del proxy: serve per riconoscere il cookie HTTPS e l'IP reale di chi prova la password).

> ⚠️ Non impostare `FORWARDED_ALLOW_IPS=*` lasciando `BIND=0.0.0.0`: chiunque in rete potrebbe falsificare gli header e aggirare il limite di tentativi.

### 1. Solo rete locale (default)

Nessuna configurazione: `docker compose up -d --build` e apri `http://<ip-del-raspberry>:8000` da qualunque dispositivo di casa.

- L'app funziona completamente, ma Chrome/Edge non proporranno "Installa app" (manca HTTPS). Su iPhone, "Aggiungi a Home" funziona comunque come scorciatoia.
- Sul Raspberry stesso, `http://localhost:8000` conta come sicuro e la PWA si installa.
- Per provare l'installazione in LAN su Chrome Android: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` e inserisci l'indirizzo del Raspberry.
- Se la rete non è fidata, usa una password lunga: il traffico non è cifrato.

### 2. Tailscale (consigliato per uso personale)

HTTPS valido, raggiungibile da casa e fuori, **nessuna porta aperta**. L'indirizzo è visibile solo ai dispositivi del tuo tailnet.

1. Installa Tailscale sul Raspberry e sui tuoi dispositivi, poi nella [console di amministrazione](https://login.tailscale.com/admin/dns) abilita *MagicDNS* e *HTTPS Certificates*.
2. `.env`:
   ```
   PATENTE_PASSWORD=...
   BIND=127.0.0.1
   FORWARDED_ALLOW_IPS=*
   ```
3. Avvia l'app e pubblicala nel tailnet:
   ```bash
   docker compose up -d --build
   sudo tailscale serve --bg 8000
   ```
4. Apri l'indirizzo `https://<nome>.<tailnet>.ts.net` che Tailscale mostra (`tailscale serve status`) e installa la PWA.

Per smettere di condividerla: `sudo tailscale serve reset`. Non usare `tailscale funnel` a meno che tu voglia davvero renderla pubblica su Internet.

### 3. Caddy + dominio proprio

Caddy ottiene e rinnova da solo il certificato Let's Encrypt. Serve un dominio che punti all'IP pubblico del Raspberry e le porte **80 e 443** inoltrate dal router.

1. `.env`:
   ```
   PATENTE_PASSWORD=...
   DOMAIN=patente.example.com
   BIND=127.0.0.1
   FORWARDED_ALLOW_IPS=*
   ```
2. Avvio (il file aggiunge un container Caddy):
   ```bash
   docker compose -f docker-compose.yml -f deploy/compose.caddy.yml up -d --build
   ```

Se hai già un tuo reverse proxy (Nginx Proxy Manager, Traefik, Caddy sull'host...) punta semplicemente a `http://127.0.0.1:8000` e passa gli header `X-Forwarded-For` e `X-Forwarded-Proto`.

### 4. Cloudflare Tunnel

HTTPS gestito da Cloudflare, nessuna porta aperta sul router. Serve un dominio su Cloudflare.

1. In *Cloudflare Zero Trust → Networks → Tunnels* crea un tunnel di tipo *Cloudflared* e copia il token.
2. Nel tunnel aggiungi un *Public hostname* (es. `patente.example.com`) con servizio `http://second-chance-patente:8000`.
3. `.env`:
   ```
   PATENTE_PASSWORD=...
   TUNNEL_TOKEN=...
   BIND=127.0.0.1
   FORWARDED_ALLOW_IPS=*
   ```
4. Avvio:
   ```bash
   docker compose -f docker-compose.yml -f deploy/compose.cloudflared.yml up -d --build
   ```

### Installare la PWA

Una volta su HTTPS:
- **Android / Chrome e PC (Chrome/Edge)**: menu del browser → *Installa app*.
- **iPhone/iPad (Safari)**: Condividi → *Aggiungi a Home*.

Il cookie di sessione diventa `Secure` automaticamente quando la richiesta arriva via HTTPS (header `X-Forwarded-Proto`).

### Se esponi l'app su Internet (scenari 3 e 4)

- Usa una **password lunga e unica**: è l'unica barriera. Dopo 5 tentativi errati dallo stesso IP l'accesso è bloccato per 1 minuto.
- Valuta di mettere davanti un ulteriore controllo di accesso (es. Cloudflare Access) se l'app contiene dati che non vuoi rendere raggiungibili da tutti.
- Tieni aggiornato il sistema e l'immagine (`git pull` + `docker compose up -d --build`).

---

## Configurazione

Le impostazioni si leggono da variabili d'ambiente o dal file `.env` nella cartella del progetto.

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `PATENTE_PASSWORD` | sì | Password di accesso (minimo 4 caratteri). Se manca l'app non parte. |
| `PATENTE_DATA_DIR` | no | Cartella dati. In Docker è già impostata su `/data` (volume `./data`). |
| `PORT` | no | Porta sul Raspberry (default `8000`). |
| `TZ` | no | Fuso orario (default `Europe/Rome`). |
| `BIND` | no | `0.0.0.0` (default): raggiungibile in LAN. `127.0.0.1`: solo dal Raspberry, per Tailscale/Caddy/Cloudflare. |
| `FORWARDED_ALLOW_IPS` | no | IP di cui fidarsi per gli header `X-Forwarded-*` (default `127.0.0.1`). Usa `*` solo con `BIND=127.0.0.1`. |
| `DOMAIN` | solo Caddy | Dominio per `deploy/compose.caddy.yml`. |
| `TUNNEL_TOKEN` | solo Cloudflare | Token per `deploy/compose.cloudflared.yml`. |

Cambiando la password, tutte le sessioni già aperte vengono disconnesse.

---

## Come si usa

**Flusso consigliato**
1. Fai una simulazione sul sito/app ministeriale (o sul libro).
2. Per ogni domanda sbagliata: apri **Aggiungi**, incolla lo screenshot dell'immagine (se c'è), scrivi o incolla il testo, tocca **Vero** o **Falso** (la risposta *corretta*), `Ctrl+Invio`.
3. Nei giorni successivi fai **Ripasso intelligente** o **Le più sbagliate**.
4. Prima dell'esame fai qualche **Simulazione esame** e controlla le **Statistiche**.

Tutte le sezioni sono raggiungibili dal menu: *Aggiungi · Quiz · Domande · Statistiche · Altro*.

## Argomenti e suggerimento automatico

L'assegnazione dell'argomento è **semi-automatica**: ogni argomento ha delle **parole chiave** (modificabili in *Altro → Argomenti*). Mentre scrivi, l'app confronta il testo con le parole chiave e **pre-seleziona l'argomento più probabile** (bordo tratteggiato). Il riconoscimento ignora la differenza singolare/plurale (es. "semaforo" trova anche "semafori").

- Se il suggerimento è giusto, salvi e basta.
- Se è sbagliato, tocchi l'argomento corretto; da quel momento il suggerimento si ferma per quella domanda.
- Se non c'è corrispondenza, la domanda resta *senza argomento* (puoi assegnarlo dopo da *Domande → modifica*).

Gli argomenti di partenza seguono i capitoli tipici del programma della patente B. Sono indicativi: rinominali, eliminali o aggiungine di nuovi come preferisci. Migliorare le parole chiave nel tempo rende il suggerimento sempre più preciso.

## Modalità quiz

| Modalità | Cosa fa |
|---|---|
| **Simulazione esame** | 30 domande a caso, 20 minuti, max 3 errori, senza correzione immediata. Se hai meno di 30 domande salvate usa tutte quelle disponibili con 40 secondi a domanda e 1 errore ogni 10 domande. Le domande senza risposta contano come errori. |
| **Ripasso intelligente** | Estrazione *pesata*: più probabilità alle domande che sbagli spesso, a quelle mai viste e a quelle sbagliate l'ultima volta; meno a quelle che hai azzeccato più volte di fila. |
| **Le più sbagliate** | Solo domande con almeno un errore, dalla più sbagliata. |
| **Mai viste** | Domande che non hai ancora affrontato in un quiz. |
| **Per argomento** | Domande di un solo argomento. |
| **Libera** | Domande a caso tra tutte. |

Come vengono aggiornate le statistiche: ogni risposta data aggiorna *viste / giuste / sbagliate* della domanda. Tre giuste di fila = **padroneggiata**; un errore azzera la serie. Le domande lasciate senza risposta contano come errore nel punteggio del quiz ma non alterano le statistiche della singola domanda.

---

## Backup e ripristino

- **Esporta**: *Altro → Backup → Esporta backup* scarica uno zip (`questions.json` + cartella `images/`).
- **Importa**: *Altro → Backup → Importa backup* unisce lo zip ai dati attuali; le domande già presenti (stesso testo) vengono saltate, gli argomenti mancanti creati.
- Alternativa: copia la cartella `data/` (meglio con il container fermo: `docker compose stop`).

Lo zip non include lo storico dettagliato delle singole risposte (solo le statistiche per domanda e l'elenco dei quiz svolti).

## Aggiornamento

```bash
cd second-chance-patente
git pull
docker compose up -d --build
```

Le tabelle mancanti vengono create automaticamente all'avvio; i dati in `data/` non vengono toccati. Dopo un aggiornamento dell'interfaccia ricarica la pagina un paio di volte (il service worker mostra prima la versione in cache e poi scarica quella nuova).

## Sicurezza

- Accesso con **password unica**; sessione tramite cookie firmato (`HttpOnly`, `SameSite=Lax`, `Secure` su HTTPS) valido 30 giorni.
- **Limite tentativi**: dopo 5 password errate l'accesso viene bloccato per 1 minuto.
- Database e immagini sono accessibili **solo dopo il login**; le immagini sono verificate (PNG, JPG, WEBP, GIF) e salvate con un nome derivato dal loro contenuto (hash).
- Se esponi l'app fuori dalla rete di casa, usa **HTTPS** e una password lunga: vedi [Come raggiungere l'app](#come-raggiungere-lapp-rete-https-e-pwa). Tailscale o un tunnel evitano di aprire porte sul router.
- Nessuna telemetria e nessuna richiesta verso servizi esterni.

## Struttura del progetto

```
second-chance-patente/
├── app/
│   ├── main.py            # API FastAPI, quiz, statistiche, backup
│   ├── db.py              # SQLite: schema e argomenti iniziali
│   └── auth.py            # password e sessioni
├── static/
│   ├── index.html
│   ├── app.js             # tutta l'interfaccia (vanilla JS)
│   ├── style.css          # tema scuro, responsive
│   ├── sw.js              # service worker (PWA)
│   ├── manifest.webmanifest
│   └── icons/
├── deploy/
│   ├── compose.caddy.yml · Caddyfile   # HTTPS con dominio
│   ├── compose.cloudflared.yml         # Cloudflare Tunnel
│   └── second-chance-patente.service   # systemd (solo installazione manuale)
├── tools/make_icons.py    # rigenera le icone PNG
├── tests/test_api.py
├── Dockerfile · docker-compose.yml · .dockerignore
├── requirements.txt · requirements-dev.txt
├── run.sh · .env.example · LICENSE
```

**Dati** (cartella `data/`): `patente.db` con le tabelle `topics`, `questions`, `sessions`, `attempts`; `images/` con le immagini; `secret.key` con la chiave per firmare i cookie (non condividerla).

## API

Tutte sotto `/api` e protette da login (tranne `POST /api/login`).

| Metodo | Percorso | Descrizione |
|---|---|---|
| POST | `/api/login` · `/api/logout` | Accesso / uscita |
| GET | `/api/topics` · POST · PUT/DELETE `/api/topics/{id}` | Argomenti |
| GET | `/api/questions?q=&topic=&status=&limit=&offset=` | Elenco con filtri |
| POST | `/api/questions` (multipart: `text`, `answer`, `topic_id`, `image`) | Nuova domanda |
| PUT / DELETE | `/api/questions/{id}` | Modifica / elimina |
| GET | `/api/quiz?mode=&count=&topic_id=&ids=` | Genera un quiz |
| POST | `/api/quiz/finish` | Corregge il quiz e aggiorna le statistiche |
| GET | `/api/stats` | Statistiche |
| GET / POST | `/api/export` · `/api/import` | Backup / ripristino |
| GET | `/media/{file}` | Immagini (richiede login) |

`answer`: `1` = Vero, `0` = Falso. La correzione dei quiz avviene sempre lato server.

## Sviluppo e test

```bash
pip install -r requirements-dev.txt
PATENTE_PASSWORD=dev uvicorn app.main:app --reload --port 8000
pytest
```

Il frontend non ha build: modifica i file in `static/` e ricarica. Per rigenerare le icone: `python tools/make_icons.py`. Se cambi i file della shell (`index.html`, `app.js`, `style.css`) incrementa `CACHE` in `static/sw.js`.

## Limiti noti

- Utente singolo (una sola password, nessun profilo separato).
- Offline si apre l'interfaccia ma, per salvare e fare quiz, serve raggiungere il Raspberry.
- Il suggerimento dell'argomento è basato su parole chiave, non su un modello di linguaggio: è un aiuto, non una classificazione perfetta.
- Il formato delle domande è solo Vero/Falso, come nella prova ministeriale della patente B.

## Installazione manuale (senza Docker)

```bash
sudo apt update && sudo apt install -y python3-venv git
git clone https://github.com/<tuo-utente>/second-chance-patente.git && cd second-chance-patente
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && nano .env      # imposta PATENTE_PASSWORD
./run.sh                               # http://IP-DEL-RASPBERRY:8000  (PORT=9000 ./run.sh per cambiare porta)
```

Per l'avvio automatico copia `deploy/second-chance-patente.service` in `/etc/systemd/system/`, adatta utente e percorsi, poi `sudo systemctl enable --now second-chance-patente`.

## Licenza

MIT, vedi [LICENSE](LICENSE).
