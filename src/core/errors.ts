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
      // Phase 15 Sprint 15.5: intake + dispute extended codes
      | 'TOPIC_NOT_ACTIVE'
      | 'ALREADY_RESOLVED'
      | 'RESOLUTION_PENDING'
      | 'INTAKE_ALREADY_TRIAGED'
      | 'INTAKE_ALREADY_DISMISSED',
    message: string,
  ) {
    super(message);
    this.name = 'ContextHubError';
  }
}
