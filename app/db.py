"""Database SQLite: connessione, schema e argomenti iniziali."""
import os
import re
import sqlite3
from pathlib import Path

DATA_DIR = Path(os.environ.get("PATENTE_DATA_DIR", "data")).resolve()
IMG_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "patente.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  keywords TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  norm TEXT NOT NULL,
  answer INTEGER NOT NULL CHECK (answer IN (0, 1)),
  image TEXT,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  last_result INTEGER
);
CREATE INDEX IF NOT EXISTS idx_q_norm ON questions(norm);
CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic_id);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  ts INTEGER NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  passed INTEGER
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  ts INTEGER NOT NULL,
  correct INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_a_q ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_a_ts ON attempts(ts);
"""

# Argomenti di partenza (modificabili dall'app). Le parole chiave servono
# a suggerire automaticamente l'argomento mentre scrivi la domanda.
DEFAULT_TOPICS = [
    ("Definizioni stradali e di traffico", "carreggiata,corsia,banchina,intersezione,piazzola,centro abitato,isola di traffico,aiuola,spartitraffico,definizione,strada extraurbana,area pedonale"),
    ("Segnali di pericolo", "pericolo,curva pericolosa,sdrucciolevole,attraversamento pedonale,caduta massi,dosso,strettoia,doppia curva,segnale di pericolo,animali"),
    ("Segnali di divieto", "divieto,vietato,divieto di transito,divieto di sorpasso,senso vietato,divieto di accesso,divieto di svolta,inversione di marcia"),
    ("Segnali di obbligo", "direzione obbligatoria,pista ciclabile,catene da neve,velocità minima,percorso pedonale,segnale di obbligo,segnali di obbligo"),
    ("Segnali di precedenza", "stop,dare precedenza,diritto di precedenza,strada principale,senso unico alternato,segnale di precedenza"),
    ("Segnali di indicazione", "indicazione,autostrada,parcheggio,ospedale,preavviso,località,bivio,preselezione,area di servizio,galleria,segnale di indicazione"),
    ("Segnali complementari e di cantiere", "cantiere,lavori in corso,delineatore,barriera,segnale temporaneo,complementare,coni,deviazione,restringimento"),
    ("Segnaletica orizzontale", "striscia,linea continua,linea discontinua,strisce pedonali,segnaletica orizzontale,zebratura,freccia direzionale,linea di arresto,margine"),
    ("Semafori e agenti del traffico", "semaforo,luce rossa,luce gialla,luce verde,agente,vigile,polizia,segnale manuale,lampeggiante,braccio alzato"),
    ("Limiti di velocità e intralcio", "velocità,km/h,limite,intralcio,moderare,rallentare,arresto improvviso,nebbia,velocità massima"),
    ("Distanza di sicurezza", "distanza di sicurezza,spazio di frenata,spazio di arresto,tempo di reazione,frenata,distanza"),
    ("Norme sulla circolazione", "sorpasso,svolta,posizione,mano,inversione,retromarcia,marcia indietro,cambio di direzione,sorpassare,parte destra"),
    ("Precedenza agli incroci", "incrocio,precedenza,rotatoria,tram,intersezione,dare la precedenza,destra"),
    ("Fermata, sosta, arresto e partenza", "fermata,sosta,fermarsi,sostare,parcheggio,parcheggiare,arresto,partenza,passo carrabile,marciapiede,autobus,mercato,carico e scarico,divieto di sosta,divieto di fermata"),
    ("Norme varie", "ostacolo,tunnel,passaggio a livello,traino,rimorchio,trasporto,carico,pedoni,ciclisti,animali,autostrada"),
    ("Luci e segnalazioni acustiche", "luci,abbaglianti,anabbaglianti,fari,fendinebbia,retronebbia,clacson,segnalazione acustica,luci di emergenza,frecce,luci diurne,lampeggio"),
    ("Equipaggiamento e sicurezza passiva", "pneumatici,catene,gomme,battistrada,cintura,casco,seggiolino,airbag,appoggiatesta,abs,esp,specchietti,targa"),
    ("Patente, documenti e punti", "patente,punti,revoca,sospensione,documenti,carta di circolazione,assicurazione,neopatentato,revisione,sanzione,multa,ritiro,categoria,foglio rosa"),
    ("Incidenti e comportamento", "incidente,soccorso,ferito,triangolo,giubbotto,assistenza,incidente stradale,omissione"),
    ("Alcol, droghe e farmaci", "alcol,alcool,droga,stupefacenti,tasso alcolemico,farmaci,stanchezza,sonno,ebbrezza,g/l"),
    ("Responsabilità e assicurazione", "responsabilità,civile,penale,risarcimento,rc auto,danni,responsabile"),
    ("Consumi e ambiente", "consumo,carburante,inquinamento,emissioni,catalizzatore,ambiente,gas di scarico,marmitta,risparmio"),
    ("Veicolo e manutenzione", "freni,sterzo,motore,sospensioni,ammortizzatori,batteria,olio,raffreddamento,frizione,cambio,manutenzione,spia,cruscotto"),
    ("Stabilità e aderenza", "stabilità,aderenza,aquaplaning,ghiaccio,neve,sbandamento,sovrasterzo,sottosterzo,forza centrifuga,bagnato"),
    ("Primo soccorso", "primo soccorso,emorragia,respirazione,rianimazione,infortunato,ferite,ustioni,118"),
]


def norm(text: str) -> str:
    """Testo normalizzato (minuscolo, senza punteggiatura) per cercare duplicati."""
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


def connect() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    c = connect()
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        if c.execute("SELECT COUNT(*) FROM topics").fetchone()[0] == 0:
            c.executemany(
                "INSERT INTO topics (name, keywords, position) VALUES (?, ?, ?)",
                [(n, k, i) for i, (n, k) in enumerate(DEFAULT_TOPICS)],
            )
        c.commit()
    finally:
        c.close()
