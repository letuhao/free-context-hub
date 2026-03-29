import { getEnv } from '../env.js';
import { ContextHubError } from './errors.js';

export function assertWorkspaceToken(token?: string) {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return;

  if (!token || token !== env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    throw new ContextHubError('UNAUTHORIZED', 'Unauthorized: invalid workspace_token');
  }
}

export function resolveProjectIdOrThrow(project_id?: string) {
  if (project_id && project_id.trim().length) return project_id;
  const env = getEnv();
  if (env.DEFAULT_PROJECT_ID && env.DEFAULT_PROJECT_ID.trim().length) return env.DEFAULT_PROJECT_ID;
  throw new ContextHubError('BAD_REQUEST', 'Bad Request: missing project_id and DEFAULT_PROJECT_ID is not set');
}
