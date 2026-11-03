"""Second Chance Patente - backend FastAPI + SQLite."""
import hashlib
import io
import json
import os
import random
import re
import sqlite3
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path
from typing import List, Optional


def _load_env() -> None:
    """Legge un eventuale file .env nella cartella del progetto."""
    p = Path(__file__).resolve().parent.parent / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

from fastapi import (APIRouter, Depends, FastAPI, File, Form, HTTPException,  # noqa: E402
                     Request, Response, UploadFile)
from fastapi.responses import FileResponse, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import auth, db  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
PASSWORD = os.environ.get("PATENTE_PASSWORD", "")
if len(PASSWORD) < 4:
    raise RuntimeError(
        "Imposta la variabile PATENTE_PASSWORD (almeno 4 caratteri), "
        "ad esempio nel file .env"
    )

db.init()
auth.init(db.DATA_DIR, PASSWORD)

MAX_IMG = 8 * 1024 * 1024
IMAGE_RE = re.compile(r"^[a-f0-9]{16}\.(jpg|png|webp|gif)$")
MASTERED_STREAK = 3

app = FastAPI(title="Second Chance Patente", docs_url=None, redoc_url=None, openapi_url=None)
api = APIRouter(prefix="/api", dependencies=[Depends(auth.require_auth)])


def get_conn():
    c = db.connect()
    try:
        yield c
    finally:
        c.close()


def now() -> int:
    return int(time.time())


# ---------------------------------------------------------------- utilità
def sniff(b: bytes) -> Optional[str]:
    if b.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if b.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def save_image_bytes(data: bytes) -> str:
    ext = sniff(data)
    if not ext:
        raise HTTPException(400, "Formato immagine non supportato (usa PNG, JPG, WEBP o GIF)")
    name = hashlib.sha1(data).hexdigest()[:16] + "." + ext
    p = db.IMG_DIR / name
    if not p.exists():
        p.write_bytes(data)
    return name


def store_upload(upload: UploadFile) -> str:
    data = upload.file.read(MAX_IMG + 1)
    if len(data) > MAX_IMG:
        raise HTTPException(413, "Immagine troppo grande (max 8 MB)")
    return save_image_bytes(data)


def drop_if_orphan(c: sqlite3.Connection, name: Optional[str]) -> None:
    if name and not c.execute("SELECT 1 FROM questions WHERE image=? LIMIT 1", (name,)).fetchone():
        try:
            (db.IMG_DIR / name).unlink()
        except FileNotFoundError:
            pass


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        raise HTTPException(400, "Il testo della domanda è vuoto")
    if len(text) > 2000:
        raise HTTPException(400, "Testo troppo lungo (max 2000 caratteri)")
    return text


def check_answer(a: int) -> int:
    if a not in (0, 1):
        raise HTTPException(400, "La risposta deve essere Vero (1) o Falso (0)")
    return a


def parse_topic(c: sqlite3.Connection, raw: Optional[str]) -> Optional[int]:
    if raw is None or str(raw).strip() in ("", "null", "none"):
        return None
    try:
        tid = int(raw)
    except ValueError:
        raise HTTPException(400, "Argomento non valido")
    if not c.execute("SELECT 1 FROM topics WHERE id=?", (tid,)).fetchone():
        raise HTTPException(400, "Argomento inesistente")
    return tid


Q_SELECT = ("SELECT q.*, t.name AS topic_name FROM questions q "
            "LEFT JOIN topics t ON t.id = q.topic_id")


def qdict(r: sqlite3.Row) -> dict:
    d = {k: r[k] for k in r.keys() if k != "norm"}
    d["image"] = "/media/" + r["image"] if r["image"] else None
    return d


def get_question(c: sqlite3.Connection, qid: int) -> sqlite3.Row:
    r = c.execute(Q_SELECT + " WHERE q.id=?", (qid,)).fetchone()
    if not r:
        raise HTTPException(404, "Domanda non trovata")
    return r


