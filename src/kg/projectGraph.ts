import { getEnv } from '../env.js';
import { getNeo4jDriver } from './client.js';

export async function deleteProjectGraph(projectId: string): Promise<{ status: 'skipped' | 'ok' | 'error'; message?: string }> {
  const env = getEnv();
  if (!env.KG_ENABLED) return { status: 'skipped' };
  const driver = getNeo4jDriver();
  if (!driver) return { status: 'skipped' };

  const session = driver.session();
  try {
    await session.executeWrite(tx => tx.run(`MATCH (n {project_id: $project_id}) DETACH DELETE n`, { project_id: projectId }));
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    await session.close();
  }
}
