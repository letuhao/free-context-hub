import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getDbPool } from '../../db/client.js';

/**
 * Phase 15 Sprint 15.12 — tenant-scope enforcement for coordination resources
 * (DEFERRED-009). A DB-lookup variant of `requireScope`: where `requireScope`
 * compares `apiKeyScope` to a URL param that is ITSELF a project_id,
 * `requireResourceScope` resolves the owning `project_id` from the resource id
 * (topic/request/motion/dispute/intake/body/task/artifact) and compares.
 *
 * Fallback semantics mirror requireScope / requireRole:
 *   - apiKeyScope === undefined (auth-off / env-var token) → unrestricted → next()
 *   - apiKeyScope === null      (global-scope key)        → unrestricted → next()
 *   - apiKeyScope === '<project>' → must match the resource's project_id, else 404.
 *
 * Cross-tenant AND unknown both → 404 NOT_FOUND (Q2): a scoped caller must not be
 * able to distinguish a resource in another project from a non-existent one
 * (no cross-tenant existence disclosure / id-probing oracle).
 */

export type ScopeEntity =
  | 'topic' | 'request' | 'motion' | 'dispute' | 'intake' | 'body' | 'task' | 'artifact'
  // Sprint DEFERRED-004 — writer-surface resources keyed by a global PK.
  | 'document' | 'learning_path' | 'conversation';

const RESOLVERS: Record<ScopeEntity, string> = {
  topic:    `SELECT project_id FROM topics WHERE topic_id = $1`,
  request:  `SELECT t.project_id FROM requests r JOIN topics t ON t.topic_id = r.topic_id WHERE r.request_id = $1`,
  motion:   `SELECT t.project_id FROM motions m JOIN topics t ON t.topic_id = m.topic_id WHERE m.motion_id = $1`,
  dispute:  `SELECT t.project_id FROM disputes d JOIN topics t ON t.topic_id = d.topic_id WHERE d.dispute_id = $1`,
  intake:   `SELECT project_id FROM intake_items WHERE intake_id = $1`,
  body:     `SELECT project_id FROM decision_bodies WHERE body_id = $1`,
  task:     `SELECT t.project_id FROM tasks tk JOIN topics t ON t.topic_id = tk.topic_id WHERE tk.task_id = $1`,
  artifact: `SELECT t.project_id FROM artifacts a JOIN tasks tk ON tk.task_id = a.task_id JOIN topics t ON t.topic_id = tk.topic_id WHERE a.artifact_id = $1`,
  // DEFERRED-004 — derive the owning project from the resource id (never trust a
  // caller-declared project_id, which a cross-tenant id would bypass).
  document:      `SELECT project_id FROM documents WHERE doc_id = $1`,
  learning_path: `SELECT project_id FROM learning_paths WHERE path_id = $1`,
  conversation:  `SELECT project_id FROM chat_conversations WHERE conversation_id = $1`,
};

function notFound(res: Response, entity: ScopeEntity) {
  res.status(404).json({ status: 'error', error: `${entity} not found`, code: 'NOT_FOUND' });
}

/**
 * DEFERRED-004 — tenant-scope for COLLECTION routes (no project-owned `:id`): the
 * project comes from `req.body.project_id` and/or `req.query.project_id` (or the
 * multi `project_ids[]`). Strict-reject (CLARIFY Q1/Q2): a scoped key MUST declare a
 * project equal to its scope.
 *   - absent          → 400 BAD_REQUEST `project_scope_required`
 *   - present, ≠ scope → 404 NOT_FOUND (no cross-tenant existence oracle)
 *   - multi: any id ≠ scope → 404; absent → 400
 * auth-off (undefined) / global (null) → unrestricted.
 *
 * NOTE: use this ONLY for routes WITHOUT a project-owned resource `:id`. Resource
 * routes must use `requireResourceScope` (derive from the id) — a declared project_id
 * is bypassable by a cross-tenant resource id (REVIEW-DESIGN F1).
 */
