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
export { addLesson, deleteWorkspace, listLessons, searchLessons, updateLessonStatus } from '../services/lessons.js';
export { checkGuardrails } from '../services/guardrails.js';

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

// ── Utils ──
export { resolveProjectRoot } from '../utils/resolveProjectRoot.js';
export { createModuleLogger } from '../utils/logger.js';
