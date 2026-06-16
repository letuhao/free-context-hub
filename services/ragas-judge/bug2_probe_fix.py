"""Bug 2 audit probe — A/B compare path-prefixed vs text-only contexts.

For each input row, runs ragas's two-step pipeline TWICE:
  Variant A: contexts = raw text only (current production behavior on v5)
  Variant B: contexts = "File: <id>\\n<text>"   (Fix A from main.py)

Prints per-claim verdicts for both. The expected lift: claims that name a file
path or location go from REJECTED → ENTAILED in Variant B.
"""

from __future__ import annotations

import asyncio
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

INPUT = Path("/app/_bug2_probe_input_fix.json")
OUTPUT = Path("/app/_bug2_probe_output_fix.json")


def _normalize_url(base: str) -> str:
    b = base.rstrip("/")
    if not b.endswith("/v1"):
        b = b + "/v1"
    return b


async def run() -> None:
    base = os.environ["OPENAI_BASE_URL"]
    api_key = os.environ.get("OPENAI_API_KEY", "lm-studio")
    model = os.environ["JUDGE_AGENT_MODEL"]
    base = _normalize_url(base)
    print(f"[probe] judge: {model} @ {base}")

    chat = ChatOpenAI(
        model=model, base_url=base, api_key=api_key,  # type: ignore[arg-type]
        temperature=0.0, max_retries=0, timeout=120.0,
    )
    llm = LangchainLLMWrapper(chat)

    stmt_prompt = StatementGeneratorPrompt()
    nli_prompt = NLIStatementPrompt()

    rows = json.loads(INPUT.read_text(encoding="utf-8"))
    results = []

    for i, row in enumerate(rows):
        print(f"\n========== ROW {i+1}/{len(rows)}: {row['id']} ==========")
        print(f"Q: {row['user_input']}")
        print(f"REF baseline f={row['reference_score']:.2f}, self_eval={row['self_eval_score']:.2f}")

        # Split into claims — same for both variants
        try:
            stmts_out = await stmt_prompt.generate(
                data=StatementGeneratorInput(
                    question=row["user_input"], answer=row["response"]
                ),
                llm=llm,
            )
            stmts = stmts_out.statements
        except Exception as e:
            print(f"[ERROR] claim split failed: {e!r}")
            continue

        async def score_variant(label: str, ctxs: list[str]):
            try:
                verdicts_out = await nli_prompt.generate(
                    data=NLIStatementInput(
                        context="\n".join(ctxs), statements=stmts
                    ),
                    llm=llm,
                )
                verdicts = verdicts_out.statements
            except Exception as e:
                print(f"[ERROR variant {label}] NLI failed: {e!r}")
                return None

            ent = sum(1 for v in verdicts if v.verdict == 1)
            score = ent / len(verdicts) if verdicts else float("nan")
            print(f"\n  [{label}] score = {ent}/{len(verdicts)} = {score:.2f}")
            for v in verdicts:
                mark = "OK " if v.verdict == 1 else "REJ"
                print(f"    [{mark}] {v.statement[:120]}")
                print(f"          reason: {v.reason[:200]}")
            return {
                "label": label,
                "score": score,
                "verdicts": [
                    {"statement": v.statement, "reason": v.reason, "verdict": v.verdict}
                    for v in verdicts
                ],
            }

        # Variant A: raw text only (current production)
        rA = await score_variant("A: text-only", row["retrieved_contexts_text_only"])
        # Variant B: path-prefixed (Fix A)
        rB = await score_variant("B: File-prefix", row["retrieved_contexts_with_path"])

        if rA and rB:
            lift = rB["score"] - rA["score"]
            print(f"\n  LIFT: {rA['score']:.2f} -> {rB['score']:.2f}   (Δ {lift:+.2f})")

        results.append(
            {
                "id": row["id"],
                "statements": stmts,
                "variantA_text_only": rA,
                "variantB_file_prefix": rB,
                "baseline_reference_score": row["reference_score"],
                "self_eval_score": row["self_eval_score"],
            }
        )

    OUTPUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[done] wrote {OUTPUT}")

    # Summary
    print("\n========== SUMMARY ==========")
    print(f"{'id':<35} {'baseline':>9} {'A: text':>9} {'B: +path':>9} {'Δ B-A':>9}")
    for r in results:
        a = r["variantA_text_only"]["score"] if r["variantA_text_only"] else float("nan")
        b = r["variantB_file_prefix"]["score"] if r["variantB_file_prefix"] else float("nan")
        print(f"{r['id']:<35} {r['baseline_reference_score']:>9.2f} {a:>9.2f} {b:>9.2f} {b - a:>+9.2f}")


if __name__ == "__main__":
    asyncio.run(run())
