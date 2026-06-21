/**
 * [DEFERRED-060] MCP HTTP header → workspace_token bridge.
 *
 * The /mcp tools read their credential from a per-call `workspace_token` argument. To let a standard
 * MCP HTTP client authenticate with an `Authorization: Bearer <token>` header instead of threading the
 * token through every tool's arguments, the POST /mcp handler calls injectBearerWorkspaceToken() to
 * copy the header token onto tools/call requests that omit it.
 *
 * SECURITY: this only SOURCES the token. It is still fully validated by resolveMcpCaller downstream
 * (api_keys lookup + principal/expiry gates) and grants nothing on its own. An explicit
 * `workspace_token` in the call arguments ALWAYS wins — we never overwrite a caller-supplied value,
 * so a client cannot have its asserted token silently replaced by a header.
 */

/** Extract a bearer token from an Authorization header (case/array tolerant). Undefined if absent. */
export function bearerFromAuthHeader(req: { headers?: Record<string, unknown> }): string | undefined {
  const h = req.headers?.authorization ?? req.headers?.Authorization;
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v === 'string' && v.startsWith('Bearer ')) {
    const t = v.slice(7).trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

/**
 * Inject the bearer token as `workspace_token` on tools/call requests that omit it. Mutates req.body
 * (a single JSON-RPC message or a batch array) in place. No-op when there is no bearer header, for
 * non-tools/call messages, and whenever an explicit `workspace_token` is already present.
 */
export function injectBearerWorkspaceToken(req: { headers?: Record<string, unknown>; body?: unknown }): void {
  const token = bearerFromAuthHeader(req);
  if (!token) return;
  const apply = (msg: unknown): void => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { method?: unknown; params?: { arguments?: Record<string, unknown> } };
    if (m.method !== 'tools/call' || !m.params || typeof m.params !== 'object') return;
    const args = (m.params.arguments ??= {});
    if (args && typeof args === 'object' && args.workspace_token === undefined) {
      args.workspace_token = token;
    }
  };
  if (Array.isArray(req.body)) req.body.forEach(apply);
  else apply(req.body);
}
