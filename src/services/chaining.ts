/**
 * Phase 15 Sprint 15.7 — Primitive-outcome chaining (DEFERRED-019).
 *
 * Design ref: docs/specs/2026-05-20-phase-15-sprint-15.7-design.md
 *
 * On a positive resolution (`request.resolved` outcome='approved' /
 * `motion.tallied` outcome='carried'), the source primitive emits a chained
 * board task — UNLESS the topic is `closing`/`closed`, in which case the
 * chain emits a `task.deferred` event recording the would-be-task in the
 * sealed trail (master design §C.4).
 *
 * Submitters may pass an optional `execution_task` blob (Sprint 15.7 Q1) on
 * `submitRequest` / `proposeMotion`; the chain merges blob over derived defaults.
 *
 * Public API:
 *   - validateExecutionTask(blob): structural validation at submit time.
 *   - buildChainedTaskParams(args): pure helper that merges blob over defaults.
 *   - emitChain(client, args): transactional helper invoked inside the source-
 *     event txn. Locks topics FOR UPDATE, branches posted vs deferred, emits
 *     the right events, returns ChainResult.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ContextHubError } from '../core/errors.js';
import { appendEvent } from './coordinationEvents.js';

const SLOT_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPOLOGIES = new Set(['parallel', 'sequential', 'rolling']);

const MAX_TITLE_LEN = 512;
const MAX_SLOT_LEN = 64;
const MAX_KIND_LEN = 64;
const MAX_DEPENDS_ON = 32;
const MAX_RACI_BYTES = 8192;

export type Topology = 'parallel' | 'sequential' | 'rolling';

export type ExecutionTaskBlob = {
  title?: string;
  topology?: Topology;
  slot?: string;
  kind?: string;
  depends_on?: string[];
  raci?: Record<string, unknown>;
};

export type PostTaskParams = {
  topic_id: string;
  title: string;
  topology: Topology;
  slot: string;
  kind: string;
  depends_on: string[];
  raci: Record<string, unknown>;
  created_by: string;
};

export type ChainResult =
  | { kind: 'posted'; task_id: string; artifact_id: string }
  | { kind: 'deferred'; reason: 'topic_closing' | 'topic_closed'; deferred_event_id: string };

/**
 * Structural validation of the submitter execution_task blob. Throws
 * ContextHubError('BAD_REQUEST', ...) on shape violation. Returns the typed
 * blob on success, or null when input is null/undefined.
 *
 * Note: depends_on existence in the topic is checked at chain time, not here —
 * a submitter may legitimately reference a task that will be created later.
 */
export function validateExecutionTask(blob: unknown): ExecutionTaskBlob | null {
  if (blob === null || blob === undefined) return null;
  if (typeof blob !== 'object' || Array.isArray(blob)) {
    throw new ContextHubError('BAD_REQUEST', 'execution_task must be an object');
  }
  const b = blob as Record<string, unknown>;
  const out: ExecutionTaskBlob = {};

  if (b.title !== undefined) {
    if (typeof b.title !== 'string') {
      throw new ContextHubError('BAD_REQUEST', 'execution_task.title must be a string');
    }
    if (b.title.length > MAX_TITLE_LEN) {
      throw new ContextHubError('BAD_REQUEST', `execution_task.title must be at most ${MAX_TITLE_LEN} characters`);
    }
    out.title = b.title;
  }

  if (b.topology !== undefined) {
    if (typeof b.topology !== 'string' || !TOPOLOGIES.has(b.topology)) {
      throw new ContextHubError(
        'BAD_REQUEST',
        `execution_task.topology must be one of: ${Array.from(TOPOLOGIES).join(', ')}`,
      );
    }
    out.topology = b.topology as Topology;
  }

  if (b.slot !== undefined) {
    if (typeof b.slot !== 'string' || !SLOT_REGEX.test(b.slot)) {
      throw new ContextHubError(
        'BAD_REQUEST',
        'execution_task.slot must be a lowercase-kebab slug (^[a-z0-9][a-z0-9-]*$)',
      );
    }
    if (b.slot.length > MAX_SLOT_LEN) {
      throw new ContextHubError('BAD_REQUEST', `execution_task.slot must be at most ${MAX_SLOT_LEN} characters`);
    }
    out.slot = b.slot;
  }

  if (b.kind !== undefined) {
    if (typeof b.kind !== 'string' || b.kind.trim() === '') {
      throw new ContextHubError('BAD_REQUEST', 'execution_task.kind must be a non-empty string');
    }
    if (b.kind.length > MAX_KIND_LEN) {
      throw new ContextHubError('BAD_REQUEST', `execution_task.kind must be at most ${MAX_KIND_LEN} characters`);
    }
    out.kind = b.kind;
  }

  if (b.depends_on !== undefined) {
    if (!Array.isArray(b.depends_on)) {
      throw new ContextHubError('BAD_REQUEST', 'execution_task.depends_on must be an array');
    }
    if (b.depends_on.length > MAX_DEPENDS_ON) {
      throw new ContextHubError('BAD_REQUEST', `execution_task.depends_on must have at most ${MAX_DEPENDS_ON} entries`);
    }
    for (const dep of b.depends_on) {
      if (typeof dep !== 'string' || !UUID_REGEX.test(dep)) {
        throw new ContextHubError('BAD_REQUEST', 'execution_task.depends_on entries must be task UUIDs');
      }
    }
    out.depends_on = b.depends_on as string[];
  }

  if (b.raci !== undefined) {
    if (typeof b.raci !== 'object' || b.raci === null || Array.isArray(b.raci)) {
      throw new ContextHubError('BAD_REQUEST', 'execution_task.raci must be an object');
    }
    const raciJson = JSON.stringify(b.raci);
    if (raciJson.length > MAX_RACI_BYTES) {
      throw new ContextHubError('BAD_REQUEST', `execution_task.raci must be at most ${MAX_RACI_BYTES} bytes JSON`);
    }
    out.raci = b.raci as Record<string, unknown>;
  }

  return out;
}

