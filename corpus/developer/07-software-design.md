---
id: corpus/developer/software-design/solid-coupling-patterns
domain: developer
subdomain: software-design
topic: solid-coupling-patterns
sources:
  - "Wikipedia — SOLID / Design Patterns (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "martinfowler.com · refactoring.guru — patterns/coupling (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Software design — SOLID, coupling/cohesion, patterns

## The five SOLID principles
- **S — Single Responsibility:** a class should have one reason to change (one responsibility).
- **O — Open/Closed:** open for extension, closed for modification — add behavior without editing
  existing code (e.g. via polymorphism).
- **L — Liskov Substitution:** subtypes must be usable wherever their base type is expected, without
  breaking correctness.
- **I — Interface Segregation:** prefer many small, client-specific interfaces over one fat
  interface clients are forced to depend on.
- **D — Dependency Inversion:** depend on abstractions, not concretions; high-level modules
  shouldn't depend on low-level details.
SOLID is a set of **guidelines** for maintainable OO code — applying them blindly (e.g. splitting
everything into ever more classes) can add needless complexity; **more classes is not automatically
better**.

## Coupling and cohesion
- **Coupling** — degree of interdependence between modules. **Aim for low coupling** (changes don't
  ripple).
- **Cohesion** — how focused a module's responsibilities are. **Aim for high cohesion** (a module
  does one thing well).
The maintainability heuristic: **low coupling + high cohesion.**

## Composition over inheritance
Prefer **composition** (assemble behavior from collaborating objects) over **inheritance** (extend a
base class) as the default reuse mechanism. Inheritance creates tight coupling to the parent and is
**not always the right reuse tool** — deep hierarchies are fragile; composition is more flexible.

## Design patterns (GoF) and intent
Patterns are reusable solutions to recurring design problems, grouped as **creational**
(Factory, Builder, Singleton), **structural** (Adapter, Decorator, Facade), and **behavioral**
(Strategy, Observer, Command). Examples of intent:
- **Strategy** — encapsulate interchangeable algorithms behind a common interface.
- **Observer** — notify dependents when a subject's state changes (pub/sub).
- **Adapter** — make an incompatible interface usable by a client.
Patterns are tools, **not goals**: applying them everywhere ("pattern-itis") adds indirection and
complexity without value. Use a pattern when the problem it solves is actually present.
