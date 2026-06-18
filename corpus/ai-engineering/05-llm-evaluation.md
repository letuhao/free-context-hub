# LLM Evaluation: Faithfulness, Judges, and Measurement Pitfalls

## Faithfulness is grounding, not factual correctness

In RAG evaluation, **faithfulness** measures whether an answer is supported by the
retrieved context — whether every claim in the answer can be traced to the provided
passages. It does **not** measure whether the answer is true in the real world.
These come apart in both directions. An answer can be perfectly faithful to *wrong*
context: the retrieved passage is mistaken, the model repeats it accurately, and the
answer is faithful yet factually false. Conversely, an answer can state a real-world
truth the context never mentioned, which is factually correct but **unfaithful**.
Faithfulness and factual correctness are distinct metrics, and conflating them
produces misleading evaluations.

## LLM-as-judge is noisy and biased

Using a model to score other models' outputs (LLM-as-judge) is convenient but far
from neutral. Judges are **non-deterministic** — scores vary run to run — and carry
**systematic biases**: position bias (favoring the first option presented),
verbosity bias (rewarding longer answers), and self-enhancement or self-preference
bias (rating outputs that resemble their own more highly). Judge scores are noisy
estimates, not ground truth, and should be reported with their variance.

## Self-preference and label leakage

Two related circularity traps undermine evaluations. **Self-preference bias** occurs
when the same model both *generates* an answer and *judges* it: scores inflate
because the judge favors its own style and conclusions. Use a different judge model,
or anchor against human labels, to avoid this. **Label leakage / circularity** is
worse: treating the system's own outputs as the gold standard. That measures
consistency with itself, not correctness — the evaluation becomes a tautology. A
sound gold standard must be **independent and held out** from the system under test.

## The noise floor: small differences may be nothing

On a small, high-variance evaluation set, a tiny metric difference between two
configurations may be entirely within the **noise floor** — the run-to-run variation
you would see comparing a configuration to *itself*. A gap below the noise floor is
not a real improvement, no matter how appealing. Before claiming a win, estimate the
noise floor (for example by re-running the same configuration), report variance, and
use enough samples for the difference to clear it.

## Context precision rewards good ordering

**Context precision** rewards relevant chunks being ranked **higher** in the
retrieved context. Because it is sensitive to ordering, improving the rank of
relevant chunks — for instance by reranking — raises context precision. This makes
it a useful signal for the ranking stage specifically, distinct from recall, which
only asks whether the relevant chunks were retrieved at all.
