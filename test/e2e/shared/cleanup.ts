/**
 * Global cleanup registry for E2E tests.
 * Tracks resources created during tests and cleans them up in teardown.
 */

import { makeApiClient } from './apiClient.js';
import { API_BASE, ADMIN_TOKEN, E2E_PROJECT_ID } from './constants.js';
import { revokeTestKeys } from './authHelpers.js';

export class CleanupRegistry {
  lessonIds: string[] = [];
  documentIds: string[] = [];
  conversationIds: string[] = [];
  apiKeyIds: string[] = [];
  groupIds: string[] = [];
  lessonTypeKeys: string[] = [];
  projectIds: string[] = [];

  /** Run all cleanup operations. Best-effort — does not throw. */
  async runAll(projectId: string = E2E_PROJECT_ID): Promise<void> {
    const api = makeApiClient(API_BASE, ADMIN_TOKEN);

    // Archive lessons (no delete endpoint — archive is the cleanup)
    for (const id of this.lessonIds) {
      try {
        await api.patch(`/api/lessons/${encodeURIComponent(id)}/status`, {
          project_id: projectId,
          status: 'archived',
        });
      } catch { /* best-effort */ }
    }

    // Delete documents
    for (const id of this.documentIds) {
      try {
        await api.delete(`/api/documents/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`);
      } catch { /* best-effort */ }
    }

    // Delete conversations
    for (const id of this.conversationIds) {
      try {
        await api.delete(`/api/chat/conversations/${encodeURIComponent(id)}`);
      } catch { /* best-effort */ }
    }

    // Revoke API keys
    if (this.apiKeyIds.length) {
      await revokeTestKeys(this.apiKeyIds);
    }

    // Delete groups
    for (const id of this.groupIds) {
      try {
        await api.delete(`/api/groups/${encodeURIComponent(id)}`);
      } catch { /* best-effort */ }
    }

    // Delete custom lesson types
    for (const key of this.lessonTypeKeys) {
      try {
        await api.delete(`/api/lesson-types/${encodeURIComponent(key)}`);
      } catch { /* best-effort */ }
    }

    // Delete test projects (last, since other resources may reference them)
    for (const id of this.projectIds) {
      try {
        await api.delete(`/api/projects/${encodeURIComponent(id)}`);
      } catch { /* best-effort */ }
    }
  }
}
