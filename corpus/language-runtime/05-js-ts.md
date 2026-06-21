---
id: corpus/language-runtime/js-ts/selection-critical
domain: language-runtime
subdomain: js-ts
topic: selection-critical
sources:
  - "nodejs.org/en/docs — the event loop, worker_threads (paraphrased)"
  - "typescriptlang.org/docs/handbook — types, compilation (paraphrased)"
  - "react.dev · nextjs.org/docs · angular.dev · docs.nestjs.com (paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# JavaScript / TypeScript (Node) + framework selection — runtime & selection facts

## Node runtime: the single-threaded event loop
Node.js executes JavaScript on a **single main thread** running an **event loop** (implemented on
**libuv**). Rather than a thread per request, Node registers callbacks/promises and processes I/O
**asynchronously and non-blockingly**, so one thread can juggle many thousands of concurrent
connections. Node is **not multi-threaded by default**: your JS runs on one thread (libuv uses a
small background thread pool — by default 4 — for some file/DNS/crypto work, but the JavaScript
itself is single-threaded). Because of this, a **CPU-bound task blocks the event loop**, stalling
all other requests — the classic Node failure mode, and the reason Node is a weak default for
CPU-heavy work. The escape hatch is **`worker_threads`** (true parallel JS threads, each with its
own event loop; memory is isolated by default, communicating by message passing, though
`SharedArrayBuffer` can share memory explicitly) or offloading to native addons / separate services.
Rule of thumb: Node excels at **I/O-bound, high-concurrency** workloads (APIs, gateways, real-time),
and is a weak default for sustained heavy computation.

## TypeScript: types erased at compile time
**TypeScript** adds a **static, structural type system** over JavaScript, catching type errors at
**compile time** and powering editor tooling. Crucially, **TypeScript does NOT do runtime type
checking** — types are **erased during compilation to JavaScript** and have **zero runtime
presence**. Data crossing a trust boundary (HTTP body, DB row, `JSON.parse`)
must be **validated at runtime** (e.g. zod/io-ts); a TS type alone guarantees nothing about a value
that actually arrives at run time. The npm ecosystem is the largest in existence — a strength
(breadth, speed) and a liability (**supply-chain risk**, transitive-dependency bloat).

## Framework selection (the part SAs get wrong)
- **React** is a **UI library**, not a framework — it renders components and manages view state,
  but you assemble routing, data fetching, and build setup yourself (or via a framework).
- **Next.js** is a **React framework** built *on top of* React (it *is* React, with a framework
  around it) — it adds **SSR, SSG, ISR, and React Server Components (RSC)**, file-based routing,
  and bundling.
- **Angular** is an **opinionated, batteries-included framework** (Google): dependency injection,
  router, forms, HttpClient, and **RxJS** are built in, with TypeScript first-class — a full
  framework with strong conventions, unlike React's library approach.
- **NestJS** is an **opinionated server-side (back-end) framework for Node**, Angular-influenced
  (modules, decorators, DI), typically over Express/Fastify — for structured APIs/microservices.

## Rendering-strategy trade-offs
- **CSR (client-side rendering):** the browser downloads JS then renders — simplest, but slower
  first paint and weaker SEO.
- **SSR (server-side rendering):** HTML rendered per request on the server — better first paint/SEO,
  higher server cost and latency per request.
- **SSG (static site generation):** HTML built **at build time**, served from CDN — fastest and
  cheapest, but content is fixed until rebuilt (ISR re-generates on a schedule/on-demand).
- **RSC (React Server Components):** components that render on the server and ship no JS for
  themselves, reducing client bundle size; composes with client components.
The selection axis: freshness vs. first-paint speed vs. server cost vs. SEO.

## Selection fit
Choose Node/TS for **I/O-bound web back-ends, BFF/API gateways, real-time (WebSocket) services, and
full-stack JavaScript** where sharing one language and types across front-end and back-end is
valuable, and for the **richest front-end ecosystem**. Avoid pure Node for **CPU-bound compute**
without workers/native offload. Pick the front-end tool by control vs. convention: React(+Next.js)
for flexibility and the largest ecosystem; Angular for large teams wanting built-in structure.
