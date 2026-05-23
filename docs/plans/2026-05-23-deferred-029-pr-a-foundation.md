# DEFERRED-029 — PR A (Foundation) — PLAN

**Date:** 2026-05-23
**DESIGN:** `docs/specs/2026-05-23-deferred-029-mcp-tenant-scope-design.md`
**Scope:** Land the `CallerScope` type, the `assertCallerScope`/`Multi` helpers, the
`resolveMcpCallerScope` resolver, and their tests. **No behavior change anywhere** — the new
symbols exist but no production path calls them yet. PR B onward wires them in per domain.

Size: **S–M** (1 new module + 1 new MCP auth file + 1 test file + package.json registration).

---

## Tasks

### Task 1 — Create `src/core/security/callerScope.ts`

Exact intent:
```ts
import { ContextHubError } from '../errors.js';

export type CallerScope = string | null | undefined;

/**
 * Service-layer tenant-scope guard (DEFERRED-029, PR A foundation).
 *
 * Three-valued CallerScope semantics, mirroring src/api/middleware/requireScope.ts:
 *   undefined → auth-off / env-token / no middleware attached → UNRESTRICTED
 *   null      → admin/global key (api_keys.project_scope IS NULL) → UNRESTRICTED
 *   string    → project-scoped key → must equal resourceProjectId
 *
 * Cross-tenant throws ContextHubError('NOT_FOUND') to preserve the
 * no-existence-oracle property the REST middleware already enforces.
 */
export function assertCallerScope(callerScope: CallerScope, resourceProjectId: string): void {
  if (callerScope === undefined || callerScope === null) return;
  if (callerScope !== resourceProjectId) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}

/** Multi-project variant. Strict-reject: a scoped key may reach at most its own project. */
export function assertCallerScopeMulti(callerScope: CallerScope, resourceProjectIds: string[]): void {
  if (callerScope === undefined || callerScope === null) return;
  if (resourceProjectIds.length !== 1 || resourceProjectIds[0] !== callerScope) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}
```

Verify: `npx tsc --noEmit` clean.

### Task 2 — Re-export from `src/core/index.ts`

So callers `import { assertCallerScope, type CallerScope } from '../../core/index.js'`.

Find the existing `src/core/index.ts` exports and add:
```ts
export { assertCallerScope, assertCallerScopeMulti, type CallerScope } from './security/callerScope.js';
```

Verify: `npx tsc --noEmit` clean.

### Task 3 — Unit tests: `src/core/security/callerScope.test.ts`

Four-case matrix + multi variant + NOT_FOUND shape assertion. No DB.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCallerScope, assertCallerScopeMulti } from './callerScope.js';
import { ContextHubError } from '../errors.js';

test('assertCallerScope: undefined → unrestricted (does not throw on any project)', () => {
  assert.doesNotThrow(() => assertCallerScope(undefined, 'proj-A'));
});

test('assertCallerScope: null → unrestricted (global key)', () => {
  assert.doesNotThrow(() => assertCallerScope(null, 'proj-A'));
});

test('assertCallerScope: matching scope → OK', () => {
  assert.doesNotThrow(() => assertCallerScope('proj-A', 'proj-A'));
});

test('assertCallerScope: cross-tenant → throws NOT_FOUND (no existence oracle)', () => {
  assert.throws(
    () => assertCallerScope('proj-A', 'proj-B'),
    (err: unknown) => {
      assert.ok(err instanceof ContextHubError);
      assert.equal((err as ContextHubError).code, 'NOT_FOUND');
      assert.equal((err as ContextHubError).message, 'not found');
      return true;
    },
  );
});

test('assertCallerScopeMulti: undefined / null → unrestricted', () => {
  assert.doesNotThrow(() => assertCallerScopeMulti(undefined, ['A', 'B']));
  assert.doesNotThrow(() => assertCallerScopeMulti(null, ['A', 'B']));
});

test('assertCallerScopeMulti: scope + single matching → OK', () => {
  assert.doesNotThrow(() => assertCallerScopeMulti('proj-A', ['proj-A']));
});

