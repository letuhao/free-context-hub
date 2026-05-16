/**
 * Phase 15 coordination — shared enums & the canonical event-type catalog.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §2
 * (the catalog is design doc Part C.3). Grouped by sprint so this file doubles
 * as a record of what is implemented.
 */

export const LEVELS = ['authority', 'coordination', 'execution'] as const;
export type Level = (typeof LEVELS)[number];

export const ACTOR_TYPES = ['human', 'ai'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const SUBJECT_TYPES =
  ['task', 'artifact', 'request', 'motion', 'dispute', 'intake', 'topic'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const TOPIC_STATUSES = ['chartered', 'active', 'closing', 'closed'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

/**
 * The full design-C.3 event-type catalog. `appendEvent` validates `type` against
 * this set. Listing later-sprint types now is free (no DB migration — `type` has
 * no DB CHECK, design D3) and keeps C.3 canonical in one place.
 */
export const EVENT_TYPES = [
  // Sprint 15.1 — substrate
  'topic.chartered', 'topic.actor_joined', 'topic.closed',
  // Sprint 15.2 — Board
  'task.posted', 'task.claimed', 'task.released', 'task.completed', 'task.deferred',
  'artifact.created', 'artifact.versioned', 'artifact.state_changed',
  'claim.granted', 'claim.conflict', 'claim.expired',
  // Sprint 15.3 — Request-Approval
  'request.submitted', 'request.step_decided', 'request.step_escalated', 'request.resolved',
  // Sprint 15.4 — collective decision
  'motion.proposed', 'motion.seconded', 'vote.cast', 'motion.tallied', 'motion.vetoed',
  // Sprint 15.5 — intake & dispute
  'intake.received', 'intake.triaged', 'dispute.opened', 'dispute.resolved',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
export const SUBJECT_TYPE_SET: ReadonlySet<string> = new Set(SUBJECT_TYPES);
export const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS);
export const ACTOR_TYPE_SET: ReadonlySet<string> = new Set(ACTOR_TYPES);
