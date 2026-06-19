---
id: corpus/developer/testing/levels-doubles-coverage
domain: developer
subdomain: testing
topic: levels-doubles-coverage
sources:
  - "Wikipedia — Software testing / Test double (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "martinfowler.com — Test Pyramid, Mocks Aren't Stubs (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Testing — levels, test doubles, TDD, and coverage

## The test pyramid (levels)
- **Unit tests** — exercise a small unit (function/class) in isolation; fast, numerous, the base of
  the pyramid.
- **Integration tests** — verify several components work together (e.g. service + database); fewer,
  slower.
- **End-to-end (E2E)** — drive the whole system as a user would; slowest, most brittle, fewest.
The **pyramid** prescribes **many unit, fewer integration, fewest E2E** — because E2E tests are slow
and flaky. **More E2E is not automatically better than unit tests**; over-weighting E2E yields slow,
fragile suites.

## Test doubles (mock ≠ stub)
A **test double** stands in for a real dependency. They differ by purpose:
- **Stub** — returns canned answers to calls (provides indirect *input*).
- **Mock** — pre-programmed with **expectations** and **verifies the interactions** (asserts calls
  happened) — behavior verification.
- **Fake** — a working but simplified implementation (e.g. in-memory DB).
- **Spy** — records how it was called for later inspection.
So **mock and stub are not the same**: a stub feeds state; a mock verifies behavior.

## TDD
**Test-Driven Development** is the **red → green → refactor** cycle: write a failing test (red),
write minimal code to pass (green), then clean up while keeping tests green (refactor).

## What coverage proves (and doesn't)
**Code coverage** measures which lines/branches were **executed** by tests — not whether the
behavior was **asserted** or correct. **100% coverage does NOT mean bug-free or fully tested**: code
can be executed without any meaningful assertion, and coverage says nothing about missing cases,
bad inputs, or wrong specifications. Coverage is a useful *gap finder* (untested code), not a proof
of quality.
