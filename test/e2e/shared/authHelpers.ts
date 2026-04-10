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
};

const adminClient = makeApiClient(API_BASE, ADMIN_TOKEN);

/**
 * Create a test API key with the given role.
 * Requires admin token to call /api/api-keys.
 */
export async function createTestApiKey(
  role: 'reader' | 'writer' | 'admin',
  name?: string,
): Promise<TestApiKey> {
  const res = await adminClient.post('/api/api-keys', {
    name: name ?? `e2e-${role}-${Date.now()}`,
    role,
  });
  expectStatus(res, 201, `createTestApiKey(${role})`);
  return {
    key: res.body.key,
    key_id: res.body.key_id,
    role,
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
