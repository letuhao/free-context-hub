import express from 'express';
import cors from 'cors';

import { getEnv } from '../core/index.js';
import { bearerAuth } from './middleware/auth.js';
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
import { systemRouter, publicSystemRouter } from './routes/system.js';
import { projectGroupsRouter } from './routes/projectGroups.js';
import { lessonTypesRouter } from './routes/lessonTypes.js';
import { auditRouter } from './routes/audit.js';
import { apiKeysRouter, accessReviewRouter } from './routes/apiKeys.js';
import { artifactLeasesRouter } from './routes/artifactLeases.js';  // Phase 13 Sprint 13.1
import { meRouter } from './routes/me.js';                          // Phase 13 Sprint 13.2
import { reviewRequestsRouter } from './routes/reviewRequests.js';  // Phase 13 Sprint 13.3
import { taxonomyProfilesRouter, projectTaxonomyProfileRouter } from './routes/taxonomy.js'; // Phase 13 Sprint 13.5
import { topicsRouter } from './routes/topics.js';                  // Phase 15 Sprint 15.1
import { boardRouter } from './routes/board.js';                    // Phase 15 Sprint 15.2
import { requestsRouter } from './routes/requests.js';              // Phase 15 Sprint 15.3
import { motionsRouter } from './routes/motions.js';                // Phase 15 Sprint 15.4
import { intakeRouter } from './routes/intake.js';                  // Phase 15 Sprint 15.5
import { disputesRouter } from './routes/disputes.js';              // Phase 15 Sprint 15.5
// Actor Data Boundary completion (warp) — governance REST (S1) + F-AUTH (S3)
import { bootstrapRouter } from './routes/bootstrap.js';            // S1 — pre-auth (ROOT_BOOTSTRAP_TOKEN)
import { principalsRouter } from './routes/principals.js';          // S1 — admin@global
import { grantsRouter } from './routes/grants.js';                  // S1 — admin@global
import { authorizationRouter } from './routes/authorization.js';    // S1 — admin@global
import { authRouter } from './routes/auth.js';                      // S3 — pre-auth (human login)
import { invitesRouter } from './routes/invites.js';                // S3 — admin
import { sessionAuth, csrfGuard } from './middleware/sessionAuth.js'; // S3 — cooperative cookie auth + CSRF

/**
 * Creates the REST API Express app.
 * Mounted alongside the MCP server in the same Node.js process.
 */
export function createApiApp() {
  const app = express();
  const env = getEnv();

  // ── Global middleware ──
  // CORS lockdown: the GUI is same-origin (single-port gateway), so cross-origin
  // browser access is denied by default. Only origins explicitly listed in
  // CORS_ALLOWED_ORIGINS may make credentialed cross-origin requests. Requests
  // with no Origin header (server-to-server agents, curl, the same-origin GUI)
  // are unaffected — CORS only governs cross-origin browser reads.
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header → non-browser or same-origin → allow.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // Cross-origin browser request to a non-allowlisted origin → no CORS
        // headers emitted, so the browser blocks the response read.
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  // Liveness probe is public (no auth). /api/system/info — which leaks model
  // names + feature flags — is NOT public; it's mounted behind bearerAuth below.
  app.use('/api/system', publicSystemRouter);

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

  // ── PRE-AUTH routes (warp: must be reachable WITHOUT a credential) ──
  // F4 guard: these mount BEFORE the bearerAuth gate so login/register/bootstrap
  // are reachable to establish the first credential. They gate internally
  // (authRouter: public auth flows; bootstrapRouter: ROOT_BOOTSTRAP_TOKEN).
  app.use('/api/auth', authRouter);          // S3 — human login/register/password/mfa/sessions
  app.use('/api/bootstrap', bootstrapRouter); // S1 — first-run wizard (token-gated)

  // All other routes require Bearer token
  app.use('/api', bearerAuth);
  // S3 — cooperative session-cookie auth, IMMEDIATELY after bearerAuth. No-ops if a
  // Bearer principal is already attached; else resolves the cookie. Never rejects on its own.
  app.use('/api', sessionAuth);
  // S3 — double-submit CSRF guard for cookie-authenticated state changes (adversary A2: was
  // exported but never mounted). Skips safe methods AND Bearer/agent requests, so agents are
  // unaffected; only cookie-authed mutations must present X-CSRF-Token == session.csrf_token.
  app.use('/api', csrfGuard);

  // System info (model names, feature flags) — behind auth (MED-1: recon).
  app.use('/api/system', systemRouter);

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
  // Phase 15 Sprint 15.2: The Board — mounted at /api AFTER /api/topics so the
  // /topics/:id/{tasks,board} board routes fall through topicsRouter to here.
  app.use('/api', boardRouter);
  // Phase 15 Sprint 15.3: Request-Approval — mounted at /api AFTER boardRouter;
  // handles /topics/:id/requests + /requests/:id + /requests/:id/steps/:n/decide.
  app.use('/api', requestsRouter);
  // Phase 15 Sprint 15.4: Collective Decision — mounted at /api AFTER requestsRouter;
  // handles /decision-bodies/* + /topics/:id/motions + /motions/:id/*.
  app.use('/api', motionsRouter);
  // Phase 15 Sprint 15.5: Intake + Dispute — mixed read/write gated inside each router;
  // handles /intake/*, /projects/:id/intake, /disputes/*, /topics/:id/disputes.
  app.use('/api', intakeRouter);
  app.use('/api', disputesRouter);
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
  app.use('/api/git', gitRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/workspace', workspaceRouter);
  app.use('/api', workspaceRouter); // mounts /api/sources/* routes
  app.use('/api/chat', chatRouter);
  app.use('/api/chat/conversations', chatHistoryRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/learning-paths', learningPathsRouter);
  app.use('/api/groups', projectGroupsRouter);

  // ── Routes: admin ──
  app.use('/api/lesson-types', lessonTypesRouter);
  app.use('/api/api-keys', apiKeysRouter);
  // Actor Data Boundary completion (warp) — governance + NHI admin surface.
  // Each router gates internally via assertAuthorized(..., 'admin', {kind:'global'}).
  app.use('/api/principals', principalsRouter);     // S1
  app.use('/api/grants', grantsRouter);             // S1
  app.use('/api/authz', authorizationRouter);       // S1 (decision log + explain)
  app.use('/api/invites', invitesRouter);           // S3
  app.use('/api/access-review', accessReviewRouter); // S5 (NHI)

  // ── Error handler (must be last) ──
  app.use(errorHandler);

  return app;
}
