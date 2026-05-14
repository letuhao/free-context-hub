# artifact_id Convention (Phase 13)

The artifact leasing protocol (Phase 13 F1) requires agents to use a consistent
`artifact_id` string when claiming locks on named artifacts. Inconsistent IDs
cause silent miscoordination: two agents may think they're working on different
artifacts when they're working on the same one.

## Format

```
artifact_id = first-segment[/sub-segment[/sub-segment...]]
first-segment    = [a-z0-9][a-z0-9-_]*
sub-segment      = [a-z0-9][a-z0-9-_]*
```

Validation regex (enforced server-side):
```
/^[a-z0-9][a-z0-9\-_]*(?:\/[a-z0-9][a-z0-9\-_]*)*$/
```

## Rules

1. **Lowercase only.** No uppercase letters anywhere.
2. **Hyphens for spaces.** "Section One" → `section-one`, not `section_one` or `Section%20One`.
3. **No special characters.** No `§`, no `.`, no `:`, no whitespace, no Unicode. Underscore (`_`) is permitted within segments.
4. **`artifact_type` is a SEPARATE parameter**, NOT part of `artifact_id`. The `artifact_type` argument to `claim_artifact` (`'lesson' | 'document' | 'report-section' | 'custom'`) provides categorization; `artifact_id` is the within-category slug.
5. **Slashes only between segments.** No leading or trailing slashes, no consecutive slashes (`//`), no slashes at segment boundaries.

## Examples by `artifact_type`

| artifact_type | artifact_id | What it refers to |
|---------------|-------------|--------------------|
| `report-section` | `reckoning-record-s1` | §1 of `reckoning-record.md` |
| `report-section` | `reckoning-record-s2` | §2 of the same file |
| `lesson` | `b346feb2-67e6-4b19-aeb5-943f8698c0e4` | A specific lesson by UUID |
| `document` | `e15edaef-1d63-4cff-a9cc-7f972a0887d5` | A specific document by UUID |
| `custom` | `loreweave-architecture-review` | Free-form project artifact |
| `custom` | `phase-13/sprint-13.1/migration` | Nested project artifact |

## Why this matters

The leasing protocol uses `(project_id, artifact_type, artifact_id)` as the
uniqueness key for an active lease. Two agents using `Section 1` vs `section-1`
vs `section_1` will hold parallel leases for what they think is the same
artifact — defeating the entire coordination story.

## Agent obligations

1. **At session start:** call `list_active_claims` to see what other agents are
   working on. Use the artifact_ids you see as the canonical form for the same
   artifacts going forward.
2. **Before editing a named artifact:** call `claim_artifact` with the
   correctly-formatted ID. If `claim_artifact` returns `conflict`, respect it
   (do not write to the artifact even if you could).
3. **Project Codices and CLAUDE.md SHOULD document** the project-specific
   conventions for `artifact_type` choices and naming patterns (e.g., is a
   reckoning-record section a `report-section` or a `custom`?). Phase 13
   only enforces the format; semantic conventions are project-level.

## Validation

The service's `validateClaimInput` runs the regex above on every `claim_artifact`
call and throws on mismatch. Failed validation surfaces as an MCP/REST 400 error
with a clear message pointing to this doc.
