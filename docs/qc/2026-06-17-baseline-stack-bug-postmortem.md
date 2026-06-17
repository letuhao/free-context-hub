# Postmortem — baseline-stack invariant silently broken (2026-06-17)

**Severity:** **HIGH** — every Phase 17 gen-eval baseline from v4 onward
was at risk of model-swap contamination; the magnitude per row is unknown.
**Detected by:** user noticed model-swap activity during this session's
Bug 3 v1/v2 smoke runs.
**Root cause:** TWO interlocking bugs in `docker-compose.yml` + the
docker-compose `--env-file` semantic. **Code-side**, not ops.
**Fix landed in:** branch `deferred-030-rerank-quality`, this commit.

## What the user warned about, and what actually broke it

`CLAUDE.md` § "Baseline-stack invariant" already documented the rule:

> The invariant: LM Studio has exactly two models loaded simultaneously…
> All chat callers (answerer, judge sidecar, MCP reranker, distillation
> worker) point at the SAME chat model so no swap is ever triggered.
> `DISTILLATION_MODEL` is unset/empty during baseline (worker no-ops;
> prevents background swap).

The mechanism for "empty during baseline" was supposed to be
`scripts/start-baseline-stack.sh` running:

```bash
docker compose --env-file .env --env-file .env.baseline up -d --force-recreate mcp worker ragas-judge
```

with `.env.baseline` containing `DISTILLATION_MODEL=` (empty).

**That mechanism was silently a no-op.** It looked correct because the
PREFLIGHT script verified the LM Studio + sidecar state, but never
audited the actual container env.

## The two bugs

### Bug 1 — `--env-file` doesn't populate container env

`docker-compose.yml`'s `mcp` and `worker` services declared
`env_file: - .env` (only). The CLI flag `--env-file .env.baseline` on
`docker compose up` affects **variable substitution in the compose
file**, NOT the container's env. So:

- `.env`'s `DISTILLATION_MODEL=google/gemma-4-26b-a4b-qat` got loaded
  into both containers via `env_file`.
- `.env.baseline`'s `DISTILLATION_MODEL=` was AVAILABLE for
  substitution but the compose file never referenced
  `${DISTILLATION_MODEL}` for these services → it was ignored.