export type ProjectSource = 'body' | 'query' | 'query-or-body';

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function requireProjectScope(source: ProjectSource, opts: { multi?: boolean } = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const scope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    if (scope === undefined || scope === null) return next();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;
    const reject400 = () => res.status(400).json({ status: 'error', code: 'BAD_REQUEST', error: 'project_scope_required: a scoped key must declare project_id' });
    const notFound404 = () => res.status(404).json({ status: 'error', code: 'NOT_FOUND', error: 'project not found' });

    if (opts.multi) {
      const raw = query.project_ids;
      if (raw !== undefined) {
        const ids = Array.isArray(raw)
          ? raw.map(String).filter(Boolean)
          : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) { reject400(); return; }
        for (const id of ids) if (id !== scope) { notFound404(); return; }
        next();
        return;
      }
      // no project_ids → fall through to single project_id
    }

    let declared: string | undefined;
    if (source === 'body') declared = strOrUndef(body.project_id);
    else if (source === 'query') declared = strOrUndef(query.project_id);
    else declared = strOrUndef(query.project_id) ?? strOrUndef(body.project_id);

    if (declared === undefined) { reject400(); return; }
    if (declared !== scope) { notFound404(); return; }
    next();
  };
}

export function requireResourceScope(entity: ScopeEntity, paramName = 'id'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const attachedScope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    if (attachedScope === undefined) return next(); // auth-off / env-var token
    if (attachedScope === null) return next();       // global scope

    const idVal = (req.params as Record<string, string>)[paramName];
    if (!idVal) {
      res.status(400).json({ status: 'error', error: `requireResourceScope: missing :${paramName} param`, code: 'BAD_REQUEST' });
      return;
    }
    try {
      const r = await getDbPool().query<{ project_id: string }>(RESOLVERS[entity], [idVal]);
      if (r.rowCount === 0 || r.rows[0].project_id !== attachedScope) {
        notFound(res, entity);
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Tenant-scope for creation routes where the project_id is in the request BODY
 * (createBody, submitIntake) rather than a URL param.
 *
 * rev 2 (REVIEW-DESIGN F1) — a scoped key that OMITS the body project_id must NOT
 * fall through to DEFAULT_PROJECT_ID at the service (that would escape its scope).
 * Inject the key's own scope on omission; reject an explicit cross-project value.
 */
export function requireBodyProjectScope(bodyField = 'project_id'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const scope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    if (scope === undefined || scope === null) return next(); // auth-off / global
    const body = (req.body ?? {}) as Record<string, unknown>;
    const declared = body[bodyField];
    if (declared === undefined) {
      // a scoped key's resource defaults to ITS OWN project, never DEFAULT_PROJECT_ID
      (req as { body?: unknown }).body = { ...body, [bodyField]: scope };
      return next();
    }
    if (declared !== scope) {
      res.status(404).json({ status: 'error', error: 'project not found', code: 'NOT_FOUND' });
      return;
    }
    next();
  };
}

/**
 * Tenant-scope for creation routes that reference a TOPIC by id in the body
 * (openDispute — `body.topic_id`). Resolves the topic's project_id and compares
 * to the caller's scope. A cross-tenant or unknown topic_id → 404. When the body
 * omits topic_id, defers to the handler's own validation (next()).
 */
export function requireBodyTopicScope(bodyField = 'topic_id'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const scope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    if (scope === undefined || scope === null) return next(); // auth-off / global
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topicId = body[bodyField];
    if (typeof topicId !== 'string' || !topicId) return next(); // handler validates absence
    try {
      const r = await getDbPool().query<{ project_id: string }>(
        `SELECT project_id FROM topics WHERE topic_id = $1`, [topicId],
      );
      if (r.rowCount === 0 || r.rows[0].project_id !== scope) {
        res.status(404).json({ status: 'error', error: 'topic not found', code: 'NOT_FOUND' });
        return;
      }
      next();
    } catch (e) { next(e); }
  };
}
