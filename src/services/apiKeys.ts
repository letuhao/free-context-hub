import { randomBytes, createHash } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { getEnv } from '../env.js';
import { validate as isUuid } from 'uuid';
import { getPrincipal } from './principals.js';

export interface ApiKeyEntry {
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  project_scope: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
  // Actor Data Boundary F1b — the principal this credential authenticates to.
  // NULL = legacy/env-token key (pre-F1, back-compat).
  principal_id: string | null;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateKey(): string {
  const random = randomBytes(24).toString('base64url');
  return `chub_sk_${random}`;
}

/** List all API keys (never returns the key itself). */
export async function listApiKeys(): Promise<ApiKeyEntry[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT key_id, name, key_prefix, role, project_scope, expires_at, last_used_at, revoked, created_at, principal_id
     FROM api_keys ORDER BY created_at DESC`,
  );
  return res.rows ?? [];
}

/** Generate a new API key. Returns the full key (shown once). */
export async function createApiKey(params: {
  name: string;
  role?: string;
  project_scope?: string;
  expires_at?: string;
  created_by?: string; // Sprint 15.11 — minting operator (apiKeyName), for the per-creator limit.
  principal_id?: string; // Actor Data Boundary F1b — bind the credential to this principal.
}): Promise<{ key: string; entry: ApiKeyEntry }> {
  const pool = getDbPool();

  if (!params.name || params.name.trim().length === 0) {
    throw new ContextHubError('BAD_REQUEST', 'Key name is required.');
  }
  if (params.name.length > 128) {
    throw new ContextHubError('BAD_REQUEST', 'Key name must be 128 characters or fewer.');
  }

  const role = params.role ?? 'writer';
  if (!['admin', 'writer', 'reader'].includes(role)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid role "${role}". Allowed: admin, writer, reader.`);
  }

  // Actor Data Boundary F1b — bind-time principal validation. A credential may only be bound to
  // an EXISTING, ACTIVE, non-root principal. Root binding is refused here on purpose: a root-bound
  // credential is the highest privilege in the system and is minted ONLY by the out-of-band
  // bootstrap path (F1c), never through this general key-provisioning surface (escalation guard).
  const principalId = params.principal_id ?? null;
  if (principalId !== null) {
    // Fail clean on malformed input — principal_id is a UUID column; a non-UUID would otherwise
    // raise a raw pg 22P02 (500) once F1d wires this to caller input. [review-impl F1b #1]
    if (!isUuid(principalId)) {
      throw new ContextHubError('BAD_REQUEST', `Invalid principal_id "${principalId}" (must be a UUID).`);
    }
    const principal = await getPrincipal(principalId);
    if (!principal) {
      throw new ContextHubError('NOT_FOUND', `Principal ${principalId} not found.`);
    }
    if (principal.is_root) {
      throw new ContextHubError('BAD_REQUEST', 'Cannot bind a key to the root principal; root credentials are minted out-of-band (bootstrap).');
    }
    if (principal.status !== 'active') {
      throw new ContextHubError('BAD_REQUEST', `Cannot bind a key to a ${principal.status} principal; only active principals may hold credentials.`);
    }
  }

  const name = params.name.trim();
  const createdBy = params.created_by?.trim() || null;

  // Sprint 15.11 (DEFERRED-016 Q4) — per-operator key-count limit. Count active keys
  // minted by this operator; reject if at the cap. Legacy keys (created_by NULL) are
  // not attributed to any operator and are not counted.
  if (createdBy) {
    const limit = getEnv().MAX_KEYS_PER_CREATOR;
    const countRes = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api_keys WHERE created_by = $1 AND revoked = false`,
      [createdBy],
    );
    if (Number(countRes.rows[0].n) >= limit) {
      throw new ContextHubError(
        'BAD_REQUEST',
        `key_limit_exceeded: operator '${createdBy}' already holds ${limit} active keys (MAX_KEYS_PER_CREATOR)`,
      );
    }
  }

  const key = generateKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 12) + '...' + key.slice(-4);

  try {
    // Actor Data Boundary F1b — the bind is ATOMIC. The pre-check above gives a specific error in
    // the common case; this guarded INSERT...SELECT closes the TOCTOU window (a principal
    // suspended/retired between the check and the write inserts nothing — no zombie row holding the
    // active-name slot bound to a now-ineligible principal). [F1b adversary HIGH]
    const res = await pool.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, role, project_scope, expires_at, created_by, principal_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::uuid
       WHERE $8::uuid IS NULL
          OR EXISTS (SELECT 1 FROM principals
                     WHERE principal_id = $8::uuid AND status = 'active' AND is_root = false)
       RETURNING *`,
      [name, keyPrefix, keyHash, role, params.project_scope ?? null, params.expires_at ?? null, createdBy, principalId],
    );
    if (res.rowCount === 0) {
      // principalId was non-null but no eligible principal matched at write time — it changed
      // (suspended/retired) after the pre-check. Fail the mint rather than bind to a dead subject.
      throw new ContextHubError('CONFLICT', 'Principal became ineligible during key minting (suspended/retired); no key was created.');
    }
    return { key, entry: res.rows[0] };
  } catch (err) {
    // Sprint 15.11 (DEFERRED-016) — actor-identity uniqueness: at most one ACTIVE key
    // per name (partial unique index api_keys_active_name_uniq). A 23505 here means a
    // non-revoked key with this name already exists.
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      throw new ContextHubError(
        'BAD_REQUEST',
        `duplicate_active_key_name: an active key named '${name}' already exists; revoke it before minting a new one`,
      );
    }
    throw err;
  }
}

