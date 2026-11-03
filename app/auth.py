"""Autenticazione a password singola con cookie firmato."""
import hashlib
import hmac
import secrets
import time
from pathlib import Path
from typing import Dict, Tuple

from fastapi import HTTPException, Request

COOKIE = "pq_session"
MAX_AGE = 60 * 60 * 24 * 30  # 30 giorni

_key = b""
_password = ""
_fails: Dict[str, Tuple[int, float]] = {}  # ip -> (errori, bloccato_fino_a)


def init(data_dir: Path, password: str) -> None:
    global _key, _password
    f = data_dir / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
        try:
            f.chmod(0o600)
        except OSError:
            pass
    _password = password
    # La chiave dipende anche dalla password: cambiandola, tutte le sessioni decadono.
    _key = (f.read_text().strip() + "|" + hashlib.sha256(password.encode()).hexdigest()).encode()


def _sign(payload: str) -> str:
    return hmac.new(_key, payload.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    exp = str(int(time.time()) + MAX_AGE)
    return f"{exp}.{_sign(exp)}"


def valid_token(token) -> bool:
    if not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(sig, _sign(exp))


def check_password(p: str) -> bool:
    return hmac.compare_digest(p.encode(), _password.encode())


def throttle(ip: str) -> None:
    n, until = _fails.get(ip, (0, 0.0))
    if until > time.time():
        raise HTTPException(429, "Troppi tentativi, riprova tra un minuto")


def register_fail(ip: str) -> None:
    n, until = _fails.get(ip, (0, 0.0))
    n += 1
    if n >= 5:
        _fails[ip] = (0, time.time() + 60)
    else:
        _fails[ip] = (n, 0.0)


def register_ok(ip: str) -> None:
    _fails.pop(ip, None)


def require_auth(request: Request) -> None:
    if not valid_token(request.cookies.get(COOKIE)):
        raise HTTPException(401, "Non autenticato")
