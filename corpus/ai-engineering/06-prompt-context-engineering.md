# Prompt and Context Engineering: Patterns and Limits

## Chain-of-Thought improves reasoning, not facts

**Chain-of-Thought (CoT)** prompting asks the model to work through intermediate
steps before answering, which improves performance on multi-step reasoning tasks.
But CoT improves the *reasoning process*, not factual grounding. A model can reason
fluently and confidently straight to a wrong answer if its premises are wrong or
invented. CoT does not reliably fix hallucination; factual reliability comes from
grounding (retrieval), verification, and constraints — not from asking the model to
think out loud.

## Few-shot examples: quality over quantity

Adding worked examples to a prompt (few-shot prompting) often helps, but **more is
not always better**. Past a point, extra examples add tokens and cost, can bias the
model toward surface patterns in the examples, and may even degrade results. A few
representative, high-quality examples typically beat a long list of mediocre ones.
Choose examples for coverage and correctness, not volume.

## "Return JSON" does not guarantee valid JSON

Writing "return JSON" or "respond only with JSON" in a prompt makes valid output
*more likely* but does not **guarantee** it. Without constrained decoding — schema
enforcement, a grammar, or function-calling that restricts the token space — the
model can still emit malformed JSON or output that violates the intended schema. If
valid structured output is a hard requirement, enforce it at the decoding layer
rather than trusting prompt wording.

## Prompting shapes behavior, it does not create truth

Careful prompt wording shapes a model's behavior, tone, and format, but it does not
turn the model into a trustworthy source of true facts. Hallucination is mitigated
by **grounding** the model in real sources, by verification steps, and by
constraints — not by clever instructions alone. A prompt that says "only state true
facts" does not give the model a way to know which facts are true.

## Reasoning mode can waste the token budget

Some models support an explicit reasoning or "thinking" mode that spends tokens on
internal deliberation before answering. Leaving it on when it is not needed can
**burn the token budget and degrade output**. A concrete failure mode observed in
practice: a model exhausted its output budget on reasoning tokens and returned empty
or truncated answers until thinking was disabled. Reasoning is a tool to apply
deliberately, not a default to leave running.

## Position effects: where you put things matters

Because of the "lost in the middle" effect, **where** key instructions and data sit
in the context affects how reliably the model uses them. Critical instructions and
the most important retrieved passages are generally used more reliably when placed
near the **start or end** of the context rather than buried in the middle. Context
layout is part of prompt engineering.

## Toggling reasoning mode is backend-specific

How you control reasoning/thinking mode is **not** uniform across models and
backends. For some it is a UI toggle, for others an API parameter, and the exact
parameter name and accepted values differ; some models ignore the request entirely.
There is no single portable switch — reasoning control must be handled per model and
per serving backend.
