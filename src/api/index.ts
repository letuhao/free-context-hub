import express from 'express';
import cors from 'cors';

import { bearerAuth } from './middleware/auth.js';
import { requireRole } from './middleware/requireRole.js';
import { errorHandler } from './middleware/errorHandler.js';
import { lessonsRouter } from './routes/lessons.js';
import { searchRouter } from './routes/search.js';
import { guardrailsRouter } from './routes/guardrails.js';
import { projectsRouter } from './routes/projects.js';
import { gitRouter } from './routes/git.js';
import { jobsRouter } from './routes/jobs.js';
import { generatedDocsRouter } from './routes/generated-docs.js';
import { workspaceRouter } from './routes/workspace.js';
import { chatRouter } from './routes/chat.js';
import { chatHistoryRouter } from './routes/chatHistory.js';
import { documentsRouter } from './routes/documents.js';
import { collaborationRouter, bookmarkRouter } from './routes/collaboration.js';
import { activityRouter, notificationsRouter } from './routes/activity.js';
import { analyticsRouter } from './routes/analytics.js';
import { learningPathsRouter } from './routes/learningPaths.js';
import { agentsRouter } from './routes/agents.js';
import { systemRouter } from './routes/system.js';
import { projectGroupsRouter } from './routes/projectGroups.js';
import { lessonTypesRouter } from './routes/lessonTypes.js';
import { auditRouter } from './routes/audit.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { artifactLeasesRouter } from './routes/artifactLeases.js';  // Phase 13 Sprint 13.1
import { meRouter } from './routes/me.js';                          // Phase 13 Sprint 13.2
import { reviewRequestsRouter } from './routes/reviewRequests.js';  // Phase 13 Sprint 13.3
import { taxonomyProfilesRouter, projectTaxonomyProfileRouter } from './routes/taxonomy.js'; // Phase 13 Sprint 13.5
import { topicsRouter } from './routes/topics.js';                  // Phase 15 Sprint 15.1

/**
 * Creates the REST API Express app.
 * Mounted alongside the MCP server in the same Node.js process.
 */
export function createApiApp() {
  const app = express();

  // ── Global middleware ──
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Health endpoint is public (no auth)
  app.use('/api/system', systemRouter);

  // Phase 10.7 test-only static fixtures. Enabled ONLY when
  // ALLOW_PRIVATE_FETCH_FOR_TESTS=true (matches the SSRF bypass flag) so
  // production deployments never expose the filesystem. Used by the E2E
  // harness and Playwright tests to ingest local fixtures via the
  // ingest-url endpoint without external network dependencies.
  if (process.env.ALLOW_PRIVATE_FETCH_FOR_TESTS === 'true') {
    // Resolve test-data relative to the compiled module, not cwd, so it
    // works regardless of how the process was launched. In the Docker
    // image we COPY . . to /app, so /app/test-data/ is present next to
    // /app/dist/api/index.js.
    const testDataDir = new URL('../../test-data/', import.meta.url).pathname;
    app.use(
      '/test-static',
      express.static(testDataDir, {
        fallthrough: false,
        maxAge: 0,
        setHeaders: (res, filePath) => {
          // Ensure the MIME whitelist in urlFetch will accept these
          if (filePath.endsWith('.md')) res.setHeader('Content-Type', 'text/markdown');
          else if (filePath.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain');
        },
      }),
    );
  }

  // All other routes require Bearer token
  app.use('/api', bearerAuth);

  // ── Routes: read (reader+) ──
  // Phase 13 Sprint 13.2: identity-context endpoint for GUI role/scope checks
  app.use('/api/me', meRouter);
  app.use('/api/lessons', lessonsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/guardrails', guardrailsRouter);
  // Phase 13 Sprint 13.1: artifact leases — MUST mount BEFORE projectsRouter
  // because projectsRouter is mounted at /api/projects and would otherwise
  // catch deeper /:id/* paths. Router uses mergeParams to access :id.
  app.use('/api/projects/:id/artifact-leases', artifactLeasesRouter);
  // Phase 13 Sprint 13.3: review requests — same nested-router pattern
  app.use('/api/projects/:id/review-requests', reviewRequestsRouter);
  // Phase 13 Sprint 13.5: taxonomy profiles (project-scoped activation)
  app.use('/api/projects/:id/taxonomy-profile', projectTaxonomyProfileRouter);
  // Phase 13 Sprint 13.5: taxonomy profiles (global namespace)
  app.use('/api/taxonomy-profiles', taxonomyProfilesRouter);
  // Phase 15 Sprint 15.1: coordination topics (top-level — topic_id is a global PK)
  app.use('/api/topics', topicsRouter);
  app.use('/api/projects', projectsRouter);       // mixed — write routes gated inside
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/generated-docs', generatedDocsRouter); // mixed — promote gated inside
  app.use('/api/lessons', collaborationRouter); // comments + feedback under /api/lessons/:id/*
  app.use('/api/bookmarks', bookmarkRouter);

  // ── Routes: write (writer+) ──
  app.use('/api/git', requireRole('writer'), gitRouter);
  app.use('/api/jobs', requireRole('writer'), jobsRouter);
  app.use('/api/workspace', requireRole('writer'), workspaceRouter);
  app.use('/api', requireRole('writer'), workspaceRouter); // mounts /api/sources/* routes
  app.use('/api/chat', requireRole('writer'), chatRouter);
  app.use('/api/chat/conversations', requireRole('writer'), chatHistoryRouter);
  app.use('/api/documents', requireRole('writer'), documentsRouter);
  app.use('/api/learning-paths', requireRole('writer'), learningPathsRouter);
  app.use('/api/groups', requireRole('writer'), projectGroupsRouter);

  // ── Routes: admin ──
  app.use('/api/lesson-types', requireRole('admin'), lessonTypesRouter);
  app.use('/api/api-keys', requireRole('admin'), apiKeysRouter);

  // ── Error handler (must be last) ──
  app.use(errorHandler);

  return app;
}
