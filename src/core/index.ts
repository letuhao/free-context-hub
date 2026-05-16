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
export { charterTopic, joinTopic, getTopic, closeTopic } from '../services/topics.js';
export type {
  TopicRecord,
  Participant,
  TopicWithRoster,
  InductionPack,
  CloseResult,
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
