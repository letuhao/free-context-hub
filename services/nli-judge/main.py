"""Phase 17.3 — NLI fact-checking judge sidecar.

A stateless FastAPI service that scores answer claims against retrieved contexts with
a cross-encoder NLI model (entailment / contradiction / neutral). Unlike ragas-judge
it needs NO LM Studio — the model is self-contained (baked into the image).

Endpoints:
  GET  /health  → {status, model, loaded}                         (no inference)
  POST /entail  → {label, scores}                                 (one premise/hypothesis)
  POST /score   → {n_claims, per_claim[], nli_faithfulness_*, …}  (answer vs contexts)

Design: docs/specs/2026-06-19-phase-17.3-nli-judge.md
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from scoring import LABELS, aggregate, split_claims

MODEL_NAME = os.environ.get("NLI_MODEL", "cross-encoder/nli-deberta-v3-small")
MAX_LENGTH = int(os.environ.get("NLI_MAX_LENGTH", "512"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()

logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
log = logging.getLogger("nli-judge")

_state: dict = {"model": None}


def _classify(pairs: list[tuple[str, str]]) -> list[dict]:
    """Run NLI on (premise, hypothesis) pairs → [{label, scores}]. Empty → []."""
    if not pairs:
        return []
    model = _state["model"]
    # apply_softmax=True → per-row probabilities over [contradiction, entailment, neutral].
    logits = model.predict(pairs, apply_softmax=True)
    out: list[dict] = []
    for row in logits:
        scores = {LABELS[i]: round(float(row[i]), 4) for i in range(3)}
        label = max(scores, key=scores.get)  # argmax label
        out.append({"label": label, "scores": scores})
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    from sentence_transformers import CrossEncoder

    log.info("loading NLI model: %s (max_length=%d)", MODEL_NAME, MAX_LENGTH)
    model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH)
    _state["model"] = model
    log.info("NLI model loaded")
    yield
    _state["model"] = None


app = FastAPI(title="nli-judge", version="1.0", lifespan=lifespan)


class HealthResponse(BaseModel):
    status: str
    model: str
    loaded: bool


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", model=MODEL_NAME, loaded=_state["model"] is not None)


class EntailRequest(BaseModel):
    premise: str
    hypothesis: str


@app.post("/entail")
async def entail(req: EntailRequest) -> dict:
    return _classify([(req.premise, req.hypothesis)])[0]


class ScoreRequest(BaseModel):
    answer: str
    contexts: list[str]


@app.post("/score")
async def score(req: ScoreRequest) -> dict:
    claims = split_claims(req.answer)
    premise = "\n\n".join(c for c in req.contexts if c)
    per = _classify([(premise, c) for c in claims])
    for item, claim in zip(per, claims):
        item["claim"] = claim
    agg = aggregate([p["label"] for p in per])
    return {**agg, "per_claim": per, "model": MODEL_NAME}