test('assertCallerScopeMulti: scope + single mismatching → NOT_FOUND', () => {
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-B']),
    /not found/,
  );
});

test('assertCallerScopeMulti: scope + multi (any size > 1) → NOT_FOUND (strict-reject, no result-count oracle)', () => {
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-A', 'proj-B']),
    /not found/,
  );
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-A', 'proj-A']),
    /not found/,
  );
});
```

### Task 4 — Register test in `package.json`

Append `src/core/security/callerScope.test.ts` to the `test` script.

Verify: `npx tsx --test src/core/security/callerScope.test.ts` → all green.

### Task 5 — Create `src/mcp/auth.ts` with `resolveMcpCallerScope`

```ts
import { ContextHubError, createModuleLogger, getEnv } from '../core/index.js';
import { validateApiKey } from '../services/apiKeys.js';
import type { CallerScope } from '../core/index.js';

const logger = createModuleLogger('mcp-auth');

/**
 * DEFERRED-029 PR A — MCP scope resolver.
 *
 * Maps an MCP request's workspace_token to a CallerScope:
 *   - MCP_AUTH_ENABLED=false → undefined (auth-off, unrestricted)
 *   - Missing/empty token (auth on) → UNAUTHORIZED
 *   - Legacy single-shared CONTEXT_HUB_WORKSPACE_TOKEN match → null (global, DEPRECATED — warns)
 *   - api_keys row match → keyEntry.project_scope (string | null)
 *   - No match → UNAUTHORIZED
 *
 * No production caller wires this in PR A — PR B onward switches each MCP tool handler to
 * derive callerScope from this and pass it to its service fn.
 */
export async function resolveMcpCallerScope(token: string | undefined): Promise<CallerScope> {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return undefined;

  if (!token) {
    throw new ContextHubError('UNAUTHORIZED', 'workspace_token required when MCP_AUTH_ENABLED=true');
  }

  if (env.CONTEXT_HUB_WORKSPACE_TOKEN && token === env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    logger.warn(
      { token_prefix: token.slice(0, 6) },
      'mcp: deprecated single-shared CONTEXT_HUB_WORKSPACE_TOKEN in use; migrate to a scoped api_keys token (DEFERRED-029)',
    );
    return null;
  }

  const keyEntry = await validateApiKey(token);
  if (!keyEntry) {
    throw new ContextHubError('UNAUTHORIZED', 'invalid workspace_token');
  }
  return keyEntry.project_scope;
}
```

Verify: `npx tsc --noEmit` clean.

### Task 6 — Verify nothing else changes

- Run `npx tsc --noEmit` — clean.
- Run `npm test` — same number of tests pass + the new 8 = current baseline + 8.
- `grep -rn "assertCallerScope\|resolveMcpCallerScope" src/` — only the new files + index re-export reference them (no production wiring yet).

### Task 7 — Commit + push + open PR A

Single commit covering tasks 1–5. PR title: `DEFERRED-029 PR A: foundation — CallerScope type + helpers + MCP resolver`.

PR body notes: (a) zero behavior change, (b) PR B (lessons) wires the helper into the first domain, (c) the security-framed review checklist for this PR is **trivially empty** (no production path uses the new symbols yet) — the per-PR checklist becomes substantive starting at PR B.

## Out of scope for PR A (defer to later PRs)

- Wiring the helper into any service function (PR B+).
- Wiring `resolveMcpCallerScope` into any MCP tool handler (PR B+).
- Auth-ON E2E tests (PR F).
- Deprecating the legacy shared workspace_token (PR E).

## Acceptance (PR A)

- [ ] AC-A1: `src/core/security/callerScope.ts` exists with both helpers + type.
- [ ] AC-A2: `src/mcp/auth.ts` exists with `resolveMcpCallerScope`.
- [ ] AC-A3: 8 helper unit tests pass (4 single-scope + 4 multi).
- [ ] AC-A4: `tsc --noEmit` clean.
- [ ] AC-A5: full `npm test` baseline + 8 (no regressions).
- [ ] AC-A6: `grep` proof that no production service or handler imports the new symbols yet.
