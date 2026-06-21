---
id: corpus/developer/api-design/rest-idempotency-versioning
domain: developer
subdomain: api-design
topic: rest-idempotency-versioning
sources:
  - "MDN Web Docs — HTTP methods / status codes (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "IETF RFC 9110 — HTTP Semantics (read 2026-06-16, OPEN, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# REST/HTTP — methods, idempotency, status codes, versioning

## Safe vs idempotent (two different properties)
- **Safe** — the method is read-only; it does not change server state. Per RFC 9110 the safe methods
  are **GET, HEAD, OPTIONS, TRACE** (GET/HEAD are the everyday ones).
- **Idempotent** — making the request N times has the **same effect as making it once**. The
  idempotent methods are **GET, HEAD, OPTIONS, TRACE, PUT, DELETE**. **POST is NOT idempotent** (two
  POSTs typically create two resources). All safe methods are idempotent, but not all idempotent
  methods are safe (PUT/DELETE change state yet are idempotent).

## PUT vs PATCH vs POST
- **PUT** — replace the target resource with the full representation; idempotent.
- **PATCH** — apply a *partial* modification; **not guaranteed idempotent** (and semantically
  different from PUT — PUT and PATCH are **not the same**). (PATCH is defined by RFC 5789, not RFC 9110.)
- **POST** — create/process; not idempotent.

## Idempotency keys
Because POST isn't idempotent, APIs that need safe retries (payments, order creation) use an
**idempotency key**: the client sends a unique key with the request; the server records it and
returns the same result for retries, so a network retry doesn't double-charge/double-create.

## Status codes (semantics matter)
- **2xx success** — `200 OK`, `201 Created` (a newly created resource should return **201**, not a
  bare 200), `204 No Content`.
- **4xx client error** — `400` bad request, `401` unauthenticated, `403` forbidden (authenticated
  but not allowed), `404` not found, `409` conflict, `422` unprocessable.
- **5xx server error** — `500`, `503`.
Using the right code is part of the contract; e.g. returning `200` for a creation loses the
"created" semantics and the `Location` of the new resource.

## Pagination
- **Offset/limit** — simple, but slow on deep pages and can skip/duplicate rows when data shifts.
- **Cursor (keyset)** — pass an opaque cursor (e.g. last-seen key); stable and efficient for large
  datasets, at the cost of no random page jumps.

## Versioning
Strategies: **URI path** (`/v2/...`), **header/media-type** (content negotiation), or query param.
The goal is to evolve without breaking existing clients; pick one and apply it consistently.
