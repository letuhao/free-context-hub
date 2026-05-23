"""Phase 16 Sprint 16.2 — Ragas judge sidecar entry point.

Stateless FastAPI service that wraps ragas evaluate() so the TypeScript
runBaseline.ts harness can score (question, answer, contexts, ground_truth)
tuples via HTTP. Per-category metric routing implements DESIGN §4.6.

Endpoints:
    GET  /health  — liveness + judge config info
    POST /score   — score a single (question, answer, contexts) tuple

The LLM (chat + embeddings) is reached via JUDGE_AGENT_BASE_URL /
EMBEDDINGS_BASE_URL (OpenAI-compatible). Defaults target LM Studio on the
host at host.docker.internal:1234.

NOTE: _compat is imported FIRST (before any other ragas/langchain code)
because ragas 0.4.x has a stale eager import that needs a stub. See
_compat.py for the full rationale.
"""

from __future__ import annotations

# Must be the FIRST import — see _compat.py docstring.
import _compat  # noqa: F401  (imported for side effect: installs sys.modules stub)

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config import Config, compute_prompts_hash

logger = logging.getLogger("ragas-judge")
logging.basicConfig(level=logging.INFO)


# ---------- Request / response models (DESIGN §4.2) ----------


class ContextItem(BaseModel):
    id: Optional[str] = None
    text: str


class ScoreOptions(BaseModel):
    include_reasons: bool = True
    temperature: Optional[float] = None
    cache_key: Optional[str] = None


class ScoreRequest(BaseModel):
    request_id: Optional[str] = None
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    contexts: list[ContextItem] = []
    ground_truth: Optional[str] = None
    # Category-aware routing per DESIGN §4.6. If absent, treated as 'standard'.
    answer_category: str = "standard"
    metrics: list[str] = Field(
        default_factory=lambda: [
            "faithfulness",
            "answer_relevancy",
            "context_precision",
            "context_recall",
        ]
    )
    options: ScoreOptions = Field(default_factory=ScoreOptions)


class ScoreError(BaseModel):
    metric: str
    error: str
    detail: Optional[str] = None


class ScoreResponse(BaseModel):
    request_id: Optional[str] = None
    scores: dict[str, Optional[float]]
    reasons: dict[str, str] = {}
    skipped: list[str] = []
    skip_reason: Optional[str] = None
    errors: list[ScoreError] = []
    judge_call_count: int = 0
    judge_latency_ms: int = 0
    cache_hit: bool = False


class HealthResponse(BaseModel):
    status: str
    ragas_version: str
    judge_endpoint: str
    judge_model: str
    embeddings_endpoint: str
    embeddings_model: str
    prompts_hash: str


# ---------- Per-category metric routing (DESIGN §4.6) ----------

STANDARD_METRICS = {
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
}


def metrics_for_category(category: str, requested: list[str]) -> dict[str, Any]:
    """Implements DESIGN §4.6 category-aware routing.

    - For 'no_answer' rows: skip faithfulness + answer_relevancy (pathological
      semantics on refusals); replace with custom 'refusal_correctness'.
    - For other categories: pass requested through unchanged.
    """
    if category == "no_answer":
        kept = [m for m in requested if m not in {"faithfulness", "answer_relevancy"}]
        if "refusal_correctness" not in kept:
            kept.append("refusal_correctness")
        return {
            "metrics": kept,
            "skipped": [
                m for m in requested if m in {"faithfulness", "answer_relevancy"}
            ],
            "skip_reason": "no_answer category: faithfulness/answer_relevancy have pathological semantics on refusals (replaced by refusal_correctness)",
        }
    return {"metrics": requested, "skipped": [], "skip_reason": None}


# ---------- LLM + metrics initialization (lazy on startup) ----------


