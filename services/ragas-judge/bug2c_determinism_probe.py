"""Bug 2c determinism probe (2026-06-17).

For ONE input row, run ragas's StatementGeneratorPrompt + NLIStatementPrompt
five times with `temperature=0.0` and `seed=42` PINNED — the production
config per `.env.baseline`. Compare statements + verdicts across runs.

If runs differ → ragas's two-step claim-split + NLI handshake is the source
of Bug 2c non-determinism, not LM Studio itself.
(Layer 1 — direct LM Studio chat at temp=0+seed=42 — was verified deterministic
in /tmp/lmstudio_seed_probe.sh.)

Run:
  docker cp services/ragas-judge/bug2c_determinism_probe.py free-context-hub-ragas-judge-1:/app/bug2c_determinism_probe.py
  docker cp docs/qc/baselines/_bug2_probe_input.json       free-context-hub-ragas-judge-1:/app/_bug2_probe_input.json
  docker exec free-context-hub-ragas-judge-1 python //app/bug2c_determinism_probe.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _compat  # noqa: F401

from langchain_openai import ChatOpenAI

from ragas.llms.base import LangchainLLMWrapper
from ragas.metrics._faithfulness import (
    NLIStatementInput,
    NLIStatementPrompt,
    StatementGeneratorInput,
    StatementGeneratorPrompt,
)

INPUT = Path("/app/_bug2_probe_input.json")
OUTPUT = Path("/app/_bug2c_determinism_output.json")
N_RUNS = 3
ROW_INDEX = None  # iterate ALL rows when None


def _normalize_url(base: str) -> str:
    b = base.rstrip("/")
    if not b.endswith("/v1"):
        b = b + "/v1"
    return b


def _hash(obj) -> str:
    """Stable content hash for an arbitrary JSON-able value."""
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]


async def run() -> None:
    base = os.environ["OPENAI_BASE_URL"]
    api_key = os.environ.get("OPENAI_API_KEY", "lm-studio")
    model = os.environ["JUDGE_AGENT_MODEL"]
    seed = int(os.environ.get("JUDGE_SEED", "42"))
    base = _normalize_url(base)

    all_rows = json.loads(INPUT.read_text(encoding="utf-8"))
    rows_to_run = all_rows if ROW_INDEX is None else [all_rows[ROW_INDEX]]

    print(f"[probe] model={model} @ {base}")
    print(f"[probe] temp=0.0 seed={seed}  rows={len(rows_to_run)}  N_per_row={N_RUNS}")
    print()

    # Pin seed via model_kwargs — langchain-openai passes through to OpenAI
    # SDK which propagates `seed` to LM Studio's /v1/chat/completions.
    chat = ChatOpenAI(
        model=model,
        base_url=base,
        api_key=api_key,  # type: ignore[arg-type]
        temperature=0.0,
        max_retries=0,
        timeout=120.0,
        model_kwargs={"seed": seed},
    )
    llm = LangchainLLMWrapper(chat)

    stmt_prompt = StatementGeneratorPrompt()
    nli_prompt = NLIStatementPrompt()

    all_per_row = []
    for row in rows_to_run:
        print(f"########## ROW {row['id']} ##########")
        stage_results = []
        for run_i in range(1, N_RUNS + 1):
            try:
                stmts_out = await stmt_prompt.generate(
                    data=StatementGeneratorInput(
                        question=row["user_input"], answer=row["response"]
                    ),
                    llm=llm,
                )
                statements = list(stmts_out.statements)
            except Exception as e:
                print(f"  RUN {run_i} [ERROR] stage1: {e!r}")
                stage_results.append({"run": run_i, "error": f"stage1: {e!r}"})
                continue
            stmt_hash = _hash(statements)

            try:
                verdicts_out = await nli_prompt.generate(
                    data=NLIStatementInput(
                        context="\n".join(row["retrieved_contexts"]),
                        statements=statements,
                    ),
                    llm=llm,
                )
                verdicts = [
                    {"statement": v.statement, "reason": v.reason, "verdict": v.verdict}
                    for v in verdicts_out.statements
                ]
            except Exception as e:
                print(f"  RUN {run_i} [ERROR] stage2: {e!r}")
                stage_results.append({"run": run_i, "statements": statements, "stmt_hash": stmt_hash, "error": f"stage2: {e!r}"})
                continue
            decision_only = [{"statement": v["statement"], "verdict": v["verdict"]} for v in verdicts]
            verdict_hash = _hash(decision_only)
            ent = sum(1 for v in verdicts if v["verdict"] == 1)
            score = ent / max(1, len(verdicts))
            print(f"  RUN {run_i}: stmt_hash={stmt_hash}  decision_hash={verdict_hash}  score={score:.3f}")
            stage_results.append({
                "run": run_i,
                "stmt_hash": stmt_hash,
                "decision_hash": verdict_hash,
                "ent": ent,
                "total": len(verdicts),
                "score": score,
                "statements": statements,
                "verdicts": verdicts,
            })
        stmt_hashes = {r.get("stmt_hash") for r in stage_results if "stmt_hash" in r}
        dec_hashes = {r.get("decision_hash") for r in stage_results if "decision_hash" in r}
        scores = [r.get("score") for r in stage_results if "score" in r]
        print(f"  >>> {row['id']}: distinct stmt_hashes={len(stmt_hashes)}/{N_RUNS}  distinct decision_hashes={len(dec_hashes)}/{N_RUNS}  spread={(max(scores) - min(scores)) if scores else 0:.3f}")
        print()
        all_per_row.append({
            "row_id": row["id"],
            "n_runs": N_RUNS,
            "distinct_stmt_hashes": len(stmt_hashes),
            "distinct_decision_hashes": len(dec_hashes),
            "score_min": min(scores) if scores else None,
            "score_max": max(scores) if scores else None,
            "score_spread": (max(scores) - min(scores)) if scores else None,
            "runs": stage_results,
        })

    nondeterministic_rows = [
        r for r in all_per_row
        if (r["distinct_stmt_hashes"] > 1 or r["distinct_decision_hashes"] > 1)
    ]
    print("=" * 60)
    print(f"DETERMINISM SUMMARY (seed={seed}) — {len(rows_to_run)} rows × {N_RUNS} runs")
    print("=" * 60)
    print(f"deterministic rows: {len(rows_to_run) - len(nondeterministic_rows)} / {len(rows_to_run)}")
    if nondeterministic_rows:
        print(f"⚠ NON-DETERMINISTIC rows ({len(nondeterministic_rows)}):")
        for r in nondeterministic_rows:
            print(f"  {r['row_id']}: stmt_hashes={r['distinct_stmt_hashes']}, decision_hashes={r['distinct_decision_hashes']}, score_spread={r['score_spread']:.3f}")

    summary = {
        "model": model,
        "seed": seed,
        "temperature": 0.0,
        "rows_probed": len(rows_to_run),
        "n_runs_per_row": N_RUNS,
        "nondeterministic_row_count": len(nondeterministic_rows),
        "per_row": all_per_row,
    }
    OUTPUT.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[done] wrote {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(run())
