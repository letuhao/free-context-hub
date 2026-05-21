# Sprint 15.12 — REVIEW-DESIGN round 1 (security-aware self-review)

**Date:** 2026-05-21
**Subject:** `docs/specs/2026-05-21-phase-15-sprint-15.12-design.md` rev 1 (hash `df5fc93fc943617f63e6e0c02ff71a6cdcd6fb48`)
**Method:** "Where does tenant isolation leak?"

---

## F1 (BLOCK) — `requireBodyProjectScope` omission hole: a scoped key writes to DEFAULT_PROJECT_ID

**Where:** §1.1 — the body-project guard for `createBody` / `submitIntake`.

**The problem:** the guard allows `declared === undefined` to pass (`if declared !==
undefined && declared !== attachedScope → 404`). When a project-A-scoped key omits
`project_id` in the body, the guard passes, and the SERVICE's
`resolveProjectIdOrThrow(undefined)` falls back to **`DEFAULT_PROJECT_ID`** — which is
NOT the key's scope. So a project-A key can create a decision body / submit intake into
the `DEFAULT_PROJECT_ID` project, **escaping its own scope**. The exact tenant-isolation
hole 009 is meant to close, reopened on the create path.

**Recommended fix:** when a scoped key omits the body project, **inject the key's scope**
so the resource lands in the caller's project:
```ts
export function requireBodyProjectScope(bodyField = 'project_id') {
  return (req, res, next) => {
    const scope = req.apiKeyScope;
    if (scope === undefined || scope === null) return next();
    const declared = (req.body ?? {})[bodyField];
    if (declared === undefined) {
      // a scoped key's resource defaults to ITS OWN project, never DEFAULT_PROJECT_ID
      req.body = { ...(req.body ?? {}), [bodyField]: scope };
      return next();
    }
    if (declared !== scope) { res.status(404).json({status:'error', code:'NOT_FOUND', error:'project not found'}); return; }
    next();
  };
}
```
A scoped key now always writes to its own project; an explicit cross-project declaration
→ 404. Auth-off / global unchanged.

**Severity:** BLOCK — silent scope-escape on create routes.

---

## F2 (WARN) — `artifact` resolver referenced in §1.3 but absent from the §1 RESOLVERS map

**Where:** §1 RESOLVERS / ScopeEntity union vs §1.3.

**The problem:** §1 defines `ScopeEntity = topic|request|motion|dispute|intake|body|task`
and a RESOLVERS map without `artifact`; §1.3 then says "Add an `artifact` resolver" for
the board artifact routes. The design is internally inconsistent — `requireResourceScope
('artifact')` would be a type error / missing key.

**Recommended fix:** add `artifact` to the union + RESOLVERS map in §1:
`SELECT t.project_id FROM artifacts a JOIN tasks tk ON tk.task_id=a.task_id JOIN topics t
ON t.topic_id=tk.topic_id WHERE a.artifact_id=$1`. Confirm the artifact route param name
in BUILD (likely `:artifactId` or `:id`).

**Severity:** WARN — completeness; would surface immediately in BUILD/tsc.

---

## F3 (WARN) — tail-mode `has_more` computation is described two ways and risks a full COUNT

**Where:** §2.1.

**The problem:** §2.1 says `has_more = (total_count > returned_count)` in the code
comment but "a row exists with `seq < min(returned)`" in prose. A full `COUNT(*)` per
induction pack is wasteful on a large topic. The two descriptions also differ.

**Recommended fix:** pick the cheap EXISTS form:
- If `returned_count < N` → no window overflow → `has_more = false` (no query).
- Else → `has_more = EXISTS(SELECT 1 FROM coordination_events WHERE topic_id=$1 AND seq
  < $minReturnedSeq)`. O(1) with the `(topic_id, seq)` index.

**Severity:** WARN — correctness is fine either way; this avoids an O(n) COUNT and
resolves the spec ambiguity.

---

## Summary
| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | §1.1 body-project omission | inject key scope on omission (no DEFAULT_PROJECT_ID escape) |
| F2 | WARN | §1 artifact resolver missing | add to union + RESOLVERS |
| F3 | WARN | §2.1 has_more | EXISTS(seq<min) + short-circuit when returned<N |

**Verdict:** REJECTED — 1 BLOCK. Revise to rev 2.
