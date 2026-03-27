import { getEnv } from '../env.js';
import { getNeo4jDriver } from './client.js';
import { ensureKgSchema } from './schema.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('kg.bootstrap');

export async function bootstrapKgIfEnabled(): Promise<void> {
  const env = getEnv();
  if (!env.KG_ENABLED) return;

  const driver = getNeo4jDriver();
  if (!driver) {
    logger.warn({ kg_enabled: env.KG_ENABLED }, 'Neo4j driver is unavailable while KG is enabled');
    return;
  }

  const session = driver.session();
  try {
    await ensureKgSchema(session);
    logger.info({}, 'kg schema constraints ensured');
  } finally {
    await session.close();
  }
}