def _build_openai_client(base_url: str, api_key: str, *, async_mode: bool = False):
    """Construct an OpenAI client pointing at the OpenAI-compatible endpoint.

    async_mode=True returns AsyncOpenAI — required by ragas metrics when using
    ascore() / agenerate(). async_mode=False returns the sync OpenAI client.
    """
    from openai import AsyncOpenAI, OpenAI

    cls = AsyncOpenAI if async_mode else OpenAI
    return cls(base_url=base_url, api_key=api_key)


def _init_llm(cfg: Config):
    """Construct a ragas LLM wrapper around an OpenAI-compatible local endpoint.

    ragas 0.4.x's llm_factory takes a model name + a pre-initialized client.
    We pass the AsyncOpenAI client because all our metric calls use ascore().
    """
    from ragas.llms import llm_factory

    client = _build_openai_client(
        cfg.judge_base_url, cfg.judge_api_key, async_mode=True
    )
    # _compat.py patches instructor.from_openai to use Mode.JSON_SCHEMA instead
    # of Mode.JSON, since LM Studio rejects response_format.type='json_object'.
    llm = llm_factory(
        model=cfg.judge_model,
        provider="openai",
        client=client,
        adapter="instructor",
        temperature=cfg.judge_temperature,
        seed=cfg.judge_seed,
    )
    return llm


def _init_embeddings(cfg: Config):
    """Construct a "modern" ragas embeddings instance for collections metrics.

    ragas 0.4.x collections metrics require `interface='modern'`. They reject
    LangchainEmbeddingsWrapper at __init__ time. embedding_factory with
    provider='openai' + a pre-built AsyncOpenAI client points at the
    OpenAI-compatible embeddings endpoint (LM Studio in our case).
    """
    from ragas.embeddings.base import embedding_factory

    openai_client = _build_openai_client(
        cfg.embeddings_base_url, cfg.embeddings_api_key, async_mode=True
    )
    return embedding_factory(
        provider="openai",
        model=cfg.embeddings_model,
        client=openai_client,
        interface="modern",
    )


def _init_metrics(llm, embeddings) -> dict[str, Any]:
    """Instantiate all standard ragas metrics with our judge LLM + embeddings."""
    from ragas.metrics.collections.faithfulness import Faithfulness
    from ragas.metrics.collections.answer_relevancy import AnswerRelevancy
    from ragas.metrics.collections.context_precision import ContextPrecision
    from ragas.metrics.collections.context_recall import ContextRecall

    return {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=embeddings),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
    }


# ---------- refusal_correctness custom metric ----------


async def _refusal_correctness(
    llm,
    question: str,
    answer: str,
    contexts: list[str],
    ground_truth: str,
) -> tuple[float, str]:
    """Custom metric for `no_answer` rows (DESIGN §4.6).

    Returns (score in {0.0, 0.5, 1.0}, reason). Score = (expresses_inability +
    abstains_from_fabrication) / 2.

    Uses a single judge LLM call with a binary-axes prompt. We use ragas's
    llm.agenerate() for structured output via the same provider.
    """
    from pydantic import BaseModel as _B

    class _Verdict(_B):
        expresses_inability: int  # 0 or 1
        abstains_from_fabrication: int  # 0 or 1
        reason: str

    ctxs_block = (
        "\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts))
        if contexts
        else "(no contexts retrieved)"
    )

    prompt = f"""You are evaluating an answer to a question that has NO answer in the provided contexts.
The ground truth indicates this is a NO_ANSWER case.

QUESTION:
{question}

CONTEXTS:
{ctxs_block}

ANSWER UNDER EVALUATION:
{answer}

GROUND TRUTH (indicates no answer exists):
{ground_truth}

Evaluate the answer on two binary axes:

1. expresses_inability: Does the answer acknowledge that it cannot answer / lacks the info / says 'not in context' / similar? (1 = yes, 0 = no)
2. abstains_from_fabrication: Does the answer avoid asserting facts not supported by the contexts? (1 = yes, 0 = no — answer fabricated content)

Return a JSON object with three fields: expresses_inability (int), abstains_from_fabrication (int), reason (string explanation, ≤2 sentences)."""

    verdict = await llm.agenerate(prompt, _Verdict)
    score = (verdict.expresses_inability + verdict.abstains_from_fabrication) / 2.0
    return score, verdict.reason


