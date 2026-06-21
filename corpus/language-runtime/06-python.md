---
id: corpus/language-runtime/python/selection-critical
domain: language-runtime
subdomain: python
topic: selection-critical
sources:
  - "Wikipedia — Global interpreter lock (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "Wikipedia — Python (programming language) (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "docs.python.org — asyncio, threading, multiprocessing (read 2026-06-16, PSF, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Python (CPython) — runtime, concurrency, and selection facts

## Execution model & memory
Python is compiled to bytecode and run on a virtual machine; the reference implementation, **CPython**, is written in
C. Memory is managed by a **hybrid garbage collector**: primary **reference counting** plus a **cycle-detecting
collector** that reclaims reference cycles the counter alone cannot. Because it is interpreted, CPython is far slower
than compiled native code for CPU-bound work — commonly-cited benchmarks put it on the order of tens of times slower
than C (with markedly higher energy use; the memory overhead is more modest). Alternative implementations trade compatibility for speed:
**PyPy** (JIT-compiled, much faster for pure-Python loops but weaker C-extension support), **Jython** (JVM bytecode),
**Cython** (compiles a Python superset to C). This performance profile is why Python typically **delegates hot numeric
work to native libraries** (NumPy, PyTorch) rather than executing it in pure Python.

## The Global Interpreter Lock (GIL)
CPython holds a **GIL**: a process-wide mutex that allows only one native thread to execute Python bytecode at a time.
It exists to keep the interpreter simple and to let non-thread-safe C libraries integrate safely, and it speeds
single-threaded code by avoiding per-object locking. Its central consequence:
- **CPU-bound multithreading sees little/no speedup** — threads cannot run Python bytecode in parallel across cores,
  and GIL hand-off signalling can even make multithreaded CPU code slower than single-threaded.
- **I/O-bound multithreading works well** — blocking I/O calls **release** the GIL, so other threads run while one
  waits on the network/disk. The GIL limits CPU parallelism, not I/O concurrency.

## Achieving true multi-core parallelism
Because the GIL blocks thread-level CPU parallelism, CPython programs reach multiple cores via: **multiprocessing**
(separate processes, each with its own interpreter and GIL, communicating via IPC); **native/C extensions** that
release the GIL around heavy computation; or the **experimental free-threaded build** introduced in Python 3.13
(PEP 703), which can run without the GIL. Some non-CPython implementations (Jython, IronPython) have no GIL at all.

## asyncio (and how it differs from threads/processes)
`asyncio` provides **single-threaded cooperative concurrency** on an **event loop** using `async`/`await`. Coroutines
voluntarily yield control at `await` points (typically awaiting I/O); the loop then runs other ready coroutines. It is
well suited to I/O-bound and high-level structured network code (servers, DB clients, task queues) but provides
**concurrency, not parallelism** — it cannot use multiple cores. A key pitfall: a **blocking or CPU-bound call inside a coroutine
stalls the entire event loop**, because nothing yields (e.g., `time.sleep()` blocks, whereas `await asyncio.sleep()`
yields). Rule of thumb: threads/asyncio for I/O-bound, multiprocessing/native for CPU-bound.

## Typing discipline
Python is **dynamically and strongly typed with duck typing**: variable names are untyped, objects carry types, and
type errors surface **at usage time (runtime)**, not at definition time. It is *strong* — it refuses ill-defined
operations (e.g., adding a number to a string) rather than silently coercing. **Optional type hints** (PEP 484, since
3.5) enable *gradual* typing; external checkers like **mypy** use them for static analysis, but the interpreter does
**not enforce annotations at runtime**. They are not erased, though — annotations are retained and introspectable at
runtime (e.g. via `__annotations__`); the interpreter simply does not type-check against them.

## Ecosystem & selection fit
Python's dominant strength is its **data-science / ML / scientific ecosystem** (NumPy, pandas, PyTorch) plus web
frameworks (Django, Flask, FastAPI) and its role as a **glue/scripting language**. It is chosen for rapid development,
breadth of libraries, and readability. It is a weaker default for **CPU-bound, latency-critical, or high-core-count
compute in pure Python** (offload to native libs, processes, or another language) — the trade-off is developer speed
and ecosystem versus raw single-process CPU throughput.
