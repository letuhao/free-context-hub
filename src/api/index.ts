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
import { systemRouter } from './routes/system.js';

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

  // ── Error handler (must be last) ──
  app.use(errorHandler);

  return app;
}
