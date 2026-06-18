# LLM Fundamentals: Tokens, Context, and Embeddings

## How language models read text: tokens

A large language model does not process text as whole words. Input is first broken
into **tokens** — subword units produced by a tokenizer. A common English word may
be a single token, while a rare or compound word splits into several. As a rough
rule of thumb, English text averages a little under one word per token (often quoted
around three-quarters of a word per token), but the exact ratio depends on the
tokenizer and the text. This matters in practice because everything the model
charges for and bounds is measured in tokens, not words: pricing, rate limits, and
the size of the context window are all token-denominated. Counting words will
therefore under- or over-estimate both cost and whether a prompt fits.

## The context window and why it is not a substitute for retrieval

The **context window** is the maximum number of tokens the model can attend to at
once — prompt plus generated output. A natural temptation is to conclude that a
sufficiently large window makes retrieval unnecessary: just paste everything in.
This is a mistake. Larger contexts cost more and add latency, because attention
work grows with sequence length. More importantly, models do not use long contexts
uniformly: information placed in the **middle** of a long context is recalled less
reliably than information near the beginning or the end. This positional weakness is
widely known as **"lost in the middle."** Stuffing a huge, undifferentiated context
therefore tends to *bury* the relevant passage. Targeted retrieval — fetching only
the few passages that matter and placing them well — usually beats dumping
everything into a giant window.

## Embeddings encode meaning, not facts

An **embedding** is a vector that places a piece of text at a point in a
high-dimensional space so that semantically similar texts land near each other. It
is easy to misread embeddings as a database of true statements. They are not.
Embeddings encode the *geometry of meaning* — relative similarity — not retrievable
facts. A retrieval system uses vector proximity to find the **source text** most
similar to a query; a model then reads that text. The knowledge lives in the
retrieved documents, and the embedding is only the index that locates them. Asking
an embedding "is this true?" is a category error.

## Determinism: temperature 0 is not byte-identical output

Sampling temperature controls randomness. At **temperature 0** the model picks the
highest-probability token at each step (greedy decoding), which feels deterministic.
But temperature 0 does **not** guarantee identical output across model versions,
hardware, batch sizes, or serving backends. Floating-point arithmetic is not
associative, GPU kernels and batching change the order of operations, and tiny
numerical differences can tip which token wins a near-tie. Treat greedy decoding as
*low variance*, not *reproducible to the byte*.

## Why models hallucinate

At its core an LLM is a **next-token predictor**: it generates the statistically
likely continuation of the text so far. It has no built-in model of truth. Fluency
and confidence are properties of the language distribution it learned, not evidence
of correctness — which is exactly why a model can produce well-formed, confident,
and false output. Truthfulness is an **external** addition: grounding the model in
retrieved sources, verifying claims, and constraining outputs. Nothing inside the
next-token objective makes the model prefer true continuations over plausible ones.
