# Retrieval-Augmented Generation: Retrieval, Reranking, and Evaluation

## What retrieval and reranking each do

A RAG pipeline first **retrieves** a candidate pool of documents for a query, then
optionally **reranks** that pool before passing the top results to the generator.
The division of labor is important and frequently confused. Retrieval decides
*which* documents enter the pool; reranking only **reorders** the documents already
fetched. A reranker cannot raise **recall** beyond what retrieval supplied: if the
one relevant document was never retrieved, no amount of reordering can surface it.
What reranking improves is **precision and ordering** — putting the most relevant
candidates at the top — which lifts metrics like MRR, nDCG, and context precision.
So adding a reranker does not change the recall@k of the underlying retrieval; it
changes the rank of what was already there.

## Bi-encoders versus cross-encoders

These are two distinct architectures, not variants of one. A **bi-encoder** embeds
the query and each document *independently* into vectors, then compares them with a
cheap similarity computation — this is what makes large-scale approximate nearest
neighbor search fast. A **cross-encoder** takes a (query, document) pair *together*
as one input and scores their relevance jointly, letting every query token attend to
every document token. Joint scoring is more accurate but far slower, because it
cannot be precomputed and must run per pair. The usual design uses a bi-encoder for
fast first-stage retrieval and a cross-encoder to rerank a small top-k. A
cross-encoder is therefore not "a kind of bi-encoder" — the defining difference is
joint scoring versus independent embedding.

## Recall@k measures retrieval, not answers

**recall@k** is a retrieval metric: of the documents that should have been found,
how many appear in the top k. It says nothing about the quality of the final
generated answer. A pipeline can achieve perfect recall and still produce a poor
answer if the generator misreads, omits, or contradicts the retrieved context.
Answer quality must be evaluated separately — for example with faithfulness and
answer-relevancy judgments. Conflating a strong retrieval number with a good system
is a common and costly error.

## More context is not automatically better

Because retrieval is cheap, there is a temptation to pass as many chunks as fit into
the context window. Beyond a modest point this hurts. Extra chunks add noise that
can distract the generator, increase token cost and latency, and push relevant
passages into the "lost in the middle" zone where they are used less reliably.
Quality and ordering of the few chunks that matter beats sheer quantity.

## Hybrid retrieval and rank fusion

Lexical search (such as BM25) matches on exact keywords; vector search matches on
semantic similarity. Each misses cases the other catches — lexical fails on
paraphrase, vector fails on rare exact terms like identifiers or error codes.
**Hybrid retrieval** runs both and combines their results. A common way to merge the
two ranked lists is **Reciprocal Rank Fusion (RRF)**, which scores each document by
the sum of reciprocals of its ranks across the lists, rewarding documents that rank
well in either method without needing comparable raw scores.