/**
 * Pure helper — merge submitter blob over derived defaults to produce postTask
 * params. No DB access.
 */
export function buildChainedTaskParams(args: {
  source: 'request' | 'motion';
  source_id: string;
  topic_id: string;
  kind: string; // request.kind or motion.subject_type
  blob: ExecutionTaskBlob | null;
  acting_actor: string;
}): PostTaskParams {
  const blob = args.blob ?? {};
  const slotHex = args.source_id.replace(/-/g, '').slice(0, 16);
  const sourceLinkKey = args.source === 'request' ? 'source_request' : 'source_motion';
  const blobRaci = blob.raci ?? {};
  // Source-link key wins on conflict (system-set, not overridable).
  const mergedRaci: Record<string, unknown> = { ...blobRaci, [sourceLinkKey]: args.source_id };

  const defaultTitle =
    args.source === 'request'
      ? `Execute approved request: ${args.kind}`
      : `Execute carried motion: ${args.kind}`;

  return {
    topic_id: args.topic_id,
    title: blob.title ?? defaultTitle,
    topology: blob.topology ?? 'parallel',
    slot: blob.slot ?? `exec-${slotHex}`,
    kind: blob.kind ?? args.kind,
    depends_on: blob.depends_on ?? [],
    raci: mergedRaci,
    created_by: args.acting_actor,
  };
}

/**
 * Transactional chain emit — invoked inside the source-event transaction.
 *
 * Lock order extension: takes `topics FOR UPDATE` last in the canonical order
 * (request → request_step → artifact → topics, or motion → topics). Serializes
 * with closeTopic Phase 1 + Phase 3 so we observe a stable topic status.
 *
 * Branches:
 *   - topic.status='active' → inline-postTask logic + return {kind:'posted'}.
 *   - topic.status='closing' → emit task.deferred(reason='topic_closing'),
 *                              return {kind:'deferred'}.
 *   - topic.status='closed'  → appendEvent rejects on closed; the caller's
 *                              outer try/catch rolls back the whole txn and
 *                              returns topic_closed to its caller (rare race).
 *
 * Throws ContextHubError('CHAINED_TASK_DEPENDENCY_INVALID', ...) when an
 * execution_task blob's depends_on references a task not in this topic. The
 * caller is expected to let the throw roll back the source event (matches
 * CLARIFY AC10 — invalid_depends_on rolls back the resolution, no chain
 * deferred record is created in this case).
 */
