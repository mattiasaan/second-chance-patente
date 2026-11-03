#!/usr/bin/env bash
# Avvia Second Chance Patente. Uso: ./run.sh   (porta di default 8000, cambiabile con PORT=9000 ./run.sh)
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/uvicorn ]; then UVICORN=.venv/bin/uvicorn; else UVICORN=uvicorn; fi
exec "$UVICORN" app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
