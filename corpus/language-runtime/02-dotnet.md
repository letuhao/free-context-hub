---
id: corpus/language-runtime/dotnet/selection-critical
domain: language-runtime
subdomain: dotnet
topic: selection-critical
sources:
  - "learn.microsoft.com/dotnet/core/introduction — Introduction to .NET (read 2026-06-16, MS ©, paraphrased)"
  - "learn.microsoft.com/dotnet — async/await, Native AOT, GC (MS ©, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# .NET / C# — runtime, concurrency, and selection facts

## Platform identity: modern .NET is cross-platform
Modern **.NET (formerly ".NET Core", now just ".NET" from version 5)** is a **free, open-source,
cross-platform** developer platform — it runs on **Windows, Linux, and macOS** across **x64, Arm64,
and x86**, and is MIT-licensed. This corrects the common belief that **.NET only runs on Windows** —
that was true of the **original .NET Framework** (Windows-only, still supported but in maintenance
mode: security/reliability fixes, no new features), but **.NET 5+ unified the stack** into one
cross-platform implementation "rethought for the cloud age." So **".NET Framework" and ".NET (Core)
5+ are distinct implementations**, not the same thing; new development targets modern .NET. New major
versions ship **annually each November**. **C#** is the primary language.

## Execution model: CLR + JIT (+ Native AOT)
.NET code compiles to **Intermediate Language (IL)** that runs on the **Common Language Runtime
(CLR)**, which **JIT-compiles** IL to native code at run time. For startup- and footprint-sensitive
scenarios, **Native AOT** compiles ahead-of-time to a **self-contained native binary** with **no
JIT, faster startup, and smaller runtime memory** — useful for CLIs, microservices, and serverless.
It trades away some reflection/dynamic-loading capability and tends to produce a **larger on-disk
binary** (the runtime is bundled in). So .NET supports both **static and dynamic code** models.

## Memory management
.NET provides **automatic memory management via a self-tuning, tracing garbage collector**, making
it type-safe and memory-safe by default. It also exposes **value types and stack-allocated memory**
(`struct`, `Span<T>`) and an `unsafe` mode for low-level/native-interop optimizations — i.e. safe
code is the default model, with manual control available when needed.

## Concurrency: async/await
Asynchronous programming is a **first-class language feature** via **`async`/`await` and the `Task`
primitive**. Critically, `async`/`await` does **not** spawn a new thread per call.
`await` suspends the method and frees the current thread to do other work; the continuation
resumes (often on a thread-pool thread) when the awaited operation completes. It is a
**concurrency/throughput** mechanism for I/O-bound work, not automatic parallelism. For CPU-bound
parallelism .NET offers the **Task Parallel Library**, `Parallel`, and PLINQ.

## Typing
**C# is statically and strongly typed** with rich generics (reified, not erased — unlike Java),
inheritance, interfaces with default implementations, pattern matching, and nullable reference
types for compile-time null-safety opt-in.

## Ecosystem and selection fit
.NET's strengths are a **cohesive first-party stack** (runtime + libraries + tooling + **ASP.NET
Core** for high-performance web/APIs), strong **Azure integration**, excellent performance, and a
large enterprise ecosystem (NuGet). Choose .NET/C# for **enterprise web services and APIs, Windows
and cross-platform desktop, game development (Unity), and Azure-centric cloud** — especially teams
already invested in the Microsoft ecosystem. With Native AOT it is now competitive for small-footprint
serverless. It is a weaker default where the surrounding ecosystem is JVM- or Python-centric, or for
systems-level no-GC work (→ Rust/C++).