export async function emitChain(
  client: PoolClient,
  args: {
    topic_id: string;
    source_event: { type: 'request.resolved' | 'motion.tallied'; source_id: string };
    actor_id: string;
    params: PostTaskParams;
  },
): Promise<ChainResult> {
  // 1) topics FOR UPDATE — serialize with closeTopic Phase 1/3.
  const topicRes = await client.query<{ status: string }>(
    `SELECT status FROM topics WHERE topic_id=$1 FOR UPDATE`,
    [args.topic_id],
  );
  if (topicRes.rowCount === 0) {
    // The source primitive already loaded the topic; absence here is a fatal
    // race we surface as a normal error (caller rolls back).
    throw new ContextHubError('NOT_FOUND', `topic ${args.topic_id} not found`);
  }
  const status = topicRes.rows[0].status;

  if (status === 'closing' || status === 'closed') {
    // 2a) Deferred branch — emit task.deferred with the would-be-task in payload.
    // appendEvent on a 'closed' topic rejects with BAD_REQUEST; the outer try/
    // catch propagates and the entire txn rolls back. This is the only path
    // where chain emission "fails" — and it correctly mirrors the seal contract.
    const phantomId = randomUUID();
    const reason = (status === 'closing' ? 'topic_closing' : 'topic_closed') as
      | 'topic_closing'
      | 'topic_closed';
    const ev = await appendEvent(client, {
      topic_id: args.topic_id,
      actor_id: args.actor_id,
      type: 'task.deferred',
      subject_type: 'topic',
      subject_id: args.topic_id,
      payload: {
        source_event_type: args.source_event.type,
        source_id: args.source_event.source_id,
        reason,
        phantom_id: phantomId,
        would_be_task: {
          title: args.params.title,
          topology: args.params.topology,
          slot: args.params.slot,
          kind: args.params.kind,
          depends_on: args.params.depends_on,
          raci: args.params.raci,
        },
      },
    });
    return { kind: 'deferred', reason, deferred_event_id: ev.event_id };
  }

  // 2b) Active branch — chain-time depends_on validation.
  if (args.params.depends_on.length > 0) {
    const depRes = await client.query<{ task_id: string }>(
      `SELECT task_id FROM tasks WHERE task_id = ANY($1::uuid[]) AND topic_id = $2`,
      [args.params.depends_on, args.topic_id],
    );
    if ((depRes.rowCount ?? 0) !== args.params.depends_on.length) {
      const found = new Set(depRes.rows.map((r) => r.task_id));
      const missing = args.params.depends_on.filter((d) => !found.has(d));
      throw new ContextHubError(
        'CHAINED_TASK_DEPENDENCY_INVALID',
        `chained task depends_on references unknown or cross-topic tasks: ${missing.join(', ')}`,
      );
    }
  }

  // 3) Inline postTask logic — INSERT tasks + artifacts + artifact_versions +
  // appendEvent task.posted + appendEvent artifact.created. Mirrors postTask
  // but skips the closing/closed check (already handled above) and reuses our
  // open transaction.
  const taskId = randomUUID();
  const artifactId = `${args.topic_id}:${taskId}:${args.params.slot}`;

  await client.query(
    `INSERT INTO tasks (task_id, topic_id, title, topology, depends_on, raci, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7)`,
    [
      taskId,
      args.topic_id,
      args.params.title,
      args.params.topology,
      args.params.depends_on,
      JSON.stringify(args.params.raci),
      args.params.created_by,
    ],
  );
  await client.query(
    `INSERT INTO artifacts (artifact_id, topic_id, task_id, slot, kind, state, version, accepted_fencing_token)
     VALUES ($1, $2, $3, $4, $5, 'draft', 1, 0)`,
    [artifactId, args.topic_id, taskId, args.params.slot, args.params.kind],
  );
  await client.query(
    `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
     VALUES ($1, 1, 'draft', NULL, NULL, 'created', $2)`,
    [artifactId, args.params.created_by],
  );
  await appendEvent(client, {
    topic_id: args.topic_id,
    actor_id: args.actor_id,
    type: 'task.posted',
    subject_type: 'task',
    subject_id: taskId,
    payload: {
      title: args.params.title,
      topology: args.params.topology,
      slot: args.params.slot,
      chained_from: args.source_event.type,
      source_id: args.source_event.source_id,
    },
  });
  await appendEvent(client, {
    topic_id: args.topic_id,
    actor_id: args.actor_id,
    type: 'artifact.created',
    subject_type: 'artifact',
    subject_id: artifactId,
    payload: { task_id: taskId, slot: args.params.slot, kind: args.params.kind },
  });

  return { kind: 'posted', task_id: taskId, artifact_id: artifactId };
}
