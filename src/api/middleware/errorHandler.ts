import type { Request, Response, NextFunction } from 'express';
import { ContextHubError, createModuleLogger } from '../../core/index.js';

const logger = createModuleLogger('api');

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/**
 * Express error handler that maps ContextHubError → HTTP status codes.
 * Must be registered as the LAST middleware (4-arg signature).
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ContextHubError) {
    const status = CODE_TO_STATUS[err.code] ?? 500;
    res.status(status).json({ error: err.message });
    return;
  }

  logger.error({ error: err.message, stack: err.stack }, 'unhandled API error');
  res.status(500).json({ error: 'Internal server error' });
}
