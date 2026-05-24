"""Bug 2 audit probe — run ragas faithfulness on N rows and capture per-claim verdicts.

For each input row:
  1. Call ragas's StatementGeneratorPrompt -> list of atomic claims
  2. Call ragas's NLIStatementPrompt with the same contexts -> per-claim {statement, reason, verdict}
  3. Print everything alongside the reference score from the baseline.

Read: services/ragas-judge/_bug2_probe_input.json (mounted from docs/qc/baselines/_bug2_probe_input.json)
Write: services/ragas-judge/_bug2_probe_output.json
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Load the same compat shims main.py uses
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
OUTPUT = Path("/app/_bug2_probe_output.json")


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
        model=model,
        base_url=base,
        api_key=api_key,  # type: ignore[arg-type]
        temperature=0.0,
        max_retries=0,
        timeout=120.0,
    )
    llm = LangchainLLMWrapper(chat)

    stmt_prompt = StatementGeneratorPrompt()
    nli_prompt = NLIStatementPrompt()

    rows = json.loads(INPUT.read_text(encoding="utf-8"))
    results = []
    for i, row in enumerate(rows):
        print(f"\n========== ROW {i+1}/{len(rows)}: {row['id']} ==========")
        print(f"Q: {row['user_input']}")
        print(f"REF f={row['reference_score']:.2f}, self_eval={row['self_eval_score']:.2f}")
        print(f"ANSWER:\n  {row['response']}")
        print()

        # Step 1: claim split
        try:
            stmts_out = await stmt_prompt.generate(
                data=StatementGeneratorInput(
                    question=row["user_input"], answer=row["response"]
                ),
                llm=llm,
            )
            stmts = stmts_out.statements
        except Exception as e:
            print(f"[ERROR] statement generation failed: {e!r}")
            results.append({"id": row["id"], "error": f"statement_gen: {e!r}"})
            continue

        print(f"[step 1] split into {len(stmts)} claim(s):")
        for k, s in enumerate(stmts, 1):
            print(f"  {k}. {s}")

        # Step 2: NLI verdicts
        try:
            verdicts_out = await nli_prompt.generate(
                data=NLIStatementInput(
                    context="\n".join(row["retrieved_contexts"]),
                    statements=stmts,
                ),
                llm=llm,
            )
            verdicts = verdicts_out.statements
        except Exception as e:
            print(f"[ERROR] NLI verdicts failed: {e!r}")
            results.append(
                {
                    "id": row["id"],
                    "statements": stmts,
                    "error": f"nli: {e!r}",
                }
            )
            continue

        print(f"[step 2] {len(verdicts)} verdict(s):")
        ent = 0
        for v in verdicts:
            mark = "OK " if v.verdict == 1 else "REJ"
            if v.verdict == 1:
                ent += 1
            print(f"  [{mark}] {v.statement}")
            print(f"        reason: {v.reason}")
        if verdicts:
            score = ent / len(verdicts)
        else:
            score = float("nan")
        print(f"[score] {ent}/{len(verdicts)} = {score:.2f}   (baseline ref: {row['reference_score']:.2f})")

        results.append(
            {
                "id": row["id"],
                "user_input": row["user_input"],
                "response": row["response"],
                "reference_score": row["reference_score"],
                "self_eval_score": row["self_eval_score"],
                "statements": stmts,
                "verdicts": [
                    {
                        "statement": v.statement,
                        "reason": v.reason,
                        "verdict": v.verdict,
                    }
                    for v in verdicts
                ],
                "computed_score": score,
            }
        )

    OUTPUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[done] wrote {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(run())
