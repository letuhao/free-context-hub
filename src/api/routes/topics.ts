/**
 * Phase 15 Sprint 15.1 — Coordination topics REST routes.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §5
 *
 * Mounted at /api/topics (top-level — topic_id is a global PK, so no
 * /:projectId path segment). Writes require the `writer` role; reads and the
 * SSE stream are open within bearerAuth.
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via the router-local error middleware.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  charterTopic,
  joinTopic,
  getTopic,
  closeTopic,
  replayEvents,
  resolveProjectIdOrThrow,
  ContextHubError,
} from '../../core/index.js';
import type { CoordinationEvent } from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/** Parse a `since` cursor from a query value or header (defends against array / NaN). */
function parseCursor(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// POST /api/topics — charter a topic
router.post('/', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const projectId = resolveProjectIdOrThrow(
      typeof body.project_id === 'string' && body.project_id ? body.project_id : undefined,
    );
    const result = await charterTopic({
      project_id: projectId,
      name: String(body.name ?? ''),
      charter: String(body.charter ?? ''),
      created_by: String(body.created_by ?? ''),
    });
    res.status(201).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/topics/:id/join — join a topic, returns the induction pack
router.post('/:id/join', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await joinTopic({
      topic_id: String(req.params.id),
      actor_id: String(body.actor_id ?? ''),
      actor_type: String(body.actor_type ?? ''),
      display_name: String(body.display_name ?? ''),
      level: String(body.level ?? ''),
      since_seq: typeof body.since_seq === 'number' ? body.since_seq : undefined,
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/topics/:id — topic record + participant roster
router.get('/:id', async (req, res, next) => {
  try {
    const result = await getTopic({ topic_id: String(req.params.id) });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/topics/:id/close — close a topic (seals the event log)
router.post('/:id/close', requireRole('writer'), async (req, res, next) => {
  try {
    const result = await closeTopic({
      topic_id: String(req.params.id),
      actor_id: String((req.body ?? {}).actor_id ?? ''),
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/topics/:id/events?since=:seq — cursor replay
router.get('/:id/events', async (req, res, next) => {
  try {
    const result = await replayEvents({
      topic_id: String(req.params.id),
      since_seq: parseCursor(req.query.since),
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/topics/:id/stream?since=:seq — SSE live event stream (design §5.1)
const POLL_MS = 2000;
const MAX_STREAM_MS = 1_800_000; // 30 min — bounds a half-open-socket zombie loop

// Test-only instrumentation — count of live SSE streams (armed past flushHeaders).
// Mirrors the _resetAttemptLogForTest hook in artifactLeases.ts; lets the route test
// assert that a client disconnect runs cleanup exactly once (AC9 / REVIEW-CODE WARN-3).
let activeStreamCount = 0;
export function _activeStreamCountForTest(): number {
  return activeStreamCount;
}

router.get('/:id/stream', async (req, res, next) => {
  const topicId = String(req.params.id);
  const sinceSeq = parseCursor(req.query.since ?? req.headers['last-event-id']);

  let closed = false;
  let counted = false;
  let timer: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (counted) { counted = false; activeStreamCount--; }
    if (timer) clearTimeout(timer);
    if (!res.writableEnded) res.end();
  };
  req.on('close', cleanup); // wired BEFORE any await — a disconnect mid-pre-flight is captured

  try {
    // pre-flight existence check — before headers. NOT_FOUND → catch → next(e) → real 404.
    const first = await replayEvents({ topic_id: topicId, since_seq: sinceSeq });
    if (closed || req.destroyed) { cleanup(); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    counted = true;
    activeStreamCount++;

    let cursor = first.next_cursor;
    const streamDeadline = Date.now() + MAX_STREAM_MS;

    const writeEvents = (events: CoordinationEvent[]) => {
      for (const e of events) {
        res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      }
    };
    const endStream = () => {
      res.write('event: stream_end\ndata: {}\n\n');
      cleanup();
    };
    const drainIfClosed = (events: CoordinationEvent[]): boolean => {
      if (events.some((e) => e.type === 'topic.closed')) {
        endStream();
        return true;
      }
      return false;
    };

    writeEvents(first.events);
    res.write(`: ping ${Date.now()}\n\n`);
    if (drainIfClosed(first.events)) return;

    // Self-scheduling loop — the next tick is armed only after the current one
    // settles, so two ticks can never overlap.
    const tick = async () => {
      if (closed || res.writableEnded) return;
      if (Date.now() > streamDeadline) { endStream(); return; }
      const r = await replayEvents({ topic_id: topicId, since_seq: cursor });
      if (closed || res.writableEnded) return;
      writeEvents(r.events);
      cursor = r.next_cursor;
      res.write(`: ping ${Date.now()}\n\n`);
      if (drainIfClosed(r.events)) return;
      timer = setTimeout(() => { tick().catch(cleanup); }, POLL_MS);
    };
    timer = setTimeout(() => { tick().catch(cleanup); }, POLL_MS);
  } catch (e) {
    if (closed || req.destroyed) return; // disconnected during pre-flight — nothing to report
    next(e);                              // pre-flight NOT_FOUND → 404 JSON
  }
});

// Router-local error middleware — keeps the Phase 15 { status:'error', … } envelope
// without touching the global errorHandler. Delegates once headers are already sent
// (e.g. an error after the SSE stream has started).
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof ContextHubError) {
    res.status(CODE_TO_STATUS[err.code] ?? 500).json({
      status: 'error',
      error: err.message,
      code: err.code,
    });
    return;
  }
  next(err);
});

export const topicsRouter = router;
