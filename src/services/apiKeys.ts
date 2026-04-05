import { randomBytes, createHash } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

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
    `SELECT key_id, name, key_prefix, role, project_scope, expires_at, last_used_at, revoked, created_at
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

  const key = generateKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 12) + '...' + key.slice(-4);

  const res = await pool.query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, role, project_scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      params.name.trim(),
      keyPrefix,
      keyHash,
      role,
      params.project_scope ?? null,
      params.expires_at ?? null,
    ],
  );

  return { key, entry: res.rows[0] };
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

/** Validate a bearer token against api_keys table. Returns the key entry if valid. */
export async function validateApiKey(token: string): Promise<ApiKeyEntry | null> {
  const pool = getDbPool();
  const tokenHash = hashKey(token);

  const res = await pool.query(
    `SELECT key_id, name, key_prefix, role, project_scope, expires_at, last_used_at, revoked, created_at
     FROM api_keys
     WHERE key_hash = $1 AND revoked = false
       AND (expires_at IS NULL OR expires_at > now())`,
    [tokenHash],
  );

  if (!res.rows?.[0]) return null;

  // Update last_used_at (fire-and-forget)
  pool.query(`UPDATE api_keys SET last_used_at = now() WHERE key_id = $1`, [res.rows[0].key_id]).catch(() => {});

  return res.rows[0];
}