/**
 * Actor Data Boundary F1c — mint THE root credential. This is the ONLY path that sets
 * is_bootstrap=true and binds a key to the root principal; it is invoked exclusively by the
 * out-of-band bootstrap (src/services/bootstrap.ts), never exposed on any HTTP/MCP surface.
 *
 * The key is long-lived (no expiry — it is the recovery anchor), role 'admin', attributed to the
 * sentinel 'bootstrap:root' (so it is never counted against any operator's per-key limit). Caller
 * MUST pass the actual root principal id; this re-verifies is_root + active defensively.
 */
export async function createBootstrapRootKey(rootPrincipalId: string): Promise<{ key: string; entry: ApiKeyEntry }> {
  if (!isUuid(rootPrincipalId)) {
    throw new ContextHubError('BAD_REQUEST', 'createBootstrapRootKey requires a valid root principal id.');
  }
  const principal = await getPrincipal(rootPrincipalId);
  if (!principal || !principal.is_root) {
    throw new ContextHubError('BAD_REQUEST', 'createBootstrapRootKey target is not the root principal.');
  }
  if (principal.status !== 'active') {
    throw new ContextHubError('CONFLICT', 'root principal is not active; cannot mint a root credential.');
  }

  const key = generateKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 12) + '...' + key.slice(-4);
  // Fully-random, collision-free name (the prior `keyPrefix.slice` had ~4 chars of entropy). [F1c adversary #4]
  const name = `root-bootstrap-${key.slice(8, 28)}`;

  // ATOMIC ROTATION [F1c adversary #2/#3]: revoke any prior live bootstrap credential for root and
  // mint exactly one new one in a single transaction. Reissue is a true rotation, never an
  // accumulation of orphaned live root secrets. The partial unique index
  // api_keys_one_live_bootstrap_per_principal is the DB backstop under concurrency.
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE api_keys SET revoked = true
        WHERE principal_id = $1::uuid AND is_bootstrap = true AND revoked = false`,
      [rootPrincipalId],
    );
    const res = await client.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, role, project_scope, expires_at, created_by, principal_id, is_bootstrap)
       VALUES ($1, $2, $3, 'admin', NULL, NULL, 'bootstrap:root', $4::uuid, true)
       RETURNING *`,
      [name, keyPrefix, keyHash, rootPrincipalId],
    );
    await client.query('COMMIT');
    return { key, entry: res.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      // Lost a concurrent race to mint the single live bootstrap credential — safe to fail.
      throw new ContextHubError('CONFLICT', 'a root credential mint is already in progress; retry.');
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Revoke an API key. */
export async function revokeApiKey(keyId: string): Promise<void> {
  const pool = getDbPool();
  const res = await pool.query(
    `UPDATE api_keys SET revoked = true WHERE key_id = $1 AND revoked = false`,
    [keyId],
  );
  if (res.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', 'API key not found or already revoked.');
  }
}

/**
 * Actor Data Boundary F1d — classify WHY a token failed validation, so the auth layer can return
 * the structured CREDENTIAL_EXPIRED signal (distinct from a plain invalid token) per the G3
 * contract. Only call this when validateApiKey already returned null. Looks the key up by hash
 * WITHOUT the validity filters and reports the most relevant reason.
 */
export type CredentialFailure = 'expired' | 'revoked' | 'principal_inactive' | 'invalid';

export async function classifyCredentialFailure(token: string): Promise<CredentialFailure> {
  const res = await getDbPool().query<{
    revoked: boolean;
    expired: boolean;
    principal_id: string | null;
    principal_status: string | null;
  }>(
    `SELECT k.revoked,
            (k.expires_at IS NOT NULL AND k.expires_at <= now()) AS expired,
            k.principal_id,
            p.status AS principal_status
       FROM api_keys k
       LEFT JOIN principals p ON p.principal_id = k.principal_id
      WHERE k.key_hash = $1`,
    [hashKey(token)],
  );
  const row = res.rows[0];
  if (!row) return 'invalid';
  if (row.revoked) return 'revoked';
  if (row.expired) return 'expired';
  if (row.principal_id && row.principal_status !== 'active') return 'principal_inactive';
  return 'invalid';
}

/**
 * Validate a bearer token against api_keys. Returns the key entry if valid, else null.
 *
 * Actor Data Boundary F1b — a credential bound to a principal authenticates an ACTIVE subject:
 * the LEFT JOIN gates on principal status so suspending/retiring the bound principal instantly
 * denies every credential it holds. Legacy keys (principal_id NULL) skip the gate (back-compat).
 *
 * ROOT REQUIRES THE BOOTSTRAP MARKER: the validator is the universal chokepoint, so a root-bound
 * key authenticates ONLY when it carries `is_bootstrap = true` (set exclusively by the out-of-band
 * createBootstrapRootKey path). An errant root-bound row from any other path (restored backup,
 * manual SQL, a buggy migration) has is_bootstrap=false and is denied — no silent root escalation.
 * createApiKey (the public path) cannot set is_bootstrap and refuses root binding outright. [F1b/F1c]
 *
 * Note on the LEFT JOIN NULL fail-safe: a non-NULL principal_id with no resolvable row yields
 * p.status = NULL, and `NULL = 'active'` is false ⇒ deny. The FK (ON DELETE RESTRICT) makes a
 * dangling principal_id unreachable in practice; the predicate is still written to fail closed.
 */
export async function validateApiKey(token: string): Promise<ApiKeyEntry | null> {
  const pool = getDbPool();
  const tokenHash = hashKey(token);

  const res = await pool.query(
    `SELECT k.key_id, k.name, k.key_prefix, k.role, k.project_scope, k.expires_at,
            k.last_used_at, k.revoked, k.created_at, k.principal_id
     FROM api_keys k
     LEFT JOIN principals p ON p.principal_id = k.principal_id
     WHERE k.key_hash = $1 AND k.revoked = false
       AND (k.expires_at IS NULL OR k.expires_at > now())
       AND (k.principal_id IS NULL
            OR (p.status = 'active' AND (p.is_root = false OR k.is_bootstrap = true)))`,
    [tokenHash],
  );

  if (!res.rows?.[0]) return null;

  // Update last_used_at (fire-and-forget)
  pool.query(`UPDATE api_keys SET last_used_at = now() WHERE key_id = $1`, [res.rows[0].key_id]).catch(() => {});

  return res.rows[0];
}
