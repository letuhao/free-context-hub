---
id: corpus/language-runtime/cross-language/decision-criteria
domain: language-runtime
subdomain: cross-language
topic: decision-criteria
sources:
  - "Synthesis of the per-language corpus docs (python/go/rust/java/dotnet/js-ts) in this set"
  - "Own comparative analysis (selection model)"
license_posture: own-words-synthesis
status: drafted
last_reviewed: 2026-06-16
---

# Cross-language selection — the decision model

## The core idea
Language selection is a **requirements-to-runtime mapping**, not a contest for a single "best"
language. The senior view: **architecture and team competence usually matter more than language
choice**, and **no one language is best for everything**. The job is to match a workload's dominant
constraints to a runtime's properties, then weigh team skills, hiring, and ecosystem.

## The axes that actually decide it
- **Concurrency model** — these are distinct categories, not one spectrum: *single-thread event
  loop* (Node; Python `asyncio` is the same category — cooperative concurrency on one thread, **not**
  GIL-bound threads); *OS-thread parallelism constrained by a GIL* (Python `threading` — true CPU
  parallelism blocked by the GIL); *lightweight runtime-scheduled threads* (Go goroutines and Java
  virtual threads — both user-mode threads multiplexed onto OS threads, though their designs differ
  and only Go's are classic goroutines); *ownership-checked threads* (Rust — data-race-free at
  compile time). Match to whether the load is **I/O-bound** (event loops and lightweight threads
  shine) or **CPU-bound** (true parallelism: Go, Rust, JVM, .NET, or separate processes).
- **Memory management** — tracing GC (Go, Java, .NET, JS) gives developer speed but **GC pauses**;
  ownership/RAII (Rust) or manual (C/C++) gives **no-GC predictable latency** at a higher skill
  cost. Pick by whether **latency-floor / footprint** is a hard constraint.
- **Compilation model** — interpreted (Python) vs. JIT (JVM, .NET CLR, V8) vs. AOT-native (Go, Rust,
  .NET Native AOT). This drives **startup time and footprint**. For **serverless/cold-start** the
  fast-start options are both AOT-native (Rust, Go) *and* lightweight interpreted/JIT runtimes
  (Node, Python are among the most common serverless runtimes precisely for fast cold start); the
  weak fit is a **plain warm-up-dependent JVM/.NET-on-CLR** process (mitigated by GraalVM Native
  Image / .NET Native AOT).
- **Type discipline** — dynamic (Python, JS) vs. static (Go, Rust, Java, C#, TypeScript). As a
  *tendency*, static catches classes of bugs at compile time and eases large-team refactoring, while
  dynamic favors rapid iteration — but large teams ship at scale on dynamic languages with tooling
  (type hints + mypy, TypeScript over JS), so this is a lean, not a law.
- **Ecosystem fit** — ML/data → Python; cloud-native/infra → Go; large enterprise/big-data → Java;
  cross-platform enterprise web + Azure-centric shops → .NET (note: modern .NET is fully
  cross-platform, not Windows-only); front-end + full-stack JS → Node/TS; systems/perf-safety → Rust.
- **Team & hiring** — the most maintainable system is one the team can actually staff and operate;
  a "better" language nobody knows is usually the wrong call.
- **Memory-safety / security posture** — both GC languages and Rust prevent the memory-corruption
  bug classes that C/C++ permit (use-after-free, buffer overflow); **Rust additionally** prevents
  data races in safe code at compile time, which GC languages do not. Relevant for security-critical
  or untrusted-input components.

## A rough mapping (defaults, not laws)
- **Perf- and safety-critical systems / no GC** → **Rust** (or C/C++).
- **Cloud-native network services, infra tooling, simple ops, fast deploy** → **Go**.
- **ML / data / scientific / rapid scripting & glue** → **Python**.
- **Large enterprise back-ends, big-data/streaming, long-lived teams** → **Java/JVM**.
- **Cross-platform enterprise web/APIs, Azure-centric, C#-language game dev (Unity)** → **.NET / C#**.
- **I/O-bound web back-ends and full-stack one-language** → **Node / TypeScript**.

## Common false beliefs in this area
(The correct positions, stated plainly.)
- No single language is best for everything — selection is a workload-to-runtime match.
- Compiled is **not** always faster than JIT in production: a warmed JIT can match or beat naive
  AOT; conversely a cold JIT loses to AOT for short-lived processes. It depends on workload and
  warm-up — the same trade-off the compilation-model axis describes.
- Rewriting in another language does **not** automatically fix problems: it cannot fix a bad
  architecture or a team that can't operate it. A rewrite fixes *specific* properties — e.g. a Rust
  rewrite can remove GC-latency and data races; a **Go rewrite does not remove GC-latency (Go is
  garbage-collected)**, though it may simplify ops or improve concurrency ergonomics.
- Architecture and team usually matter more than language choice, not less.
- Microservices need not be uniformly polyglot nor uniformly single-language: choose per service,
  bounded by the operational cost of heterogeneity.
