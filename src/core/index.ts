/**
 * src/core/ barrel — re-exports all shared business logic.
 *
 * Both the MCP server (src/index.ts) and the future REST API (src/api/)
 * import from here instead of reaching into services/db/kg/utils directly.
 */

// ── Errors ──
export { ContextHubError } from './errors.js';

// ── Auth ──
export { assertWorkspaceToken, resolveProjectIdOrThrow } from './auth.js';

// ── Security: service-layer tenant-scope guard (DEFERRED-029) ──
export { assertCallerScope, assertCallerScopeMulti, type CallerScope } from './security/callerScope.js';

// ── Startup ──
export { logStartupEnvSummary } from './startup.js';

// ── Environment ──
export { getEnv } from '../env.js';

// ── Database ──
export { applyMigrations } from '../db/applyMigrations.js';

// ── Knowledge Graph ──
export { bootstrapKgIfEnabled } from '../kg/bootstrap.js';
export { getLessonImpact, getSymbolNeighbors, searchSymbols, traceDependencyPath } from '../kg/query.js';

// ── Services: indexing & retrieval ──
export { indexProject } from '../services/indexer.js';
export { searchCode } from '../services/retriever.js';
export { tieredSearch } from '../services/tieredRetriever.js';

// ── Services: lessons & guardrails ──
export { addLesson, batchUpdateLessonStatus, deleteWorkspace, listLessons, listLessonVersions, searchLessons, searchLessonsMulti, updateLesson, updateLessonStatus } from '../services/lessons.js';
export { checkGuardrails, listGuardrailRules, simulateGuardrails } from '../services/guardrails.js';

// ── Services: artifact leases (Phase 13 Sprint 13.1 + 13.2) ──
export {
  claimArtifact,
  releaseArtifact,
  renewArtifact,
  listActiveClaims,
  checkArtifactAvailability,
  forceReleaseArtifact,
  sweepExpiredLeases,
} from '../services/artifactLeases.js';
export type {
  ClaimParams,
  ClaimResult,
  ReleaseResult,
  RenewResult,
  ListResult as ArtifactLeasesListResult,
  AvailabilityResult,
  LeaseSummary,
  SweepResult,
} from '../services/artifactLeases.js';
export {
  startSweepScheduler,
  LEASES_SWEEP_ADVISORY_KEY,
  SWEEP_INTERVAL_MS,
} from '../services/sweepScheduler.js';

// ── Services: review requests (Phase 13 Sprint 13.3) ──
export {
  submitForReview,
  listReviewRequests,
  getReviewRequest,
  approveReviewRequest,
  returnReviewRequest,
} from '../services/reviewRequests.js';
export type {
  SubmitResult,
  ReviewRequestRow,
  ReviewRequestDetail,
  ResolveResult,
} from '../services/reviewRequests.js';

// ── Services: taxonomy profiles (Phase 13 Sprint 13.5) ──
export {
  listTaxonomyProfiles,
  getTaxonomyProfileBySlug,
  getTaxonomyProfileById,
  createTaxonomyProfile,
  upsertBuiltinProfile,
  getActiveProfile,
  activateProfile,
  deactivateProfile,
  getValidLessonTypes,
  validateLessonType,
  getLessonTypeLabel,
} from '../services/taxonomyService.js';
export type { TaxonomyProfile, ProfileLessonType } from '../services/taxonomyService.js';
export { bootstrapBuiltinTaxonomyProfiles } from '../services/taxonomyBootstrap.js';

// ── Services: coordination substrate (Phase 15 Sprint 15.1) ──
export { appendEvent, replayEvents } from '../services/coordinationEvents.js';
export type {
  CoordinationEventInput,
  CoordinationEvent,
  ReplayResult,
  AppendResult,
} from '../services/coordinationEvents.js';
export { charterTopic, joinTopic, grantLevel, getTopic, closeTopic } from '../services/topics.js';
export type {
  TopicRecord,
  Participant,
  TopicWithRoster,
  InductionPack,
  CloseResult,
  GrantLevelResult,
} from '../services/topics.js';
export {
  LEVELS,
  ACTOR_TYPES,
  SUBJECT_TYPES,
  TOPIC_STATUSES,
  EVENT_TYPES,
} from '../services/coordinationConstants.js';
export type {
  Level,
  ActorType,
  SubjectType,
  TopicStatus,
  EventType,
} from '../services/coordinationConstants.js';