# ---------------------------------------------------------------- login
class LoginIn(BaseModel):
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "?"
    auth.throttle(ip)
    if not auth.check_password(body.password):
        auth.register_fail(ip)
        raise HTTPException(401, "Password errata")
    auth.register_ok(ip)
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(auth.COOKIE, auth.make_token(), max_age=auth.MAX_AGE,
                        httponly=True, samesite="lax", secure=secure)
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE)
    return {"ok": True}


@api.get("/me")
def me():
    return {"ok": True}


# ---------------------------------------------------------------- argomenti
class TopicIn(BaseModel):
    name: str
    keywords: str = ""


@api.get("/topics")
def list_topics(c=Depends(get_conn)):
    rows = c.execute(
        "SELECT t.id, t.name, t.keywords, t.position, COUNT(q.id) AS count "
        "FROM topics t LEFT JOIN questions q ON q.topic_id = t.id "
        "GROUP BY t.id ORDER BY t.position, t.id"
    ).fetchall()
    return [dict(r) for r in rows]


@api.post("/topics")
def create_topic(body: TopicIn, c=Depends(get_conn)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nome vuoto")
    pos = c.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM topics").fetchone()[0]
    try:
        cur = c.execute("INSERT INTO topics (name, keywords, position) VALUES (?, ?, ?)",
                        (name, body.keywords.strip(), pos))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Argomento già esistente")
    c.commit()
    return {"id": cur.lastrowid}


@api.put("/topics/{tid}")
def update_topic(tid: int, body: TopicIn, c=Depends(get_conn)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nome vuoto")
    try:
        cur = c.execute("UPDATE topics SET name=?, keywords=? WHERE id=?",
                        (name, body.keywords.strip(), tid))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Argomento già esistente")
    if cur.rowcount == 0:
        raise HTTPException(404, "Argomento non trovato")
    c.commit()
    return {"ok": True}


@api.delete("/topics/{tid}")
def delete_topic(tid: int, c=Depends(get_conn)):
    c.execute("DELETE FROM topics WHERE id=?", (tid,))
    c.commit()
    return {"ok": True}


# ---------------------------------------------------------------- domande
@api.get("/questions")
def list_questions(q: str = "", topic: str = "", status: str = "all",
                   limit: int = 40, offset: int = 0, c=Depends(get_conn)):
    where, args = [], []
    for w in db.norm(q).split():
        where.append("q.norm LIKE ?")
        args.append(f"%{w}%")
    if topic == "none":
        where.append("q.topic_id IS NULL")
    elif topic.isdigit():
        where.append("q.topic_id = ?")
        args.append(int(topic))
    if status == "unseen":
        where.append("q.seen = 0")
    elif status == "review":
        where.append(f"q.wrong > 0 AND q.streak < {MASTERED_STREAK}")
    elif status == "mastered":
        where.append(f"q.streak >= {MASTERED_STREAK}")
    cond = (" WHERE " + " AND ".join(where)) if where else ""
    total = c.execute("SELECT COUNT(*) FROM questions q" + cond, args).fetchone()[0]
    limit = max(1, min(limit, 200))
    rows = c.execute(Q_SELECT + cond + " ORDER BY q.id DESC LIMIT ? OFFSET ?",
                     args + [limit, max(0, offset)]).fetchall()
    return {"items": [qdict(r) for r in rows], "total": total}


@api.post("/questions")
def create_question(text: str = Form(...), answer: int = Form(...),
                    topic_id: Optional[str] = Form(None),
                    image: Optional[UploadFile] = File(None),
                    c=Depends(get_conn)):
    text = clean_text(text)
    check_answer(answer)
    tid = parse_topic(c, topic_id)
    n = db.norm(text)
    img = store_upload(image) if image is not None and image.filename else None

    ex = c.execute("SELECT * FROM questions WHERE norm=?", (n,)).fetchone()
    if ex:
        # Domanda già presente: la ho sbagliata di nuovo -> aggiorno le statistiche.
        ts = now()
        c.execute("UPDATE questions SET seen=seen+1, wrong=wrong+1, streak=0, "
                  "last_seen=?, last_result=0, image=COALESCE(image, ?), "
                  "topic_id=COALESCE(topic_id, ?) WHERE id=?", (ts, img, tid, ex["id"]))
        c.execute("INSERT INTO attempts (question_id, ts, correct) VALUES (?, ?, 0)", (ex["id"], ts))
        c.commit()
        drop_if_orphan(c, img)
        return {"duplicate": True, "question": qdict(get_question(c, ex["id"]))}

    cur = c.execute("INSERT INTO questions (text, norm, answer, image, topic_id, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)", (text, n, answer, img, tid, now()))
    c.commit()
    return {"duplicate": False, "question": qdict(get_question(c, cur.lastrowid))}


@api.put("/questions/{qid}")
def update_question(qid: int, text: str = Form(...), answer: int = Form(...),
                    topic_id: Optional[str] = Form(None), remove_image: int = Form(0),
                    image: Optional[UploadFile] = File(None), c=Depends(get_conn)):
    row = get_question(c, qid)
    text = clean_text(text)
    check_answer(answer)
    tid = parse_topic(c, topic_id)
    n = db.norm(text)
    if c.execute("SELECT 1 FROM questions WHERE norm=? AND id<>?", (n, qid)).fetchone():
        raise HTTPException(409, "Esiste già una domanda identica")
    new_img = row["image"]
    if image is not None and image.filename:
        new_img = store_upload(image)
    elif remove_image:
        new_img = None
    c.execute("UPDATE questions SET text=?, norm=?, answer=?, topic_id=?, image=? WHERE id=?",
              (text, n, answer, tid, new_img, qid))
    c.commit()
    if new_img != row["image"]:
        drop_if_orphan(c, row["image"])
    return {"question": qdict(get_question(c, qid))}


@api.delete("/questions/{qid}")
def delete_question(qid: int, c=Depends(get_conn)):
    row = c.execute("SELECT image FROM questions WHERE id=?", (qid,)).fetchone()
    if not row:
        raise HTTPException(404, "Domanda non trovata")
    c.execute("DELETE FROM questions WHERE id=?", (qid,))
    c.commit()
    drop_if_orphan(c, row["image"])
    return {"ok": True}


@app.get("/media/{name}", dependencies=[Depends(auth.require_auth)])
def media(name: str):
    if not IMAGE_RE.match(name):
        raise HTTPException(404)
    safe_name = Path(name).name
    if safe_name != name:
        raise HTTPException(404)
    image_dir = db.IMG_DIR.resolve()
    p = (image_dir / safe_name).resolve()
    if not p.is_relative_to(image_dir) or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------------------------------------------------------------- quiz
def _weight(r: sqlite3.Row) -> float:
    w = 1.0
    w += 2 if r["seen"] == 0 else 3 * r["wrong"] / r["seen"]
    if r["last_result"] == 0:
        w += 2
    w -= min(r["streak"], 5) * 0.35
    return max(w, 0.15)


def _weighted_sample(rows: List[sqlite3.Row], k: int) -> List[sqlite3.Row]:
    pool = [(_weight(r), r) for r in rows]
    out = []
    for _ in range(min(k, len(pool))):
        x = random.uniform(0, sum(w for w, _ in pool))
        acc = 0.0
        pick = len(pool) - 1
        for i, (w, _) in enumerate(pool):
            acc += w
            if acc >= x:
                pick = i
                break
        out.append(pool.pop(pick)[1])
    return out


@api.get("/quiz")
def make_quiz(mode: str = "free", count: int = 20, topic_id: Optional[int] = None,
              ids: str = "", c=Depends(get_conn)):
    rows = c.execute(Q_SELECT).fetchall()
    count = max(1, min(count, 500))
    if mode == "topic":
        rows = [r for r in rows if r["topic_id"] == topic_id]
    elif mode == "unseen":
        rows = [r for r in rows if r["seen"] == 0]
    elif mode == "wrongest":
        rows = [r for r in rows if r["wrong"] > 0]
    elif mode == "ids":
        wanted = {int(x) for x in ids.split(",") if x.strip().isdigit()}
        rows = [r for r in rows if r["id"] in wanted]
        count = len(rows)

    if mode == "sim":
        picked = random.sample(rows, min(30, len(rows)))
    elif mode == "smart":
        picked = _weighted_sample(rows, count)
    elif mode == "wrongest":
        rows.sort(key=lambda r: (r["wrong"] / max(r["seen"], 1), r["wrong"]), reverse=True)
        picked = rows[:count]
        random.shuffle(picked)
    else:
        picked = random.sample(rows, min(count, len(rows)))

    n = len(picked)
    return {
        "mode": mode,
        "questions": [{"id": r["id"], "text": r["text"], "answer": r["answer"],
                       "image": "/media/" + r["image"] if r["image"] else None,
                       "topic_id": r["topic_id"], "topic_name": r["topic_name"]}
                      for r in picked],
        "time_limit": n * 40 if mode == "sim" else None,   # 30 domande = 20 minuti
        "max_errors": (3 if n >= 30 else n // 10) if mode == "sim" else None,
    }


class AnswerIn(BaseModel):
    question_id: int
    answer: int


class FinishIn(BaseModel):
    mode: str
    duration: int = 0
    max_errors: Optional[int] = None
    question_ids: List[int]
    answers: List[AnswerIn]


@api.post("/quiz/finish")
def finish_quiz(body: FinishIn, c=Depends(get_conn)):
    given = {a.question_id: a.answer for a in body.answers if a.answer in (0, 1)}
    ids = list(dict.fromkeys(body.question_ids))[:500]
    if not ids:
        raise HTTPException(400, "Quiz vuoto")
    marks = ",".join("?" * len(ids))
    rows = {r["id"]: r for r in c.execute(
        f"SELECT * FROM questions WHERE id IN ({marks})", ids).fetchall()}
    ids = [i for i in ids if i in rows]          # ignora domande eliminate nel frattempo
    total = len(ids)
    ts = now()
    correct = 0
    wrong_list = []
    results = []
    for qid in ids:
        r = rows[qid]
        g = given.get(qid)
        ok = g is not None and g == r["answer"]
        correct += ok
        results.append((qid, g, ok))
        if not ok:
            wrong_list.append({
                "id": qid, "text": r["text"], "answer": r["answer"], "given": g,
                "image": "/media/" + r["image"] if r["image"] else None})
    errors = total - correct
    passed = None
    if body.mode == "sim" and body.max_errors is not None:
        passed = 1 if errors <= body.max_errors else 0
    cur = c.execute("INSERT INTO sessions (mode, ts, total, correct, errors, duration, passed) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (body.mode[:20], ts, total, correct, errors, max(0, body.duration), passed))
    sid = cur.lastrowid
    for qid, g, ok in results:
        if g is None:            # senza risposta: errore nel punteggio ma non nelle statistiche
            continue
        if ok:
            c.execute("UPDATE questions SET seen=seen+1, correct=correct+1, streak=streak+1, "
                      "last_seen=?, last_result=1 WHERE id=?", (ts, qid))
        else:
            c.execute("UPDATE questions SET seen=seen+1, wrong=wrong+1, streak=0, "
                      "last_seen=?, last_result=0 WHERE id=?", (ts, qid))
        c.execute("INSERT INTO attempts (question_id, session_id, ts, correct) VALUES (?, ?, ?, ?)",
                  (qid, sid, ts, 1 if ok else 0))
    c.commit()
    return {"session_id": sid, "total": total, "correct": correct, "errors": errors,
            "answered": len([1 for _, g, _ in results if g is not None]),
            "unanswered": len([1 for _, g, _ in results if g is None]),
            "passed": None if passed is None else bool(passed),
            "max_errors": body.max_errors, "duration": body.duration, "wrong": wrong_list}


# ---------------------------------------------------------------- statistiche
@api.get("/stats")
def stats(c=Depends(get_conn)):
    t = c.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(seen=0),0) AS unseen, "
        f"COALESCE(SUM(streak>={MASTERED_STREAK}),0) AS mastered, "
        f"COALESCE(SUM(wrong>0 AND streak<{MASTERED_STREAK}),0) AS review, "
        "COALESCE(SUM(correct),0) AS correct, COALESCE(SUM(wrong),0) AS wrong FROM questions"
    ).fetchone()
    attempts = t["correct"] + t["wrong"]

    agg = c.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(mode='sim'),0) AS sim, "
        "COALESCE(SUM(passed=1),0) AS passed, COALESCE(SUM(correct),0) AS c, "
        "COALESCE(SUM(total),0) AS t FROM sessions").fetchone()
    sessions = [dict(r) for r in c.execute(
        "SELECT * FROM sessions ORDER BY id DESC LIMIT 20").fetchall()][::-1]

    topics = []
    for r in c.execute(
            "SELECT t.id, t.name, COUNT(q.id) AS n, COALESCE(SUM(q.correct),0) AS correct, "
            "COALESCE(SUM(q.wrong),0) AS wrong FROM topics t LEFT JOIN questions q "
            "ON q.topic_id = t.id GROUP BY t.id HAVING n > 0 ORDER BY n DESC").fetchall():
        a = r["correct"] + r["wrong"]
        topics.append({"id": r["id"], "name": r["name"], "count": r["n"], "attempts": a,
                       "accuracy": r["correct"] / a if a else None})
    r = c.execute("SELECT COUNT(*) AS n, COALESCE(SUM(correct),0) AS correct, "
                  "COALESCE(SUM(wrong),0) AS wrong FROM questions WHERE topic_id IS NULL").fetchone()
    if r["n"]:
        a = r["correct"] + r["wrong"]
        topics.append({"id": None, "name": "Senza argomento", "count": r["n"], "attempts": a,
                       "accuracy": r["correct"] / a if a else None})

    hardest = [qdict(r) for r in c.execute(
        Q_SELECT + " WHERE q.wrong > 0 ORDER BY CAST(q.wrong AS REAL) / q.seen DESC, "
                   "q.wrong DESC LIMIT 8").fetchall()]

    days = {r["d"]: r["n"] for r in c.execute(
        "SELECT date(ts, 'unixepoch', 'localtime') AS d, COUNT(*) AS n FROM attempts "
        "WHERE ts >= ? GROUP BY d", (now() - 400 * 86400,)).fetchall()}
    today = date.today()
    activity = [{"day": (today - timedelta(days=i)).isoformat(),
                 "count": days.get((today - timedelta(days=i)).isoformat(), 0)}
                for i in range(13, -1, -1)]
    streak_days = 0
    d = today if days.get(today.isoformat()) else today - timedelta(days=1)
    while days.get(d.isoformat()):
        streak_days += 1
        d -= timedelta(days=1)

    return {
        "questions": t["n"], "unseen": t["unseen"], "mastered": t["mastered"],
        "review": t["review"],
        "accuracy": t["correct"] / attempts if attempts else None,
        "attempts": attempts,
        "sessions_total": agg["n"], "sim_total": agg["sim"], "sim_passed": agg["passed"],
        "avg_score": agg["c"] / agg["t"] if agg["t"] else None,
        "sessions": sessions, "topics": topics, "hardest": hardest,
        "activity": activity, "streak_days": streak_days,
    }


