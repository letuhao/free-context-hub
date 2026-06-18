# Phase 17.3 — NLI fact-checking judge sidecar.
# Stateless FastAPI service scoring answer claims vs contexts with a cross-encoder
# NLI model. Self-contained — no LM Studio dependency (model baked in at build).

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch FIRST (from the PyTorch CPU index) so sentence-transformers does
# not drag in the multi-GB CUDA build on linux.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake the NLI model into the image so the container needs no network at runtime.
# Override NLI_MODEL at build to bake a different one.
ARG NLI_MODEL=cross-encoder/nli-deberta-v3-small
ENV NLI_MODEL=${NLI_MODEL}
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('${NLI_MODEL}')"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
