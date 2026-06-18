# Vector Retrieval: ANN Search, HNSW, and Similarity Metrics

## Approximate nearest neighbor search

Finding the vectors closest to a query vector by brute force means comparing the
query against every stored vector — exact, but linear in the size of the index and
too slow at scale. **Approximate Nearest Neighbor (ANN)** search trades a small
amount of recall for large speedups: it returns results that are *probably* among
the nearest, very fast, without guaranteeing the true nearest neighbors. Only an
exact (brute-force) search guarantees the exact answer. The recall-versus-speed
trade-off is tunable, but the approximation is fundamental to how ANN earns its
speed — it is not a bug to be configured away.

## HNSW: a layered proximity graph

**HNSW (Hierarchical Navigable Small World)** is one of the most widely used ANN
index structures. It builds a multi-layer graph in which nodes are connected to
nearby nodes, with sparse long-range links in upper layers for fast navigation and
denser links lower down for accuracy. Search starts at the top and greedily descends
toward the query. HNSW delivers excellent recall at low latency, but the layered
graph **costs more memory** and is **more expensive to build** than simpler indexes
such as flat or IVF structures. Its behavior is governed by parameters that trade
build cost, memory, and search quality — for example the number of neighbors per
node and the size of the candidate lists explored during construction and search.
Choosing these values is an engineering trade-off, not a single correct setting.

## The similarity metric must match the model

A vector index compares vectors with a **similarity metric** — commonly cosine
similarity, dot product, or Euclidean (L2) distance. The metric is not
interchangeable: it must match what the embedding model was trained and normalized
for. Using cosine on vectors meant to be compared by dot product (or vice versa)
degrades retrieval quality. For vectors that are L2-normalized to unit length,
cosine similarity and dot product rank results identically, but that equivalence
holds only under normalization. The rule is simple: use the metric the model expects.

## Dimensionality is a trade-off, not "more is better"

Embeddings have a fixed dimensionality, and it is tempting to assume higher
dimensions are strictly better because they can encode more. They are not free.
Higher-dimensional vectors increase index size and memory footprint, slow down
search, and can run into the curse of dimensionality, where distances become less
discriminative. The right dimensionality balances retrieval quality against index
size and latency; bigger is a trade-off to be measured, not an automatic win.
