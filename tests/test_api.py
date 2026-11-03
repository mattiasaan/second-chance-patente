"""Test di base delle API. Esegui con:  pytest"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["PATENTE_PASSWORD"] = "test-password"
os.environ["PATENTE_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154"
    "78da63f8ffff3f0005fe02fea7d6054e0000000049454e44ae426082")


@pytest.fixture(scope="module")
def client():
    c = TestClient(app)
    assert c.post("/api/login", json={"password": "test-password"}).status_code == 200
    return c


def test_requires_login():
    anon = TestClient(app)
    assert anon.get("/api/topics").status_code == 401
    assert anon.post("/api/login", json={"password": "sbagliata"}).status_code == 401


def test_topics_seeded(client):
    assert len(client.get("/api/topics").json()) >= 20


def test_question_lifecycle_and_duplicates(client):
    r = client.post("/api/questions", data={"text": "La fermata è vietata al mercato", "answer": "0"},
                    files={"image": ("a.png", PNG, "image/png")}).json()
    q = r["question"]
    assert not r["duplicate"] and q["image"].startswith("/media/")
    assert client.get(q["image"]).status_code == 200
    dup = client.post("/api/questions", data={"text": "la FERMATA è vietata al mercato!", "answer": "0"}).json()
    assert dup["duplicate"] and dup["question"]["wrong"] == 1
    upd = client.put(f"/api/questions/{q['id']}", data={"text": "Testo nuovo", "answer": "1",
                                                          "remove_image": "1"}).json()["question"]
    assert upd["image"] is None and upd["answer"] == 1
    assert client.delete(f"/api/questions/{q['id']}").status_code == 200


def test_bad_image_rejected(client):
    r = client.post("/api/questions", data={"text": "x y z", "answer": "1"},
                    files={"image": ("a.png", b"not an image", "image/png")})
    assert r.status_code == 400


def test_quiz_and_stats(client):
    for i in range(5):
        client.post("/api/questions", data={"text": f"domanda di prova {i}", "answer": str(i % 2)})
    quiz = client.get("/api/quiz?mode=sim").json()
    qs = quiz["questions"]
    assert quiz["time_limit"] == len(qs) * 40
    res = client.post("/api/quiz/finish", json={
        "mode": "sim", "duration": 10, "max_errors": quiz["max_errors"],
        "question_ids": [x["id"] for x in qs],
        "answers": [{"question_id": qs[0]["id"], "answer": qs[0]["answer"]}]}).json()
    assert res["correct"] == 1 and res["unanswered"] == len(qs) - 1
    stats = client.get("/api/stats").json()
    assert stats["sessions_total"] >= 1 and stats["questions"] >= 5


def test_backup_roundtrip(client):
    blob = client.get("/api/export").content
    res = client.post("/api/import", files={"file": ("b.zip", blob, "application/zip")}).json()
    assert res["added"] == 0 and res["skipped"] >= 5
