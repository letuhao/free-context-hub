# FAQ — Knowledge Exchange (Phase 11)

Hand-curated reference for the export / import / cross-instance pull feature set shipped in Phase 11. For quick usage, see [`docs/QUICKSTART.md`](../QUICKSTART.md#knowledge-exchange-phase-11). For architecture, see [`docs/phase11-task-breakdown.md`](../phase11-task-breakdown.md).

---

## What is the bundle format?

A zip archive with:

```
bundle.zip
├── manifest.json          schema_version, project metadata, sha256+bytes per entry
├── lessons.jsonl          one record per line, streamable
├── guardrails.jsonl
├── lesson_types.jsonl
├── chunks.jsonl           text + embedding vectors
├── documents.jsonl        metadata only
└── documents/
    └── <doc_id>.<ext>     raw binary, byte-identical to original
```

Every `*.jsonl` entry has a SHA-256 in the manifest that the decoder validates at EOF. Every document binary has its own SHA-256. Corruption anywhere in the archive is detected deterministically on read.

schema_version is currently `1`. Future versions will have migration shims on the decoder side.

---

## How do the three conflict policies differ?

Applied row-by-row within a single import transaction:

| Policy | Row already exists in target | Cross-tenant (owned by another project) |
|---|---|---|
| `skip` (default) | skipped, counted + reported in conflicts list | **always refused** — skipped + reported, regardless of policy |
| `overwrite` | existing row updated with bundle values | **still refused** — skipped + reported (security invariant) |
| `fail` | throws `conflict_fail` on first conflict, transaction rolls back | same |

The **cross-tenant UUID guard** is a security invariant from Sprint 11.3 and holds under all policies. A bundle crafted by project B cannot rewrite rows owned by project A — even when imported into project B with `overwrite`. The write is refused, logged as a conflict, and the rest of the import continues.

Dry-run (`?dry_run=true`) walks the whole bundle and reports counts + would-be conflicts without committing anything. Useful for "what would happen if I applied this" previews in the GUI.

---

## Self-pull: what happens when source and target are the same instance?

The Sprint 11.3 cross-tenant UUID guard sees the lesson's `lesson_id` is already owned by the source project. Under `skip` and `overwrite` both, the import treats it as a cross-tenant refusal — `skipped=1`, a conflict entry is recorded, and the row is not touched.

This is correct behavior for security — NOT a bug. A real cross-instance pull (two separate databases) would see fresh UUIDs and create the rows normally. The self-pull case mostly exists for testing the plumbing; the data-level round trip is meaningful only across separate databases.

---

## What security defenses does `pull-from` have?

- **URL validation**: scheme must be `http://` or `https://`.
- **SSRF allowlist**: `assertHostAllowed` resolves the remote host's DNS and rejects if any returned address is loopback, RFC1918, link-local, CGNAT, multicast, or cloud-metadata (169.254.169.254). Also handles IPv6 equivalents.
- **DNS-rebinding pinning** (Sprint 11.6c-sec): the IP validated by `assertHostAllowed` is passed to a custom undici `Agent` via `connect.lookup` override. undici uses that exact IP at connect time — no second DNS lookup, so a rebinding attacker can't flip the record.
- **Body-stall (slow-loris) defense** (Sprint 11.6c-sec): a `StallTransform` in the body pipeline resets a 60-second idle timer on every chunk. If no data arrives for the window, the stream aborts with `timeout` (504).
- **Size cap**: 500 MB per bundle (matches the `/import` multer limit). Enforced by a streaming `ByteCounter` transform, so we never hold the whole response in memory.
- **api_key validation**: the optional `api_key` body field is allow-listed to visible ASCII + HTAB before being passed to the `Authorization: Bearer ...` header. Prevents header-injection attacks that would otherwise echo the credential back through undici's `TypeError` message.
- **Agent lifecycle**: the pinned Agent is created per-request, used once, and `destroy()`ed in finally — bounded-time cleanup even if the remote is unresponsive.
- **No automatic redirect following**: `/export` never redirects; a 3xx response from the remote is treated as an error rather than chased.

---

## What's the memory profile of a large import?

- **Bundle decode**: line-by-line streaming via `readline` + a hash-tap `Transform`. Peak memory per JSONL entry is the largest single line (<1 MB typical), not the whole file. Checksum validation happens at EOF rather than up front.
- **Document content**: raw binary flows through `encodeStreamToBase64`, which maintains a 0-2 byte alignment tail and produces the base64 string progressively. For a 100 MB PDF, peak memory is ~134 MB (raw 1 MB chunk + growing 133 MB base64 string), down from ~233 MB in the pre-streaming implementation.
- **Hard ceiling**: V8's string heap max on 64-bit is ~512 MB. Base64 inflates 4/3×, so any single document ≥384 MB raw produces a string that V8 can't hold — `RangeError: Invalid string length`. In practice documents are ≤100 MB. The real fix (migrate `documents.content` to `bytea` + streaming INSERT) is Phase-10-level work, deferred beyond Phase 11.

---

## Why is the import N+1 no longer N+1?

Sprint 11.6c-perf replaced the per-row SELECT-to-check-existence pattern with a batched-SELECT driven by a `processBatched<Row>` helper. Each entity is consumed in chunks of `APPLY_BATCH_SIZE=200`, and each batch does ONE bulk `= ANY($1::uuid[])` SELECT instead of 200 individual ones. Document-lesson composites use pg's parallel-array `unnest` zip join to hit the composite PK index.

Query count for a 581-lesson + 76-guardrail + 14-doc + 10-chunk project:

- Before: 687 SELECTs + 687 INSERT/UPDATE = ~1374 queries
- After: 7 SELECTs + 687 INSERT/UPDATE = ~694 queries (~99% SELECT reduction, ~49% total reduction)

Every invariant (cross-tenant guard, fail-fast, per-conflict reason strings, dry-run, transaction atomicity, FK-safe order) is preserved. Detected intra-batch duplicate IDs trip a clean `malformed_bundle` error rather than falling through to an opaque pg unique-constraint violation.

---

## What if my bundle is malformed?

The decoder surfaces specific error codes:

| Code | Meaning |
|---|---|
| `malformed_bundle` | zip structure broken, bad `manifest.json`, or intra-batch duplicate IDs on import |
| `schema_version_mismatch` | manifest's `schema_version` ≠ the current reader's expected version |
| `missing_manifest` | zip has no `manifest.json` entry |
| `missing_entry` | manifest references an entry that isn't in the zip |
| `checksum_mismatch` | per-entry or per-binary SHA-256 doesn't match the manifest's recorded value |
| `malformed_jsonl` | a JSONL line failed to parse, or the line count doesn't match the manifest |
| `invalid_row` | a record violates schema-level invariants (e.g. lesson with null embedding) |
| `conflict_fail` | policy=fail hit a conflict |
| `io_error` | catch-all for unexpected filesystem or decode failures |

All errors roll back the transaction cleanly. The import route maps each code to an HTTP status (400 for malformed input, 409 for conflict_fail, 500 for io_error).

---

## What's NOT shipped and why

Deferred beyond Phase 11 with a sentence of rationale for each:

- **Merge conflict policy** (vs overwrite): the semantic "merge this lesson's content with the existing lesson's content" is only meaningful with a conflict resolution strategy we haven't defined (three-way? field-by-field? operator prompt?). Not worth shipping without a clear spec.
- **Bundle caching for repeat pulls**: would require an ETag/If-None-Match contract on `/export` + a disk-backed cache. Worth it only once cross-instance pull is used routinely.
- **Webhook / scheduled pulls**: a cron/job-queue pattern. Needs operator UI and retry semantics. Not mandatory for v1.
- **GUI for cross-instance pull**: API-only is fine for the CLI / script use case; no operator has asked for a UI yet.
- **Encryption / signing on bundles**: need key management design first. Today bundles are plaintext zip — transport security (HTTPS) is the integrity boundary for cross-instance pull.
- **`documents.content` TEXT → BYTEA migration**: Phase-10-level change that lifts the V8 string cap. Lots of read-path call sites. Tracked as the main remaining memory scalability concern.

---

## Where is this tested?

- `test/e2e/api/phase11-pull.test.ts` — 9 scenarios covering validation, SSRF, bad URL, nonexistent-remote, api_key injection, long project_id, dry-run, and happy-path self-pull.
- `test/e2e/api/phase11-import.test.ts` — 5 scenarios covering round-trip checksum, ID remapping, policy overwrite, policy fail + rollback, cross-tenant guard under overwrite.
- `test/e2e/gui/phase11-exchange.spec.ts` — 1 Playwright scenario covering the GUI export → download → upload → Apply flow.
- `src/services/exchange/bundleFormat.test.ts` — 16 unit tests.
- `src/services/exchange/base64Stream.test.ts` — 12 unit tests including byte-identical round-trip on 1 MB random input.
- `src/services/pinnedHttpAgent.test.ts` — 2 unit tests proving DNS pinning works end-to-end.
- `src/services/exchange/pullFromRemote.test.ts` — 3 unit tests on `StallTransform`.

All green at Phase 11 closeout. See the Phase 11 sprint patches in [`docs/sessions/SESSION_PATCH.md`](../sessions/SESSION_PATCH.md) for the per-sprint test counts.