// ── Services: coordination board (Phase 15 Sprint 15.2) ──
export { postTask, listBoard, claimTask, releaseTask, completeTask } from '../services/board.js';
export type {
  TaskRecord,
  TaskSummary,
  ListBoardResult,
  // aliased — ClaimResult / ReleaseResult already exported by artifactLeases above.
  ClaimResult as TaskClaimResult,
  ReleaseResult as TaskReleaseResult,
  CompleteResult,
} from '../services/board.js';
export { writeArtifact, baselineArtifact, revertArtifact } from '../services/artifacts.js';
export type {
  WriteResult,
  BaselineResult,
  ConflictReason,
} from '../services/artifacts.js';
export { sweepAbandonedClaims, sweepStalledSteps, startClaimsSweepScheduler, CLAIMS_SWEEP_ADVISORY_KEY } from '../services/coordinationSweep.js';
export type {
  SweepResult as ClaimsSweepResult,
  StalledStepsSweepResult,
  ClaimsSweepHandle,
  StartClaimsSweepOptions,
} from '../services/coordinationSweep.js';

// ── Services: request approval (Phase 15 Sprint 15.3) ──
export { submitRequest, decideStep, getRequest, listRequests } from '../services/requests.js';
export type {
  // aliased — SubmitResult already exported by reviewRequests above (different shape).
  SubmitResult as RequestSubmitResult,
  DecideResult,
  RequestRecord,
  RequestStep,
  ListRequestsResult,
} from '../services/requests.js';
export { resolveMatrixRow, deriveRoute } from '../services/doaMatrix.js';
export type { MatrixRow } from '../services/doaMatrix.js';

// ── Services: collective decision (Phase 15 Sprint 15.4) ──
export { createBody, addBodyMember, getBody, listBodies } from '../services/decisionBodies.js';
export type {
  BodyRecord,
  BodyMember,
  AddMemberResult,
  ListBodiesResult,
} from '../services/decisionBodies.js';
export { grantProxy, revokeProxy, listProxies } from '../services/proxies.js';
export type { GrantProxyResult, RevokeProxyResult, ProxyRecord } from '../services/proxies.js';
export {
  proposeMotion,
  secondMotion,
  castVote,
  vetoMotion,
  tallyMotion,
  getMotion,
  listMotions,
  computeMotionTally,
  MOTION_DEADLINE_DEFAULT_MINUTES,
  MOTION_DEADLINE_MIN_MINUTES,
  MOTION_DEADLINE_MAX_MINUTES,
} from '../services/motions.js';
export type {
  MotionRecord,
  MotionVote,
  MotionTally,
  MotionVoteChoice,
  ProposeResult,
  SecondResult,
  VoteResult,
  VetoResult,
  TallyResult,
  TallyOutcome,
  ListMotionsResult,
} from '../services/motions.js';
export { sweepExpiredMotions } from '../services/coordinationSweep.js';
export type { ExpiredMotionsSweepResult } from '../services/coordinationSweep.js';

// ── Services: intake mailbox (Phase 15 Sprint 15.5) ──
export { submitIntake, triageIntake, dismissIntake, getIntake, listIntake } from '../services/intake.js';
export type { IntakeKind, IntakeStatus, IntakeItem, TriageRoute, TriageResult } from '../services/intake.js';

// ── Services: dispute resolution (Phase 15 Sprint 15.5) ──
export { openDispute, resolveDispute, getDispute, listDisputes } from '../services/disputes.js';
export type { DisputeStatus, Dispute, DisputeDetail } from '../services/disputes.js';

// ── Services: distillation & snapshots ──
export { getProjectSnapshotBody } from '../services/snapshot.js';
export { compressText, reflectOnTopic } from '../services/distiller.js';

// ── Services: git intelligence ──
export {
  analyzeCommitImpact,
  getCommit,
  ingestGitHistory,
  linkCommitToLesson,
  listCommits,
  suggestLessonsFromCommits,
} from '../services/gitIntelligence.js';

// ── Services: repo sources ──
export { configureProjectSource, getProjectSource, prepareRepo } from '../services/repoSources.js';

// ── Services: job queue ──
export { enqueueJob, listJobs } from '../services/jobQueue.js';
export { runNextJob } from '../services/jobExecutor.js';

// ── Services: workspace tracker ──
export { listWorkspaceRoots, registerWorkspaceRoot, scanWorkspaceChanges } from '../services/workspaceTracker.js';

// ── Services: generated docs ──
export { getGeneratedDocument, listGeneratedDocuments, promoteGeneratedDocument } from '../services/generatedDocs.js';

// ── Services: project groups ──
export {
  createGroup,
  deleteGroup,
  listGroups,
  getGroup,
  listGroupMembers,
  addProjectToGroup,
  removeProjectFromGroup,
  listGroupsForProject,
  resolveProjectIds,
  listAllProjects,
  createProject,
  updateProject,
} from '../services/projectGroups.js';
export type { ProjectGroup, ProjectGroupWithMembers, ProjectWithGroups } from '../services/projectGroups.js';

// ── Feature toggles ──
export { isFeatureEnabled, invalidateFeatureCache } from '../services/featureToggles.js';

// ── Utils ──
export { resolveProjectRoot } from '../utils/resolveProjectRoot.js';
export { createModuleLogger } from '../utils/logger.js';
