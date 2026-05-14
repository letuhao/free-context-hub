/**
 * Phase 13 Sprint 13.1 — Artifact Ownership / Leasing service.
 *
 * Design ref: docs/specs/2026-05-15-phase-13-sprint-13.1-design.md (v2.1)
 * Spec hash:  f14ede2370dcfec5
 *
 * Concept: agents claim time-bounded leases on named artifacts to signal
 * intent and avoid duplicate work. Optimistic — DB doesn't block writes,
 * but the partial unique index surfaces conflicts cleanly.
 */

import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('artifact-leases');

const MAX_ACTIVE_LEASES_PER_AGENT = 10;
const MAX_TTL_MINUTES = 240;
const DEFAULT_TTL_MINUTES = 30;
const MIN_EXTEND_MINUTES = 1;
const MAX_EXTEND_MINUTES = 120;
const PG_UNIQUE_VIOLATION_CODE = '23505';
const MAX_INTERNAL_RACE_RETRIES = 1;

// post-audit R1: attempt-rate limit per phase-13-design.md L228
// In-process sliding window. Known limitation: multi-replica deployment
// loses shared state — DEFERRED to DB/Redis-backed implementation if
// horizontal scaling is needed (track in DEFERRED.md when relevant).
const MAX_CLAIM_ATTEMPTS_PER_MINUTE = 20;
const ATTEMPT_WINDOW_MS = 60_000;
const attemptLog = new Map<string, number[]>();

function recordAndCheckAttemptRate(projectId: string, agentId: string): { allowed: boolean; retry_after_seconds: number } {
  const key = `${projectId}\x00${agentId}`;
  const now = Date.now();
  const cutoff = now - ATTEMPT_WINDOW_MS;
  const recent = (attemptLog.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_CLAIM_ATTEMPTS_PER_MINUTE) {
    // Don't record this attempt (caller already rate-limited)
    attemptLog.set(key, recent);
    // retry_after = when oldest entry in window will exit
    const oldest = recent[0];
    const retryAfterMs = Math.max(0, oldest + ATTEMPT_WINDOW_MS - now);
    return { allowed: false, retry_after_seconds: Math.ceil(retryAfterMs / 1000) };
  }
  recent.push(now);
  attemptLog.set(key, recent);
  // Opportunistic cleanup: if Map grows large, prune empty/stale keys
  if (attemptLog.size > 10_000) pruneAttemptLog(cutoff);
  return { allowed: true, retry_after_seconds: 0 };
}

function pruneAttemptLog(cutoff: number) {
  for (const [k, v] of attemptLog.entries()) {
    const fresh = v.filter((t) => t > cutoff);
    if (fresh.length === 0) attemptLog.delete(k);
    else attemptLog.set(k, fresh);
  }
}

// Test-only hook: reset the in-memory rate limiter state between tests.
export function _resetAttemptLogForTest(): void {
  attemptLog.clear();
}

// artifact_id convention: lowercase kebab-case with optional /-separated sub-segments.
// First segment must start with [a-z0-9]; sub-segments may use [a-z0-9_-].
// See docs/artifact-id-convention.md
const ARTIFACT_ID_REGEX = /^[a-z0-9][a-z0-9\-_]*(?:\/[a-z0-9][a-z0-9\-_]*)*$/;

// v2-r1 fix (WARN 3): closed enum prevents silent namespace partitioning
// from typos/casing. If new types are needed, add to this set explicitly.
const VALID_ARTIFACT_TYPES = new Set(['lesson', 'document', 'report-section', 'custom']);

export type ClaimParams = {
  project_id: string;
  agent_id: string;
  artifact_type: string;
  artifact_id: string;
  task_description: string;
  ttl_minutes?: number;
};

export type ClaimResult =
  | { status: 'claimed'; lease_id: string; expires_at: string }
  | { status: 'conflict'; incumbent_agent_id: string; incumbent_task: string; expires_at: string; seconds_remaining: number }
  | { status: 'rate_limited'; reason: 'max_active_leases' | 'race_exhausted' | 'attempt_rate'; retry_after_seconds: number };

export type ReleaseResult = { status: 'released' | 'not_found' | 'not_owner' };

export type RenewResult =
  | { status: 'renewed'; expires_at: string; effective_extension_minutes: number }
  | { status: 'cap_reached'; expires_at: string; effective_extension_minutes: number }
  | { status: 'not_found' | 'not_owner' | 'expired' };