Net: the worker ran with `DISTILLATION_MODEL=gemma` during every
baseline. The worker's idle-time jobs (`faq.build`, `knowledge.loop.*`,
`raptor.build`) called LM Studio with gemma while the baseline runner
called with mistral-nemo → LM Studio swapped mid-run (the exact pattern
[lmstudio-bug-tracker#945](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/945)
documents).

### Bug 2 — `${X:-default}` masks explicit-empty override

For variables that DID have `environment:` lines in compose
(`DISTILLATION_ENABLED`, `RERANK_MODEL`, sidecar `JUDGE_AGENT_MODEL`),
the substitution used `${X:-default}` (colon-hyphen). Per POSIX shell
semantics that's "default when X is unset OR EMPTY." So even where
substitution worked, `.env.baseline`'s empty assignment got replaced
by the colon-hyphen default — meaning empty values could never
propagate.

This compounded Bug 1: a user adding `DISTILLATION_MODEL=` to
`.env.baseline` AND adding `DISTILLATION_MODEL: ${DISTILLATION_MODEL:-...}`
to compose would STILL see the gemma default in the container.

### Bug 3 (residual, also fixed) — zod schema rejects empty string

`env.ts`'s `DISTILLATION_MODEL: z.string().min(1).optional()` accepted
`undefined` (absent) or a non-empty string, but rejected the empty
string that single-hyphen substitution actually produces. Without
preprocessing, fixing Bugs 1+2 would trigger a `Too small: expected
string to have >=1 characters` validation error on container startup.

## Why baselines could pass without this being obvious

- Single per-row faithfulness numbers are noisy (±0.1+); a slow
  background swap that affected 1-2 rows out of 152 would round into
  the noise floor.
- The PREFLIGHT script verified the answerer + sidecar were pinned
  correctly, but never asked the running containers what
  `DISTILLATION_MODEL` they actually saw. The check was at the wrong
  layer.
- LM Studio's auto-unload makes "current loaded model" a function of
  request order, not configuration — so even a user inspecting LM
  Studio at the start of a run wouldn't see the swap that happened
  10 minutes in.

## What got broken in measurements

This is the bad news. Every Tradition-A baseline from this branch's
ancestor (Phase 17 v4 → v9 → 2026-06-17 smoke iterations) ran with:

- Answerer = mistral-nemo (correct, controlled)
- Judge sidecar = mistral-nemo (correct, controlled)
- **Worker = `DISTILLATION_MODEL=gemma`, `DISTILLATION_ENABLED=true`** ← contaminated

Whether any specific row was contaminated depends on whether the worker
was processing a job (and whether that job actually invoked LLM) at the
moment that row's answerer / judge calls hit LM Studio. The contamination
is therefore non-deterministic per-row, but systematic across baselines.

**Affected baselines (need a clean re-run for any quality claim):**
- `2026-05-24-phase-17-baseline-v4-telemetry-off.json`
- `2026-05-24-phase-17-baseline-v5-topk-5.json`
- `2026-05-24-phase-17-baseline-v6-judge-fix-a-b.json`
- `2026-06-16-phase-17-baseline-v7-bug3-fix-code.json`
- `2026-06-16-phase-17-baseline-v8-bug3-alt-framing-code.json`
- `2026-06-16-phase-17-baseline-v9-bug3-v8-full.json`
- `2026-06-16-2026-06-17-phase-17-bug3-global-fix-smoke.json` (this session)
- `2026-06-16-2026-06-17-phase-17-bug3-global-fix-v2-smoke.json` (this session)

The Bug 3 v8 → v9 conclusions (hedge −55%, AR +0.11, faith neutral on
3 of 4 surfaces) likely SURVIVE contamination because the swap is rare
and the direction was strong. But any single-row analysis or small
delta (e.g. the −0.119 global faith we tried to fix in this session) is
suspect.

**Not affected (different controlled-state setup):**
- `2026-06-16-geneval-*.json` — used gemma for both answerer + judge,
  worker would NOT have caused a swap (same model).

## The fix (this commit)

1. **`docker-compose.yml`** — add explicit `environment:` lines for
   `DISTILLATION_MODEL`, `DISTILLATION_ENABLED`, `BUILDER_AGENT_MODEL`,
   `QA_AGENT_MODEL`, `RERANK_MODEL`, `RERANK_TYPE` on both `mcp` and
   `worker`. Same fix on the `ragas-judge` sidecar block.
2. **`docker-compose.yml`** — change all baseline-sensitive vars from
   `${X:-default}` to `${X-default}` (single-hyphen) so empty values
   propagate.
3. **`.env.baseline`** — add `DISTILLATION_ENABLED=false` belt-and-
   suspenders (so callers like `generateSearchAliases` short-circuit
   even if some other path were to set `DISTILLATION_MODEL`).
4. **`src/env.ts`** — add empty-string preprocess to `DISTILLATION_MODEL`,
   `BUILDER_AGENT_MODEL`, `QA_AGENT_MODEL`, and their `_BASE_URL`
   siblings. Pattern matches the existing fix on `RERANK_BASE_URL` /
   `RERANK_MODEL`.
5. **`scripts/preflight-baseline.mjs`** — audit the running container's
   actual env via `docker exec printenv`. ANY non-empty / non-expected
   value on `DISTILLATION_MODEL`, `QA_AGENT_MODEL`,
   `BUILDER_AGENT_MODEL` now FAILS the preflight. The check is at the
   layer the bug actually existed at.

## End-to-end verification (this commit)

```
✓ Container DISTILLATION_MODEL='' (empty propagates)
✓ Container DISTILLATION_ENABLED='false' (gate works)
✓ Container QA_AGENT_MODEL='mistralai/mistral-nemo-instruct-2407' (no swap risk)
✓ Container BUILDER_AGENT_MODEL='mistralai/mistral-nemo-instruct-2407' (no swap risk)
✓ 868/868 unit tests pass
```

(The "LM Studio chat model not loaded" warning in preflight after the
fix is unrelated — LM Studio auto-unloaded mistral-nemo while we were
waiting for the rebuild. First chat call auto-reloads.)

## What was the actual semantic of `.env.baseline` for v4–v9?

In retrospect: `.env.baseline` worked correctly for things that compose
substituted (`ANSWERER_AGENT_MODEL` via local shell-env on the runBaseline
command line; `JUDGE_AGENT_MODEL` via the sidecar's `environment:` block
with colon-hyphen substitution that didn't trip the bug because the
value was non-empty). It DID NOT work for the things only consumed by
the worker process inside the container, which are exactly the things
that needed it most.

## What still needs to happen

- A **clean re-baseline** with the fixed stack (v10 tag) before citing
  any Phase 17 number publicly. The Bug 3 v8 fix's direction is sound;
  the magnitudes need re-measurement.
- DEFERRED-031 (global-surface synth investigation) is now
  **invalidated** as documented — the v1/v2 smoke iterations were run
  against contaminated worker state. The conclusion ("not fixable at
  template layer") stands as a hypothesis but is not measured.
- Consider folding the container-env audit into CI: a step that runs
  `start-baseline-stack.sh` then asserts the preflight passes catches
  future regressions of this class.

## Lesson

When a documented invariant says "X is empty in the controlled stack,"
the verification must read X **out of the place that consumes X** — not
out of the config file that's supposed to set X. The PREFLIGHT was
testing the file, not the runtime. That is the same class of error as
verifying a test mock instead of the real behavior.