# ---------- Application state ----------


class AppState:
    config: Config
    ragas_version: str
    prompts_hash: str
    llm: Any = None
    embeddings: Any = None
    metrics: dict[str, Any] = {}

    def __init__(self):
        self.config = Config.from_env()
        try:
            import ragas

            self.ragas_version = getattr(ragas, "__version__", "unknown")
        except Exception:
            self.ragas_version = "import-failed"
        self.prompts_hash = compute_prompts_hash()

    def initialize_judge(self) -> None:
        """Lazy initialize the LLM + embeddings + metric instances.

        Called from the lifespan startup hook. If LM Studio is down at startup,
        this raises and uvicorn exits — easier to detect than a runtime failure
        on the first /score call.
        """
        logger.info("Initializing ragas LLM + embeddings + metrics...")
        self.llm = _init_llm(self.config)
        self.embeddings = _init_embeddings(self.config)
        self.metrics = _init_metrics(self.llm, self.embeddings)
        logger.info(
            "Initialized %d metrics: %s",
            len(self.metrics),
            sorted(self.metrics.keys()),
        )


state = AppState()


# ---------- App lifecycle ----------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup logging; initialize LLM lazily."""
    logger.info(
        "ragas-judge starting: ragas=%s, judge=%s @ %s, embeddings=%s @ %s, prompts_hash=%s",
        state.ragas_version,
        state.config.judge_model,
        state.config.judge_base_url,
        state.config.embeddings_model,
        state.config.embeddings_base_url,
        state.prompts_hash,
    )
    # NOTE: do NOT call initialize_judge() here unconditionally; it would
    # bind us to a live LM Studio at startup. Instead, initialize on first
    # /score call (warm-up cost paid once).
    yield
    logger.info("ragas-judge shutting down")


app = FastAPI(
    title="ragas-judge",
    version="0.1.0",
    description="Phase 16 Sprint 16.2 — RAG gen-eval scoring sidecar",
    lifespan=lifespan,
)


def _ensure_initialized() -> None:
    """Idempotent initializer — called from /score on first use."""
    if state.metrics:
        return
    state.initialize_judge()