export type LeaseSummary = {
  lease_id: string;
  artifact_type: string;
  artifact_id: string;
  agent_id: string;
  task_description: string;
  expires_at: string;
  seconds_remaining: number;
};

export type ListResult = { claims: LeaseSummary[] };

export type AvailabilityResult =
  | { available: true }
  | { available: false; lease: Omit<LeaseSummary, 'lease_id'> };

export async function claimArtifact(p: ClaimParams): Promise<ClaimResult> {
  validateClaimInput(p);
  // post-audit R1: attempt-rate limit (20/min per agent per project)
  // Per phase-13-design.md L228. In-process; multi-replica is a known
  // limitation (see DEFERRED.md when relevant).
  const attemptCheck = recordAndCheckAttemptRate(p.project_id, p.agent_id);
  if (!attemptCheck.allowed) {
    return {
      status: 'rate_limited',
      reason: 'attempt_rate',
      retry_after_seconds: attemptCheck.retry_after_seconds,
    };
  }
  for (let attempt = 0; attempt <= MAX_INTERNAL_RACE_RETRIES; attempt++) {
    const result = await _claimArtifactOnce(p);
    if (!('__retry' in result)) return result;
    await new Promise((r) => setImmediate(r));
  }
  // Retry exhausted — surface as race_exhausted (distinct from genuine rate limit).
  return { status: 'rate_limited', reason: 'race_exhausted', retry_after_seconds: 1 };
}

