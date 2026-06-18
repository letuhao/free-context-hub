"""Phase 17.3 — NLI judge scoring core (pure, torch-free, unit-testable).

The model inference lives in main.py; everything here is deterministic string/math
so it can be unit-tested without loading a 280MB model. See
docs/specs/2026-06-19-phase-17.3-nli-judge.md.
"""

from __future__ import annotations

import re
from typing import Optional

# cross-encoder/nli-deberta-v3-* label order (from the model's id2label).
LABELS = {0: "contradiction", 1: "entailment", 2: "neutral"}

# Split on sentence terminators followed by whitespace. Dependency-free; coarser
# than RAGAS's LLM statement-extraction but adequate for the short global answers.
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def split_claims(answer: Optional[str]) -> list[str]:
    """Sentence-split an answer into claims. Drops blanks and trivial fragments
    (< 3 chars, e.g. a stray '1.' or '-')."""
    text = (answer or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in _SENT_SPLIT.split(text)]
    return [p for p in parts if len(p) >= 3]


def aggregate(labels: list[str]) -> dict:
    """Turn per-claim NLI labels into the three faithfulness signals.

    - strict   = entailment / n            (≈ RAGAS: only entailed claims count)
    - lenient  = (entailment+neutral) / n  = 1 − contradiction_rate
    - contradiction_rate = contradiction / n  (surface-agnostic hallucination signal)

    Empty answer → all None (no claims to score; caller treats as N/A, not 0).
    """
    n = len(labels)
    if n == 0:
        return {
            "n_claims": 0,
            "nli_faithfulness_strict": None,
            "nli_faithfulness_lenient": None,
            "nli_contradiction_rate": None,
        }
    ent = sum(1 for x in labels if x == "entailment")
    con = sum(1 for x in labels if x == "contradiction")
    neu = sum(1 for x in labels if x == "neutral")
    return {
        "n_claims": n,
        "n_entailment": ent,
        "n_contradiction": con,
        "n_neutral": neu,
        "nli_faithfulness_strict": ent / n,
        "nli_faithfulness_lenient": (ent + neu) / n,
        "nli_contradiction_rate": con / n,
    }