# ---------- Endpoints ----------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe. Returns config info; does NOT call the judge LLM.

    Per DESIGN §4.4, the LLM endpoint reachability check is deferred to a
    periodic background probe (or to first /score call) to avoid spamming the
    judge on every health poll.
    """
    return HealthResponse(
        status="ok",
        ragas_version=state.ragas_version,
        judge_endpoint=state.config.judge_base_url,
        judge_model=state.config.judge_model,
        embeddings_endpoint=state.config.embeddings_base_url,
        embeddings_model=state.config.embeddings_model,
        prompts_hash=state.prompts_hash,
    )


async def _call_one_metric(
    metric_name: str,
    req: ScoreRequest,
    contexts_text: list[str],
) -> tuple[Optional[float], Optional[str], Optional[ScoreError]]:
    """Call a single metric's ascore() with the right kwargs for its signature.

    Returns (score, reason, error). At most one of (score, error) is non-None.
    """
    try:
        if metric_name == "faithfulness":
            metric = state.metrics["faithfulness"]
            result = await metric.ascore(
                user_input=req.question,
                response=req.answer,
                retrieved_contexts=contexts_text,
            )
        elif metric_name == "answer_relevancy":
            metric = state.metrics["answer_relevancy"]
            result = await metric.ascore(
                user_input=req.question,
                response=req.answer,
            )
        elif metric_name == "context_precision":
            if req.ground_truth is None:
                return None, None, ScoreError(
                    metric=metric_name,
                    error="missing_ground_truth",
                    detail="context_precision requires ground_truth",
                )
            metric = state.metrics["context_precision"]
            result = await metric.ascore(
                user_input=req.question,
                reference=req.ground_truth,
                retrieved_contexts=contexts_text,
            )
        elif metric_name == "context_recall":
            if req.ground_truth is None:
                return None, None, ScoreError(
                    metric=metric_name,
                    error="missing_ground_truth",
                    detail="context_recall requires ground_truth",
                )
            metric = state.metrics["context_recall"]
            result = await metric.ascore(
                user_input=req.question,
                retrieved_contexts=contexts_text,
                reference=req.ground_truth,
            )
        elif metric_name == "refusal_correctness":
            if req.ground_truth is None:
                return None, None, ScoreError(
                    metric=metric_name,
                    error="missing_ground_truth",
                    detail="refusal_correctness requires ground_truth (NO_ANSWER text)",
                )
            score, reason = await _refusal_correctness(
                llm=state.llm,
                question=req.question,
                answer=req.answer,
                contexts=contexts_text,
                ground_truth=req.ground_truth,
            )
            return score, reason, None
        else:
            return None, None, ScoreError(
                metric=metric_name,
                error="unknown_metric",
                detail=f"metric '{metric_name}' is not supported",
            )

        # Standard metric path — extract numeric + reason from MetricResult
        score_val: Optional[float] = None
        reason: Optional[str] = None
        # MetricResult typically has .value and may have .reason
        if hasattr(result, "value"):
            try:
                score_val = float(result.value)
            except (TypeError, ValueError):
                score_val = None
        if hasattr(result, "reason"):
            reason = result.reason
        return score_val, reason, None

    except asyncio.TimeoutError as e:
        return None, None, ScoreError(
            metric=metric_name, error="judge_timeout", detail=str(e)
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("metric %s failed", metric_name)
        return None, None, ScoreError(
            metric=metric_name,
            error="metric_failed",
            detail=f"{type(e).__name__}: {e}",
        )


@app.post("/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    """Score a single (question, answer, contexts, ground_truth) tuple.

    Pipeline:
      1. Route metrics per category (DESIGN §4.6)
      2. Validate contexts (some metrics require non-empty)
      3. Run requested metrics
      4. Aggregate scores + reasons + errors
    """
    started = time.monotonic()

    routing = metrics_for_category(req.answer_category, req.metrics)
    metrics_to_run: list[str] = routing["metrics"]
    skipped: list[str] = routing["skipped"]
    skip_reason: Optional[str] = routing["skip_reason"]

    # Validate: context_precision / context_recall need non-empty contexts.
    # faithfulness can technically run on empty contexts (low score), but
    # we mirror DESIGN §4.3 and 422 the call.
    if not req.contexts:
        needs_ctx = {m for m in metrics_to_run if m.startswith("context_")}
        if needs_ctx:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "empty_contexts",
                    "metrics_requiring_contexts": sorted(needs_ctx),
                },
            )

    _ensure_initialized()

    contexts_text = [c.text for c in req.contexts]

    scores: dict[str, Optional[float]] = {}
    reasons: dict[str, str] = {}
    errors: list[ScoreError] = []

    # Run metrics concurrently — each is a separate LLM call.
    # LM Studio queues; this is parallelism-by-language, not parallelism-by-LLM.
    results = await asyncio.gather(
        *[_call_one_metric(m, req, contexts_text) for m in metrics_to_run],
        return_exceptions=False,
    )

    for metric_name, (score_val, reason, err) in zip(metrics_to_run, results):
        scores[metric_name] = score_val
        if reason and req.options.include_reasons:
            reasons[metric_name] = reason
        if err is not None:
            errors.append(err)

    elapsed_ms = int((time.monotonic() - started) * 1000)

    return ScoreResponse(
        request_id=req.request_id,
        scores=scores,
        reasons=reasons,
        skipped=skipped,
        skip_reason=skip_reason,
        errors=errors,
        judge_call_count=len(metrics_to_run),
        judge_latency_ms=elapsed_ms,
        cache_hit=False,
    )
