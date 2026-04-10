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

  // All other routes require Bearer token
  app.use('/api', bearerAuth);

  // ── Routes: read (reader+) ──
  app.use('/api/lessons', lessonsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/guardrails', guardrailsRouter);
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
