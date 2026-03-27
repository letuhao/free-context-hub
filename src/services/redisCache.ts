import { createClient, type RedisClientType } from 'redis';

import { getEnv } from '../env.js';

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType | null> {
  const env = getEnv();
  if (!env.REDIS_ENABLED) return null;
  if (client) return client;
  client = createClient({ url: env.REDIS_URL });
  client.on('error', () => {
    // best-effort cache; errors should not crash request path
  });
  await client.connect();
  return client;
}

export function redisKey(parts: string[]): string {
  const env = getEnv();
  const prefix = env.REDIS_PREFIX?.trim() || 'contexthub';
  return [prefix, ...parts].join(':');
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const r = await getRedis();
  if (!r) return null;
  const s = await r.get(key);
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  const ttl = Math.max(1, Math.min(ttlSeconds, 7 * 24 * 3600));
  await r.set(key, JSON.stringify(value), { EX: ttl });
}

