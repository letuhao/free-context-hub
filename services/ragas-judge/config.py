"""Phase 16 Sprint 16.2 — ragas judge sidecar config.

Reads env vars for the judge LLM endpoint, embedding endpoint, and service
behavior. Defaults assume LM Studio running on the host with Gemma-4-26B-A4B.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Config:
    # --- Judge LLM (chat) ---
    # OpenAI-compatible base URL. From within docker, the host's LM Studio is
    # reachable via host.docker.internal:1234 (works on Docker Desktop on
    # Windows/Mac; on Linux requires --add-host or compose extra_hosts).
    judge_base_url: str
    judge_api_key: str
    judge_model: str
    judge_temperature: float
    judge_seed: int
    judge_timeout_s: int

    # --- Embeddings (for ragas metrics that need vector similarity) ---
    embeddings_base_url: str
    embeddings_api_key: str
    embeddings_model: str

    # --- Service ---
    port: int
    log_level: str

    @staticmethod
    def _normalize_openai_base_url(url: str) -> str:
        """Ensure the URL has the `/v1` suffix the OpenAI client expects.

        The project's existing services (mcp, worker) consume EMBEDDINGS_BASE_URL
        without /v1 because they hit different paths. The openai-python client
        appends `/embeddings` (and `/chat/completions`) directly, so it MUST
        already have the `/v1` prefix on the base URL.
        """
        url = url.rstrip("/")
        if not url.endswith("/v1"):
            url = url + "/v1"
        return url

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            judge_base_url=cls._normalize_openai_base_url(
                os.environ.get(
                    "JUDGE_AGENT_BASE_URL", "http://host.docker.internal:1234/v1"
                )
            ),
            judge_api_key=os.environ.get("JUDGE_AGENT_API_KEY", "lm-studio"),
            # Single source of truth: default to the canonical chat model
            # (CHAT_MODEL) so the judge SHARES the loaded chat instance and never
            # triggers an LM Studio swap. docker-compose passes JUDGE_AGENT_MODEL
            # from the canonical env. Override only for a deliberate cross-judge
            # measurement (which should run in the deferred-judge phase).
            judge_model=os.environ.get(
                "JUDGE_AGENT_MODEL", "google/gemma-4-26b-a4b-qat"
            ),
            # Gemma 4 26B-A4B at temp=0 degenerates into token-repetition loops when
            # producing schema-constrained output. 0.2 is the lowest temp that
            # reliably breaks the loop while keeping outputs near-deterministic
            # for A/B retrieval comparison.
            judge_temperature=float(os.environ.get("JUDGE_TEMPERATURE", "0.2")),
            judge_seed=int(os.environ.get("JUDGE_SEED", "42")),
            judge_timeout_s=int(os.environ.get("JUDGE_TIMEOUT_S", "60")),
            embeddings_base_url=cls._normalize_openai_base_url(
                os.environ.get(
                    "EMBEDDINGS_BASE_URL", "http://host.docker.internal:1234/v1"
                )
            ),
            embeddings_api_key=os.environ.get("EMBEDDINGS_API_KEY", "lm-studio"),
            embeddings_model=os.environ.get(
                "EMBEDDINGS_MODEL", "text-embedding-bge-m3"
            ),
            port=int(os.environ.get("PORT", "8000")),
            log_level=os.environ.get("LOG_LEVEL", "info"),
        )


def compute_prompts_hash(extra_prompts: Optional[dict] = None) -> str:
    """Compute a sha256 hash of the prompt configuration.

    Stable across container restarts as long as ragas version + custom prompts
    don't change. Recorded in baseline manifest per Phase 16 DESIGN §3.1 so
    historical diffs can detect prompt drift.
    """
    import ragas

    pieces = [
        f"ragas=={getattr(ragas, '__version__', 'unknown')}",
    ]
    if extra_prompts:
        for k in sorted(extra_prompts.keys()):
            pieces.append(f"{k}={extra_prompts[k]}")

    blob = "|".join(pieces).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]  # short hash for log readability
