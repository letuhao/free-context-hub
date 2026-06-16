/**
 * Phase 17 Bug 2 fix — build the contexts array sent to the ragas-judge sidecar.
 *
 * The judge MUST see the same snippet the synthesizer saw, otherwise it can
 * reject claims the synth was entitled to make. Before this fix the judge got
 * the 200-char `snippet_preview` while the synth got up to 1000 chars from
 * `h.snippet` — that asymmetry caused systematic "context does not contain X"
 * rejections from ragas.
 *
 * Match the synthesizer's formatContext cap (genPipeline.ts DEFAULT_MAX_CHARS).
 * The judge sidecar (services/ragas-judge/main.py) then prepends "File: <id>\n"
 * before passing to ragas — see Bug 2a closeout for the path-stripping
 * mechanism that motivated the sidecar-side fix.
 *
 * Extracted from runBaseline.ts so unit tests can import it without firing
 * the runner's top-level `main()` call.
 */

/** Symmetry invariant — judge and synth must see the same window so the
 *  judge can entail what the synth was allowed to cite. If you change the
 *  synthesizer's DEFAULT_MAX_CHARS in genPipeline.ts, change this too AND
 *  re-baseline (the judge will see different evidence and scores will shift). */
export const JUDGE_SNIPPET_MAX_CHARS = 1000;

export function buildJudgeContexts(
  retrievalHits: ReadonlyArray<{ key: string; snippet?: string }>,
  topKContexts: number,
): Array<{ id: string; text: string }> {
  return retrievalHits.slice(0, topKContexts).map((h) => ({
    id: h.key,
    text: (h.snippet ?? '').slice(0, JUDGE_SNIPPET_MAX_CHARS),
  }));
}
