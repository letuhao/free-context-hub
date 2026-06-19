/**
 * Protocol-agnostic error classes for core business logic.
 *
 * The MCP layer catches these and re-throws as McpError.
 * The REST API layer catches these and maps to HTTP status codes.
 */

export class ContextHubError extends Error {
  constructor(
    public readonly code:
      | 'UNAUTHORIZED'
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'INTERNAL'
      // Actor Data Boundary F1: single-root / unique-resource conflict (409-shaped)
      | 'CONFLICT'
      // Actor Data Boundary F1d: a tool was given an actor_id in its args that does not match the
      // authenticated principal (auth ON). The acting principal is derived from the credential,
      // never asserted — so a mismatch is rejected rather than honored.
      | 'ASSERTED_IDENTITY_REJECTED'
      // Actor Data Boundary F1d: the presented credential authenticated to a key row that is now
      // expired/revoked/rotated-out. Distinct from authz DENY — the agent must stop and re-auth
      // out-of-band, not retry-loop.
      | 'CREDENTIAL_EXPIRED'
      // DEFERRED-025: upstream dependency (e.g. embeddings model) unavailable → 503
      | 'SERVICE_UNAVAILABLE'
      // Phase 15 Sprint 15.5: intake + dispute extended codes
      | 'TOPIC_NOT_ACTIVE'
      | 'ALREADY_RESOLVED'
      | 'RESOLUTION_PENDING'
      | 'INTAKE_ALREADY_TRIAGED'
      | 'INTAKE_ALREADY_DISMISSED'
      // Phase 15 Sprint 15.6: closing drain + distinct-endorser
      | 'REPEAT_ENDORSER'
      // Phase 15 Sprint 15.7: chaining + topology enforcement
      | 'UNMET_DEPENDENCIES'
      | 'UPSTREAM_NOT_BASELINED'
      | 'CHAINED_TASK_DEPENDENCY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ContextHubError';
  }
}
