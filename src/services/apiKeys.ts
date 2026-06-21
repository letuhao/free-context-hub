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

// ────────────────────────────────────────────────────────────────────────────
// Actor Data Boundary — Stream S5 (NHI hardening). standards-gap.md §3 NHI.
//
// Three operations layered on the EXISTING api_keys columns (expires_at,
// last_used_at, principal_id, revoked) — migration-free (COMPLETION-plan §2.2):
//   - reviewApiKeys()        : log-based access review (age / unused-≥90d /
//                              never-expires / ownerless) + aggregate stats.
//   - rotateApiKey()         : mint a successor + bounded overlap window; the
//                              old key auto-expires (UPDATE expires_at) inside a
//                              single transaction so a partial rotation can't
//                              leave the old key live forever.
//   - createEphemeralApiKey(): short-TTL, principal-bound credential for CI /
//                              one-shot agents (auto-expires at validate-time).
//
// Defaults are constants (not env) so this slice does NOT touch the src/env.ts
// magnet (§2.9). If overlap/TTL ever need to be operator-tunable, the recorded
// optional env keys are NHI_ROTATION_OVERLAP_DAYS / NHI_EPHEMERAL_MAX_TTL_HOURS.
// ────────────────────────────────────────────────────────────────────────────

/** Default overlap window for a rotation: the old key stays valid this long. */
export const DEFAULT_ROTATION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Hard ceiling on a rotation overlap — a longer-lived "successor" defeats the point. */
export const MAX_ROTATION_OVERLAP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Default ephemeral TTL when the caller doesn't specify one. */
export const DEFAULT_EPHEMERAL_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Hard ceiling on an ephemeral TTL — "ephemeral" means short-lived by definition. */
export const MAX_EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Access-review staleness threshold: a key unused for this long is flagged. */
export const UNUSED_REVIEW_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface ApiKeyReviewItem extends ApiKeyEntry {
  /** Whole days since the key was created. */
  age_days: number;
  /** Whole days since last use, or null if never used. */
  days_since_used: number | null;
  /** Display name of the bound principal, or null for legacy/ownerless keys. */
  principal_name: string | null;
  /** never used (or last used) for ≥90d AND not freshly created. */
  unused_90d: boolean;
  /** expires_at IS NULL — a non-expiring durable credential. */
  never_expires: boolean;
  /** principal_id IS NULL — legacy/env key with no named owner. */
  ownerless: boolean;
}

export interface AccessReviewStats {
  total_active: number;
  unused_90d: number;
  never_expires: number;
  ownerless: number;
}

export interface AccessReviewResult {
  stats: AccessReviewStats;
  keys: ApiKeyReviewItem[];
}

/**
 * Log-based access review of all ACTIVE (non-revoked) keys. "Reviewed from the
 * logs, not by asking" — surfaces stale / never-expiring / ownerless credentials
 * for revocation. Computes per-key flags and the aggregate stat-card counts.
 *
 * The flags are derived in SQL (single round-trip) against `now()` so they are
 * always evaluated server-side relative to the DB clock, never the API host's.
 */