async function _claimArtifactOnce(p: ClaimParams): Promise<ClaimResult | { __retry: true }> {
  const ttl = clampTtl(p.ttl_minutes);
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: lazy cleanup of expired leases for THIS artifact
    await client.query(
      `DELETE FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $2 AND artifact_id = $3
         AND expires_at <= now()`,
      [p.project_id, p.artifact_type, p.artifact_id],
    );

    // Step 2: rate limit check (per-agent per-project active leases)
    const rateLimit = await client.query<{ active_count: number }>(
      `SELECT COUNT(*)::int AS active_count
       FROM artifact_leases
       WHERE project_id = $1 AND agent_id = $2 AND expires_at > now()`,
      [p.project_id, p.agent_id],
    );
    const activeCount = rateLimit.rows[0]?.active_count ?? 0;
    if (activeCount >= MAX_ACTIVE_LEASES_PER_AGENT) {
      await client.query('ROLLBACK');
      return { status: 'rate_limited', reason: 'max_active_leases', retry_after_seconds: 60 };
    }

    // Step 3: check for existing active lease on this artifact
    const existing = await client.query<{
      agent_id: string; task_description: string; expires_at: Date;
    }>(
      `SELECT agent_id, task_description, expires_at
       FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $2 AND artifact_id = $3
         AND expires_at > now()
       LIMIT 1`,
      [p.project_id, p.artifact_type, p.artifact_id],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      const row = existing.rows[0];
      return {
        status: 'conflict',
        incumbent_agent_id: row.agent_id,
        incumbent_task: row.task_description,
        expires_at: row.expires_at.toISOString(),
        seconds_remaining: Math.max(0, Math.floor((row.expires_at.getTime() - Date.now()) / 1000)),
      };
    }

    // Step 4: INSERT lease (partial unique index is the race-condition guard)
    const leaseId = randomUUID();
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    try {
      await client.query(
        `INSERT INTO artifact_leases
           (lease_id, project_id, agent_id, artifact_type, artifact_id,
            task_description, ttl_minutes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [leaseId, p.project_id, p.agent_id, p.artifact_type, p.artifact_id,
         p.task_description, ttl, expiresAt],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === PG_UNIQUE_VIOLATION_CODE) {
        await client.query('ROLLBACK');
        return await fetchConflictResultOrRetry(p);
      }
      throw err;
    }

    await client.query('COMMIT');
    return { status: 'claimed', lease_id: leaseId, expires_at: expiresAt.toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err), params: p }, 'claimArtifact failed');
    throw err;
  } finally {
    client.release();
  }
}

async function fetchConflictResultOrRetry(p: ClaimParams): Promise<ClaimResult | { __retry: true }> {
  const pool = getDbPool();
  const r = await pool.query<{ agent_id: string; task_description: string; expires_at: Date }>(
    `SELECT agent_id, task_description, expires_at
     FROM artifact_leases
     WHERE project_id = $1 AND artifact_type = $2 AND artifact_id = $3
       AND expires_at > now()
     LIMIT 1`,
    [p.project_id, p.artifact_type, p.artifact_id],
  );
  if (r.rows.length === 0) {
    // Race winner expired between their INSERT and our re-SELECT — artifact is
    // genuinely available. Signal retry to the outer loop.
    return { __retry: true };
  }
  const row = r.rows[0];
  return {
    status: 'conflict',
    incumbent_agent_id: row.agent_id,
    incumbent_task: row.task_description,
    expires_at: row.expires_at.toISOString(),
    seconds_remaining: Math.max(0, Math.floor((row.expires_at.getTime() - Date.now()) / 1000)),
  };
}

export async function releaseArtifact(params: { project_id: string; agent_id: string; lease_id: string }): Promise<ReleaseResult> {
  const pool = getDbPool();
  const r = await pool.query<{ agent_id: string }>(
    `SELECT agent_id FROM artifact_leases WHERE lease_id = $1 AND project_id = $2`,
    [params.lease_id, params.project_id],
  );
  if (r.rows.length === 0) return { status: 'not_found' };
  if (r.rows[0].agent_id !== params.agent_id) return { status: 'not_owner' };
  await pool.query(`DELETE FROM artifact_leases WHERE lease_id = $1`, [params.lease_id]);
  return { status: 'released' };
}

export async function renewArtifact(params: {
  project_id: string; agent_id: string; lease_id: string; extend_by_minutes: number;
}): Promise<RenewResult> {
  if (params.extend_by_minutes < MIN_EXTEND_MINUTES || params.extend_by_minutes > MAX_EXTEND_MINUTES) {
    throw new Error(`extend_by_minutes must be ${MIN_EXTEND_MINUTES}-${MAX_EXTEND_MINUTES}`);
  }
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ agent_id: string; expires_at: Date }>(
      `SELECT agent_id, expires_at
       FROM artifact_leases
       WHERE lease_id = $1 AND project_id = $2
       FOR UPDATE`,
      [params.lease_id, params.project_id],
    );
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'not_found' }; }
    const row = r.rows[0];
    if (row.agent_id !== params.agent_id) { await client.query('ROLLBACK'); return { status: 'not_owner' }; }
    if (row.expires_at.getTime() <= Date.now()) { await client.query('ROLLBACK'); return { status: 'expired' }; }

    const nowMs = Date.now();
    const cappedMaxMs = nowMs + MAX_TTL_MINUTES * 60_000;
    const candidateMs = row.expires_at.getTime() + params.extend_by_minutes * 60_000;
    const newExpiresMs = Math.min(candidateMs, cappedMaxMs);
    const newExpiresAt = new Date(newExpiresMs);
    const effectiveExtensionMinutes = Math.max(0, Math.floor((newExpiresMs - row.expires_at.getTime()) / 60_000));
    const capWasBinding = cappedMaxMs < candidateMs;

    await client.query(
      `UPDATE artifact_leases SET expires_at = $1 WHERE lease_id = $2`,
      [newExpiresAt, params.lease_id],
    );
    await client.query('COMMIT');
    if (capWasBinding) {
      return { status: 'cap_reached', expires_at: newExpiresAt.toISOString(), effective_extension_minutes: effectiveExtensionMinutes };
    }
    return { status: 'renewed', expires_at: newExpiresAt.toISOString(), effective_extension_minutes: effectiveExtensionMinutes };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err), params }, 'renewArtifact failed');
    throw err;
  } finally {
    client.release();
  }
}

export async function listActiveClaims(params: { project_id: string; artifact_type?: string }): Promise<ListResult> {
  // v2-r2 WARN 1: validate filter type if provided (symmetric with claimArtifact)
  if (params.artifact_type !== undefined && !VALID_ARTIFACT_TYPES.has(params.artifact_type)) {
    throw new Error(`artifact_type must be one of: ${Array.from(VALID_ARTIFACT_TYPES).join(', ')}; got: ${params.artifact_type}`);
  }
  const pool = getDbPool();
  const whereParts = [`project_id = $1`, `expires_at > now()`];
  const args: unknown[] = [params.project_id];
  if (params.artifact_type) {
    whereParts.push(`artifact_type = $${args.length + 1}`);
    args.push(params.artifact_type);
  }
  const r = await pool.query<{
    lease_id: string; artifact_type: string; artifact_id: string;
    agent_id: string; task_description: string; expires_at: Date;
  }>(
    `SELECT lease_id, artifact_type, artifact_id, agent_id, task_description, expires_at
     FROM artifact_leases
     WHERE ${whereParts.join(' AND ')}
     ORDER BY expires_at ASC`,
    args,
  );
  const now = Date.now();
  return {
    claims: r.rows.map((row) => ({
      lease_id: row.lease_id,
      artifact_type: row.artifact_type,
      artifact_id: row.artifact_id,
      agent_id: row.agent_id,
      task_description: row.task_description,
      expires_at: row.expires_at.toISOString(),
      seconds_remaining: Math.max(0, Math.floor((row.expires_at.getTime() - now) / 1000)),
    })),
  };
}

export async function checkArtifactAvailability(params: {
  project_id: string; artifact_type: string; artifact_id: string;
}): Promise<AvailabilityResult> {
  // v2-r2 WARN 1 + post-audit R7: validate type AND id-format symmetrically
  // with claimArtifact. Without R7 fix, a snapshot read with malformed id
  // returns {available:true} (false negative) — caller may think artifact
  // is free when actually their wrong-format id partitioned them from
  // existing leases.
  if (!VALID_ARTIFACT_TYPES.has(params.artifact_type)) {
    throw new Error(`artifact_type must be one of: ${Array.from(VALID_ARTIFACT_TYPES).join(', ')}; got: ${params.artifact_type}`);
  }
  if (!ARTIFACT_ID_REGEX.test(params.artifact_id)) {
    throw new Error(`artifact_id must be lowercase kebab-case (see docs/artifact-id-convention.md); got: ${params.artifact_id}`);
  }
  const pool = getDbPool();
  const r = await pool.query<{
    agent_id: string; task_description: string; expires_at: Date;
    artifact_type: string; artifact_id: string;
  }>(
    `SELECT agent_id, task_description, expires_at, artifact_type, artifact_id
     FROM artifact_leases
     WHERE project_id = $1 AND artifact_type = $2 AND artifact_id = $3
       AND expires_at > now()
     LIMIT 1`,
    [params.project_id, params.artifact_type, params.artifact_id],
  );
  if (r.rows.length === 0) return { available: true };
  const row = r.rows[0];
  return {
    available: false,
    lease: {
      artifact_type: row.artifact_type,
      artifact_id: row.artifact_id,
      agent_id: row.agent_id,
      task_description: row.task_description,
      expires_at: row.expires_at.toISOString(),
      seconds_remaining: Math.max(0, Math.floor((row.expires_at.getTime() - Date.now()) / 1000)),
    },
  };
}

/**
 * Admin force-release. Requires project_id for tenant isolation (v2 fix BLOCK 1).
 * Caller must be authenticated as admin role for the same project.
 */
export async function forceReleaseArtifact(params: { project_id: string; lease_id: string }): Promise<{ status: 'force_released' | 'not_found' }> {
  const pool = getDbPool();
  const r = await pool.query(
    `DELETE FROM artifact_leases WHERE lease_id = $1 AND project_id = $2`,
    [params.lease_id, params.project_id],
  );
  return { status: (r.rowCount ?? 0) > 0 ? 'force_released' : 'not_found' };
}

function validateClaimInput(p: ClaimParams) {
  if (!p.project_id || !p.agent_id || !p.artifact_type || !p.artifact_id || !p.task_description) {
    throw new Error('claim_artifact: project_id, agent_id, artifact_type, artifact_id, task_description are all required');
  }
  if (!VALID_ARTIFACT_TYPES.has(p.artifact_type)) {
    throw new Error(`artifact_type must be one of: ${Array.from(VALID_ARTIFACT_TYPES).join(', ')}; got: ${p.artifact_type}`);
  }
  if (!ARTIFACT_ID_REGEX.test(p.artifact_id)) {
    throw new Error(`artifact_id must be lowercase kebab-case (see docs/artifact-id-convention.md); got: ${p.artifact_id}`);
  }
}

function clampTtl(ttlMinutes?: number): number {
  if (ttlMinutes === undefined || ttlMinutes === null) return DEFAULT_TTL_MINUTES;
  if (ttlMinutes < 1) return 1;
  if (ttlMinutes > MAX_TTL_MINUTES) return MAX_TTL_MINUTES;
  return Math.floor(ttlMinutes);
}
