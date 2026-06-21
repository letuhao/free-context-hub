---
id: corpus/language-runtime/java/selection-critical
domain: language-runtime
subdomain: java
topic: selection-critical
sources:
  - "openjdk.org/jeps/444 — Virtual Threads (canonical JEP, paraphrased; finalized JDK 21)"
  - "docs.oracle.com/javase — JVM, JIT (HotSpot), GC tuning (G1/ZGC) (paraphrased)"
  - "Wikipedia — Java (programming language) (CC-BY-SA, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Java (JVM) — runtime, concurrency, and selection facts

## Execution model: bytecode + JIT
Java source is compiled to **platform-neutral bytecode** that runs on the **Java Virtual Machine
(JVM)** — the "write once, run anywhere" portability story. The JVM does **not** merely interpret:
HotSpot starts by interpreting, then a **Just-In-Time (JIT) compiler** compiles hot methods to
native code at run time, applying profile-guided optimizations. So Java is **not interpreted-only**:
after JIT warm-up, long-running Java approaches native performance. The trade-off is a **warm-up
cost**: peak performance arrives only after the JIT
has profiled and compiled hot paths, and startup carries JVM-initialization overhead (one reason
plain JVM apps are a weaker default for short-lived serverless functions; GraalVM Native Image
ahead-of-time compilation exists to address this).

## Garbage collection
The JVM provides **automatic, tracing garbage collection**, and the collector is **pluggable and
tunable**. **G1** is the default general-purpose collector; **ZGC** (and Shenandoah) target
**very low pause times** — ZGC is designed for **sub-millisecond (<1ms) max pauses even on
large (multi-terabyte) heaps**. ZGC gained a **generational** mode in JDK 21 (initially opt-in via
`-XX:+ZGenerational`), which became the **default in JDK 23**. Note that every tracing GC still
pauses: modern collectors *minimize and bound* pauses, they do not eliminate them — the JVM is not
pause-free. Choice of collector is an explicit latency-vs-throughput knob.

## Concurrency: platform threads and virtual threads
Classic Java threads are **platform threads** — thin wrappers over **OS threads**, so they are
relatively expensive and limited to thousands. **Virtual threads** (JEP 444, **finalized in
JDK 21, 2023**) are **lightweight threads scheduled by the JVM**, not the OS: the runtime
**mounts/unmounts** many virtual threads onto a small pool of platform **carrier threads** (an
**M:N** model), unmounting a virtual thread when it blocks on I/O so the carrier is freed. The
payoff is **high-throughput concurrency in a simple, blocking/synchronous coding style** —
**millions** of virtual threads are feasible. Two properties are easy to get wrong: virtual threads
do **not** add more OS threads (the platform-thread count stays small — that is the entire point),
and they raise **I/O-bound** throughput, not raw CPU parallelism. For data parallelism Java instead
offers the `java.util.concurrent` toolkit, `ForkJoinPool`, and parallel streams.

## Typing
Java is **statically and strongly typed**, checked at compile time, with generics (with **type
erasure** at runtime). This catches many errors before execution, at the cost of more ceremony than
dynamically typed languages.

## Ecosystem and selection fit
Java's decisive advantage is a **vast, mature enterprise ecosystem** — **Spring/Spring Boot**,
Jakarta EE, Hibernate, Kafka, Hadoop/Spark — plus enormous hiring pools and long-term stability.
Choose Java/JVM for **large, long-lived enterprise back-ends and big-data/streaming platforms**,
teams that value tooling, libraries, and maintainability, and high-concurrency services (now
ergonomic with virtual threads). It is a weaker default where **fast cold start and small memory
footprint dominate** (short-lived serverless without Native Image), or for systems work needing
manual memory control and no GC (→ Rust/C++). The JVM is also a polyglot runtime (Kotlin, Scala,
Clojure), so the platform choice often outlives the language choice.