export async function reviewApiKeys(): Promise<AccessReviewResult> {
  const pool = getDbPool();
  const thresholdDays = Math.floor(UNUSED_REVIEW_THRESHOLD_MS / (24 * 60 * 60 * 1000));
  const res = await pool.query<
    ApiKeyEntry & {
      age_days: string;
      days_since_used: string | null;
      principal_name: string | null;
      unused_90d: boolean;
      never_expires: boolean;
      ownerless: boolean;
    }
  >(
    `SELECT k.key_id, k.name, k.key_prefix, k.role, k.project_scope, k.expires_at,
            k.last_used_at, k.revoked, k.created_at, k.principal_id,
            p.display_name AS principal_name,
            floor(extract(epoch FROM (now() - k.created_at)) / 86400)::int::text AS age_days,
            CASE WHEN k.last_used_at IS NULL THEN NULL
                 ELSE floor(extract(epoch FROM (now() - k.last_used_at)) / 86400)::int::text
            END AS days_since_used,
            -- unused ≥90d: never used since a 90d-old creation, OR last used ≥90d ago.
            (CASE
               WHEN k.last_used_at IS NULL THEN k.created_at <= now() - ($1 || ' days')::interval
               ELSE k.last_used_at <= now() - ($1 || ' days')::interval
             END) AS unused_90d,
            (k.expires_at IS NULL) AS never_expires,
            (k.principal_id IS NULL) AS ownerless
       FROM api_keys k
       LEFT JOIN principals p ON p.principal_id = k.principal_id
      WHERE k.revoked = false
      ORDER BY k.created_at DESC`,
    [String(thresholdDays)],
  );

  const keys: ApiKeyReviewItem[] = (res.rows ?? []).map((r) => ({
    key_id: r.key_id,
    name: r.name,
    key_prefix: r.key_prefix,
    role: r.role,
    project_scope: r.project_scope,
    expires_at: r.expires_at,
    last_used_at: r.last_used_at,
    revoked: r.revoked,
    created_at: r.created_at,
    principal_id: r.principal_id,
    principal_name: r.principal_name,
    age_days: Number(r.age_days),
    days_since_used: r.days_since_used === null ? null : Number(r.days_since_used),
    unused_90d: r.unused_90d,
    never_expires: r.never_expires,
    ownerless: r.ownerless,
  }));

  const stats: AccessReviewStats = {
    total_active: keys.length,
    unused_90d: keys.filter((k) => k.unused_90d).length,
    never_expires: keys.filter((k) => k.never_expires).length,
    ownerless: keys.filter((k) => k.ownerless).length,
  };

  return { stats, keys };
}

/**
 * Rotate a key: mint a SUCCESSOR bound to the same principal / role / scope, and
 * set the OLD key to auto-expire after a bounded overlap window. During overlap
 * BOTH keys validate (zero-downtime rotation); after it the old key fails the
 * `expires_at > now()` filter in validateApiKey and only the successor remains.
 *
 * Atomicity [§4 acceptance / §6 S5 adversary]: the successor INSERT and the old
 * key's expiry UPDATE happen in ONE transaction. A failure leaves the old key
 * exactly as it was (still live) — never a half-rotation that silently expired
 * the only working credential.
 *
 * Name collision [api_keys_active_name_uniq]: the old key is NOT revoked during
 * overlap, so it still occupies its name in the partial-unique index. The
 * successor therefore gets a distinct, deterministic name (`<old> (rotated …)`).
 *
 * @param keyId       the key to rotate (must be active / non-revoked).
 * @param opts.overlapMs  how long the old key stays valid. 0 = revoke the old key
 *                        immediately (no overlap). Capped at MAX_ROTATION_OVERLAP_MS.
 */
