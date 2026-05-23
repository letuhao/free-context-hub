# Phase 16 Sprint 16.2 — Ragas judge sidecar
# Stateless FastAPI service that proxies ragas evaluate() calls.
# LM Studio (on host) provides the judge LLM via JUDGE_AGENT_BASE_URL.

FROM python:3.11-slim

WORKDIR /app

# System deps: build tools needed for some ragas transitive deps (numpy, pandas wheels usually ship binary, but be safe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY . .

# Default port 8000 internal; docker-compose maps to 3005 on host
EXPOSE 8000

# Healthcheck — hits /health which does NOT call LM Studio (cheap probe).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
