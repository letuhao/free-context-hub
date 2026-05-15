/**
 * Auth helpers for E2E tests.
 * Create/revoke API keys with specific roles for permission testing.
 */

import { makeApiClient, expectStatus } from './apiClient.js';
import { API_BASE, ADMIN_TOKEN } from './constants.js';

export type TestApiKey = {
  key: string;      // full plaintext key (only returned on create)
  key_id: string;   // UUID for revocation
  role: string;
  project_scope?: string | null;
};

const adminClient = makeApiClient(API_BASE, ADMIN_TOKEN);

/**
 * Create a test API key with the given role.
 * Phase 13 Sprint 13.7: project_scope optional for cross-tenant tests.
 * Requires admin token to call /api/api-keys.
 */
export async function createTestApiKey(
  role: 'reader' | 'writer' | 'admin',
  options: { name?: string; project_scope?: string | null } = {},
): Promise<TestApiKey> {
  const body: Record<string, unknown> = {
    name: options.name ?? `e2e-${role}-${Date.now()}`,
    role,
  };
  if (options.project_scope !== undefined) {
    body.project_scope = options.project_scope;
  }
  const res = await adminClient.post('/api/api-keys', body);
  expectStatus(res, 201, `createTestApiKey(${role}${options.project_scope ? `, scope=${options.project_scope}` : ''})`);
  return {
    key: res.body.key,
    key_id: res.body.key_id,
    role,
    project_scope: options.project_scope ?? null,
  };
}

/** Revoke a list of API keys (best-effort, does not throw). */
export async function revokeTestKeys(keyIds: string[]): Promise<void> {
  for (const id of keyIds) {
    try {
      await adminClient.delete(`/api/api-keys/${encodeURIComponent(id)}`);
    } catch {
      // Best-effort cleanup
    }
  }
}
