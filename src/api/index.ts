import express from 'express';
import cors from 'cors';

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
import { systemRouter } from './routes/system.js';
import { projectGroupsRouter } from './routes/projectGroups.js';
import { lessonTypesRouter } from './routes/lessonTypes.js';
import { auditRouter } from './routes/audit.js';

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

  // ── Routes ──
  app.use('/api/lessons', lessonsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/guardrails', guardrailsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/git', gitRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/generated-docs', generatedDocsRouter);
  app.use('/api/workspace', workspaceRouter);
  app.use('/api', workspaceRouter); // mounts /api/sources/* routes
  app.use('/api/chat', chatRouter);
  app.use('/api/chat/conversations', chatHistoryRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/lessons', collaborationRouter); // comments + feedback under /api/lessons/:id/*
  app.use('/api/bookmarks', bookmarkRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/learning-paths', learningPathsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/groups', projectGroupsRouter);
  app.use('/api/lesson-types', lessonTypesRouter);
  app.use('/api/audit', auditRouter);

  // ── Error handler (must be last) ──
  app.use(errorHandler);

  return app;
}
