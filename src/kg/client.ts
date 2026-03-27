import neo4j, { type Driver } from 'neo4j-driver';

import { getEnv } from '../env.js';

let driver: Driver | undefined;

export function getNeo4jDriver(): Driver | null {
  const env = getEnv();
  if (!env.KG_ENABLED) return null;
  if (!driver) {
    driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD));
  }
  return driver;
}

export async function closeNeo4jDriver(): Promise<void> {
  if (!driver) return;
  await driver.close();
  driver = undefined;
}