export async function rotateApiKey(
  keyId: string,
  opts: { overlapMs?: number } = {},
): Promise<{ key: string; entry: ApiKeyEntry; previous_key_id: string; old_expires_at: string | null }> {
  if (!isUuid(keyId)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid key id "${keyId}" (must be a UUID).`);
  }
  const requested = opts.overlapMs ?? DEFAULT_ROTATION_OVERLAP_MS;
  if (!Number.isFinite(requested) || requested < 0) {
    throw new ContextHubError('BAD_REQUEST', 'overlapMs must be a non-negative number of milliseconds.');
  }
  const overlapMs = Math.min(requested, MAX_ROTATION_OVERLAP_MS);

  const successorKey = generateKey();
  const keyHash = hashKey(successorKey);
  const keyPrefix = successorKey.slice(0, 12) + '...' + successorKey.slice(-4);

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the row we are rotating so two concurrent rotations of the same key
    // can't each mint a successor against a stale view.
    const oldRes = await client.query<{
      name: string;
      role: string;
      project_scope: string | null;
      principal_id: string | null;
      created_by: string | null;
      is_bootstrap: boolean;
      revoked: boolean;
    }>(
      `SELECT name, role, project_scope, principal_id, created_by, is_bootstrap, revoked
         FROM api_keys WHERE key_id = $1 FOR UPDATE`,
      [keyId],
    );
    const old = oldRes.rows[0];
    if (!old) {
      throw new ContextHubError('NOT_FOUND', 'API key not found.');
    }
    if (old.revoked) {
      throw new ContextHubError('CONFLICT', 'Cannot rotate a revoked key; mint a fresh key instead.');
    }
    // Never rotate the bootstrap root credential through this general path — root
    // rotation is the out-of-band createBootstrapRootKey path only (escalation guard).
    if (old.is_bootstrap) {
      throw new ContextHubError('FORBIDDEN', 'The bootstrap root credential is rotated out-of-band, not via this path.');
    }

    // Successor name must be distinct from the old (still-active) name to satisfy
    // api_keys_active_name_uniq during the overlap. Deterministic + collision-safe.
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    let successorName = `${old.name} (rotated ${stamp})`;
    if (successorName.length > 128) {
      // Keep within the createApiKey 128-char limit; preserve the rotation suffix.
      const suffix = ` (rotated ${stamp})`;
      successorName = old.name.slice(0, 128 - suffix.length) + suffix;
    }

    const insRes = await client.query<ApiKeyEntry>(
      `INSERT INTO api_keys (name, key_prefix, key_hash, role, project_scope, expires_at, created_by, principal_id)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
       RETURNING key_id, name, key_prefix, role, project_scope, expires_at, last_used_at, revoked, created_at, principal_id`,
      [successorName, keyPrefix, keyHash, old.role, old.project_scope, old.created_by, old.principal_id],
    );

    // Old key: expire after the overlap (or revoke immediately when overlap = 0).
    let oldExpiresAt: string | null = null;
    if (overlapMs === 0) {
      await client.query(`UPDATE api_keys SET revoked = true WHERE key_id = $1`, [keyId]);
    } else {
      const expRes = await client.query<{ expires_at: string }>(
        `UPDATE api_keys SET expires_at = now() + ($2 || ' milliseconds')::interval
          WHERE key_id = $1
          RETURNING expires_at`,
        [keyId, String(overlapMs)],
      );
      oldExpiresAt = expRes.rows[0]?.expires_at ?? null;
    }

    await client.query('COMMIT');
    return { key: successorKey, entry: insRes.rows[0], previous_key_id: keyId, old_expires_at: oldExpiresAt };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      throw new ContextHubError('CONFLICT', 'A rotation of this key is already in progress; retry.');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mint an EPHEMERAL (short-TTL) credential. NHI best-practice: prefer a key that
 * auto-expires over a durable one. Binds to a principal (or stays ownerless for a
 * dev/CI key) and rides createApiKey's full bind-time validation — the only
 * difference is a mandatory, bounded `expires_at`.
 *
 * @param params.ttlMs  lifetime in ms. Defaults to DEFAULT_EPHEMERAL_TTL_MS,
 *                       capped at MAX_EPHEMERAL_TTL_MS, must be > 0.
 */
export async function createEphemeralApiKey(params: {
  name: string;
  role?: string;
  project_scope?: string;
  principal_id?: string;
  created_by?: string;
  ttlMs?: number;
}): Promise<{ key: string; entry: ApiKeyEntry; expires_at: string }> {
  const requested = params.ttlMs ?? DEFAULT_EPHEMERAL_TTL_MS;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new ContextHubError('BAD_REQUEST', 'ttlMs must be a positive number of milliseconds.');
  }
  const ttlMs = Math.min(requested, MAX_EPHEMERAL_TTL_MS);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const result = await createApiKey({
    name: params.name,
    role: params.role,
    project_scope: params.project_scope,
    principal_id: params.principal_id,
    created_by: params.created_by,
    expires_at: expiresAt,
  });
  // createApiKey stamps expires_at from our input; surface the effective value.
  return { key: result.key, entry: result.entry, expires_at: result.entry.expires_at ?? expiresAt };
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
