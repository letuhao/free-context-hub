---
id: corpus/language-runtime/rust/selection-critical
domain: language-runtime
subdomain: rust
topic: selection-critical
sources:
  - "Wikipedia — Rust (programming language) (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "doc.rust-lang.org/book — Ownership / References & Borrowing / Fearless Concurrency (MIT/Apache, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Rust — memory model, safety, and selection facts

## Memory model: ownership and RAII (no garbage collector)
Rust's defining idea is **ownership**, checked entirely **at compile time**. By default every value
has **exactly one owner** (a variable); shared ownership is available explicitly via reference-counted
types `Rc<T>` (single-thread) and `Arc<T>` (thread-safe). When the owner goes out of scope the value
is dropped and its resources freed (**RAII** — deterministic destruction, customizable via the `Drop`
trait). Assignment or passing a value to a function **moves** ownership rather than copying, after
which the previous binding can no longer be used — *except* for types implementing the `Copy` trait
(primitives like integers and `bool`), which are copied bitwise instead of moved. This compile-time
discipline is how Rust enforces **memory safety without a conventional garbage collector**: there is
no runtime GC and no stop-the-world pauses, yet the program is free of dangling pointers,
use-after-free, double-free, and buffer overflows. Performance is **comparable to C/C++**, and
because there is no GC there are no collector pauses — the reason it suits latency-floor and systems
work.

## Borrowing and references
Instead of moving ownership, code can **borrow** a value via a reference. Two reference kinds
encode an exclusivity rule: **`&T`** is a *shared, immutable* reference (many may exist at once),
and **`&mut T`** is an *exclusive, mutable* reference. The core rule the compiler enforces is
**"one mutable XOR many immutable"**: at any moment you may have either a single `&mut T` or any
number of `&T`, never both. A `&mut T` can coerce to a `&T`, but not the reverse. This rule is what
statically rules out aliasing bugs and data races.

## The borrow checker (compile time, not runtime)
The **borrow checker** tracks the **lifetimes** of references so a reference can never outlive the
value it points to. It is **purely static analysis that runs at compile time** — it is *not* a
runtime check and adds no runtime cost. The price is paid in **compile time and a steep learning
curve** (fighting the borrow checker), not in execution speed.

## Concurrency: Send/Sync and "fearless concurrency"
For **safe** code, the type system prevents **data races at compile time**. Two **auto-derived
marker traits** drive this: **`Send`** (a type can be moved to another thread) and **`Sync`** (a
type can be shared by reference across threads). Most types are `Send`/`Sync` automatically; the
notable exceptions are single-thread types like `Rc<T>`, `RefCell<T>`, and raw pointers. Combined
with the borrow rules, the compiler rejects code that would share mutable state unsafely across
threads — Rust calls this **fearless concurrency**. This guarantees freedom from *data races*, not
from all concurrency bugs (deadlocks and logic races are still possible).

## No null: Option and Result
Rust has **no null**. Optionality is modeled with **`Option<T>`** (`Some(v)` / `None`) and
recoverable errors with **`Result<T, E>`** (`Ok(v)` / `Err(e)`); callers must **explicitly handle**
both via `match`, `if let`, or `?`. This pushes "missing value" and "operation failed" into the
type system, eliminating an entire class of null-dereference bugs at compile time. Unrecoverable
errors use `panic!`.

## Zero-cost abstractions and performance
Many Rust features are **zero-cost abstractions** — iterators, generics (monomorphized), traits —
**optimized away at compile time with no runtime penalty**, so high-level code compiles down to
roughly what hand-written low-level code would. The language-level safety guarantees generally impose
**no runtime overhead**; the main always-on cost is **bounds-checked array indexing** (on by default,
can cost in hot loops, removable in carefully scoped `unsafe`). Opt-in library safety types do carry
runtime cost — `Rc`/`Arc` reference counting, `RefCell` borrow tracking, `Mutex` locking — but those
are explicit choices, not blanket language overhead.

## `unsafe` is scoped, not global
The **`unsafe`** keyword opens operations the compiler cannot verify — dereferencing raw pointers,
calling foreign (FFI) code, certain low-level intrinsics. Inside an `unsafe` block the **programmer**
is responsible for upholding memory/type safety, and violations cause undefined behavior. Crucially,
`unsafe` is **localized to that block** — it does *not* turn off Rust's guarantees for the rest of
the program. Idiomatic Rust isolates a small audited `unsafe` core behind a safe API.

## Selection fit and drawbacks
Typical fit: **systems software, OS/kernel components, embedded, game engines, and
performance- and safety-critical services** — anywhere you want C/C++-class performance *with*
memory safety and no GC pauses. Main drawbacks: **steep learning curve** (ownership/borrow/lifetimes)
and **slower compile times**, which slow early iteration and raise the team-skill bar. The safety
guarantees are scoped: Rust prevents *memory* bugs and data races, but it does **not** eliminate
logic errors, nor does rewriting in Rust fix a bad architecture.
