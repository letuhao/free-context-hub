---
id: corpus/developer/dsa/complexity-and-structures
domain: developer
subdomain: dsa
topic: complexity-and-structures
sources:
  - "Wikipedia — Big O notation / Hash table / Binary search tree (read 2026-06-16, CC-BY-SA, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Data structures and complexity

## Big-O — what it describes
Big-O describes the **asymptotic growth** of an algorithm's cost as input size *n* grows (an upper
bound on the dominant term). It **ignores constant factors and lower-order terms**, which is why a
**lower Big-O is not automatically faster in practice** at small/typical *n*: an O(n) algorithm with
tiny constants can beat an O(log n) one with large constants until *n* is big enough. Big-O guides
**scaling behavior**, not absolute speed on a given input.

## Amortized complexity
**Amortized** cost is the average per-operation cost over a sequence, even if individual operations
occasionally spike. Example: a dynamic array's append is **amortized O(1)** — most appends are O(1),
and the occasional O(n) resize is spread across many cheap ones.

## Hash tables
A hash table gives **average O(1)** insert/lookup/delete by hashing keys to buckets. But the
**worst case is O(n)** — with many collisions (poor hash, adversarial keys, all keys in one bucket)
operations degrade to linear. So **hash lookup is not always O(1)**; the O(1) is average-case,
contingent on a good hash and load factor.

## Trees
A **balanced** binary search tree (AVL, red-black) gives **O(log n)** search/insert/delete and keeps
keys **ordered** (supporting range queries and in-order traversal). An **unbalanced** BST can degrade
to **O(n)** (a degenerate "linked list" if keys are inserted in sorted order without rebalancing).

## Array vs linked list vs hash — trade-offs
- **Array (dynamic)** — O(1) index access, cache-friendly contiguous memory; insert/delete in the
  middle is O(n) (shifting); append amortized O(1).
- **Linked list** — O(1) insert/delete given the node, but **O(n) to find/index** and poor cache
  locality.
- **Hash table** — average O(1) keyed access, **no ordering**.
- **Balanced tree** — O(log n) keyed access **with ordering**.
Choose by the dominant operation: random access (array), ordered range queries (tree), pure
key-value membership (hash), frequent middle insertion given a position (linked list).
