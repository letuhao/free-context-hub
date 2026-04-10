/**
 * Per-project feature toggles.
 *
 * Each project stores feature flags in `settings.features` (JSONB).
 * This service reads them with a short TTL cache so services can gate
 * behaviour without hitting the DB on every request.
 *
 * Precedence: project toggle → env var fallback → false.
 */

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

export type FeatureKey = 'git_ingest' | 'knowledge_graph' | 'distillation' | 'auto_review';

/** Maps project feature keys to the env var that serves as the global fallback. */
const ENV_FALLBACKS: Record<FeatureKey, string> = {
  git_ingest: 'GIT_INGEST_ENABLED',
  knowledge_graph: 'KG_ENABLED',
  distillation: 'DISTILLATION_MODEL',   // truthy when a model is configured
  auto_review: '',                       // no env fallback — off unless project enables it
};

// ── Simple in-memory cache (projectId → features map + expiry) ───────────

type CacheEntry = { features: Record<string, boolean>; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached(projectId: string): Record<string, boolean> | null {
  const entry = cache.get(projectId);
  if (entry && Date.now() < entry.expiresAt) return entry.features;
  if (entry) cache.delete(projectId);
  return null;
}

function setCache(projectId: string, features: Record<string, boolean>) {
  cache.set(projectId, { features, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Clear the feature cache for a project (call after settings update). */
export function invalidateFeatureCache(projectId: string) {
  cache.delete(projectId);
}

// ── Core API ─────────────────────────────────────────────────────────────

/**
 * Check whether a feature is enabled for a given project.
 *
 * Resolution order:
 *   1. Project `settings.features.<key>` (explicit true/false)
 *   2. Env var fallback (KG_ENABLED, GIT_INGEST_ENABLED, etc.)
 *   3. false
 */
export async function isFeatureEnabled(projectId: string, feature: FeatureKey): Promise<boolean> {
  // 1. Check project-level toggle
  let features = getCached(projectId);
  if (!features) {
    features = await fetchProjectFeatures(projectId);
    setCache(projectId, features);
  }

  const projectValue = features[feature];
  if (typeof projectValue === 'boolean') return projectValue;

  // 2. Env var fallback
  return envFallback(feature);
}

/**
 * Synchronous env-var-only check.  Useful when no projectId is available
 * (e.g. server-level gating that predates project context).
 */
export function isFeatureEnabledGlobal(feature: FeatureKey): boolean {
  return envFallback(feature);
}

// ── Internal ─────────────────────────────────────────────────────────────

async function fetchProjectFeatures(projectId: string): Promise<Record<string, boolean>> {
  try {
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT settings->'features' AS features FROM projects WHERE project_id = $1`,
      [projectId],
    );
    const raw = res.rows?.[0]?.features;
    if (raw && typeof raw === 'object') return raw as Record<string, boolean>;
  } catch {
    // DB error — fall through to env defaults
  }
  return {};
}

function envFallback(feature: FeatureKey): boolean {
  const envKey = ENV_FALLBACKS[feature];
  if (!envKey) return false;

  const env = getEnv() as Record<string, unknown>;
  const val = env[envKey];

  // Boolean env vars (KG_ENABLED, GIT_INGEST_ENABLED)
  if (typeof val === 'boolean') return val;

  // String env vars (DISTILLATION_MODEL) — truthy when non-empty
  if (typeof val === 'string') return val.trim().length > 0;

  return false;
}
