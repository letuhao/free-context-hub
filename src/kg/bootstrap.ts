import { getEnv } from '../env.js';
import { getNeo4jDriver } from './client.js';
import { ensureKgSchema } from './schema.js';

export async function bootstrapKgIfEnabled(): Promise<void> {
  const env = getEnv();
  if (!env.KG_ENABLED) return;

  const driver = getNeo4jDriver();
  if (!driver) {
    console.warn('[kg] KG_ENABLED=true but Neo4j driver is unavailable');
    return;
  }

  const session = driver.session();
  try {
    await ensureKgSchema(session);
    console.log('[kg] schema constraints ensured');
  } finally {
    await session.close();
  }
}