# ---------------------------------------------------------------- backup
@api.get("/export")
def export_backup(c=Depends(get_conn)):
    topics = [dict(r) for r in c.execute("SELECT * FROM topics ORDER BY position, id")]
    tmap = {t["id"]: t["name"] for t in topics}
    questions = []
    images = set()
    for r in c.execute("SELECT * FROM questions ORDER BY id"):
        d = {k: r[k] for k in ("text", "answer", "image", "created_at", "seen", "correct",
                               "wrong", "streak", "last_seen", "last_result")}
        d["topic"] = tmap.get(r["topic_id"])
        questions.append(d)
        if r["image"]:
            images.add(r["image"])
    sessions = [dict(r) for r in c.execute("SELECT * FROM sessions ORDER BY id")]
    payload = {"version": 1, "exported_at": now(),
               "topics": [{"name": t["name"], "keywords": t["keywords"]} for t in topics],
               "questions": questions, "sessions": sessions}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("questions.json", json.dumps(payload, ensure_ascii=False, indent=1))
        for name in images:
            p = db.IMG_DIR / name
            if p.exists():
                z.write(p, "images/" + name)
    buf.seek(0)
    fname = f"second-chance-patente-backup-{date.today().strftime('%Y%m%d')}.zip"
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@api.post("/import")
def import_backup(file: UploadFile = File(...), c=Depends(get_conn)):
    raw = file.file.read(300 * 1024 * 1024 + 1)
    if len(raw) > 300 * 1024 * 1024:
        raise HTTPException(413, "File troppo grande")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        data = json.loads(z.read("questions.json").decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Backup non valido (serve lo zip esportato dall'app)")
    questions = data.get("questions", [])
    if not isinstance(questions, list) or len(questions) > 50000:
        raise HTTPException(400, "Backup non valido")

    tmap = {r["name"]: r["id"] for r in c.execute("SELECT id, name FROM topics")}
    for t in data.get("topics", []):
        name = str(t.get("name", "")).strip()
        if name and name not in tmap:
            pos = c.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM topics").fetchone()[0]
            cur = c.execute("INSERT INTO topics (name, keywords, position) VALUES (?, ?, ?)",
                            (name, str(t.get("keywords", "")), pos))
            tmap[name] = cur.lastrowid

    added = skipped = 0
    for q in questions:
        try:
            text = clean_text(str(q["text"]))
            ans = check_answer(int(q["answer"]))
        except (KeyError, ValueError, HTTPException):
            skipped += 1
            continue
        n = db.norm(text)
        if c.execute("SELECT 1 FROM questions WHERE norm=?", (n,)).fetchone():
            skipped += 1
            continue
        img = None
        name = q.get("image")
        if name and IMAGE_RE.match(str(name)):
            try:
                info = z.getinfo("images/" + name)
                if info.file_size <= MAX_IMG:
                    img = save_image_bytes(z.read(info))
            except (KeyError, HTTPException):
                img = None
        c.execute(
            "INSERT INTO questions (text, norm, answer, image, topic_id, created_at, seen, "
            "correct, wrong, streak, last_seen, last_result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (text, n, ans, img, tmap.get(q.get("topic")), int(q.get("created_at") or now()),
             int(q.get("seen") or 0), int(q.get("correct") or 0), int(q.get("wrong") or 0),
             int(q.get("streak") or 0), q.get("last_seen"), q.get("last_result")))
        added += 1
    for s in data.get("sessions", []):
        try:
            c.execute("INSERT INTO sessions (mode, ts, total, correct, errors, duration, passed) "
                      "VALUES (?,?,?,?,?,?,?)",
                      (str(s["mode"])[:20], int(s["ts"]), int(s["total"]), int(s["correct"]),
                       int(s["errors"]), int(s["duration"]), s.get("passed")))
        except (KeyError, ValueError, TypeError):
            pass
    c.commit()
    return {"added": added, "skipped": skipped}


# ---------------------------------------------------------------- app
app.include_router(api)


@app.middleware("http")
async def no_cache(request: Request, call_next):
    resp = await call_next(request)
    if not request.url.path.startswith(("/api", "/media")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


app.mount("/", StaticFiles(directory=BASE / "static", html=True), name="static")
