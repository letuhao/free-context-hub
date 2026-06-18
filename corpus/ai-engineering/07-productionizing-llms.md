# Productionizing LLMs: Serving, Cost, and Guardrails

## Guardrails reduce hallucination, they do not eliminate it

Production systems wrap models in **guardrails**: input and output filtering,
grounding in retrieved context, and abstention when the answer is unknown. These
meaningfully reduce hallucination, but they do not eliminate it. A model can still
produce a confident, well-formed, ungrounded claim that passes the filters.
Guardrails are **risk reduction**, not a guarantee — a defense-in-depth posture, not
a solved problem.

## RAG reduces hallucination but does not remove it

Retrieval-augmented generation grounds answers in real sources and is one of the
strongest tools against hallucination, but it does **not** remove it entirely. The
model can still misread a passage, over-extrapolate beyond what the context
supports, or ignore the retrieved context in favor of its prior. Grounding lowers
the rate and makes errors auditable through citations; it is not a perfect shield.

## A dedicated cross-encoder beats an LLM used as a reranker

It is tempting to reuse a general chat LLM to rerank retrieved candidates by asking
it to score relevance. This is usually a poor choice: an LLM-as-reranker is
**generation-bound**, making it slow and expensive per candidate. A purpose-built
**cross-encoder** reranker is dramatically cheaper and faster at comparable or
better ranking quality — in practice on the order of a twentyfold speed and cost
improvement over a general LLM doing the same job. Use the dedicated model for the
dedicated task.

## Throughput techniques: batching and the KV-cache

Two techniques raise LLM serving throughput. **Continuous (dynamic) batching** keeps
the GPU busy by merging requests into batches as they arrive instead of waiting for
fixed batch boundaries, so the hardware does not idle. The **KV-cache** stores the
key/value tensors for tokens already processed so the model does not recompute the
prefix at each generation step; prefix caching extends this by reusing shared
prefixes across requests. Both increase how much work the server completes per unit
time.

## Cost scales with tokens, and batching trades latency for throughput

LLM serving cost is roughly **proportional to the number of tokens processed**,
input plus output. The levers for cost are therefore token levers: shorter prompts
and outputs, caching, smaller models where adequate, and retrieval to avoid stuffing
huge contexts. Throughput and latency are in tension: **bigger batches raise
throughput but can raise per-request latency**, because individual requests wait to
be batched and share the GPU. There is no setting that maximizes both at once; the
right batch size depends on whether you are optimizing for cost-efficiency or
response time.

## Observability for LLM systems

You cannot manage what you do not measure. Production LLM systems should track
**tokens, latency, cost, and quality signals such as groundedness and refusal
rates** over time. Continuous observability surfaces regressions and drift — a
prompt change that quietly raises hallucination, a cost creep, a latency
regression — before they reach users.
