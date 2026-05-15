/**
 * Phase 13 Sprint 13.5 — Bootstrap built-in taxonomy profiles on server startup.
 *
 * Reads config/taxonomy-profiles/*.json and upserts each into taxonomy_profiles
 * as is_builtin=true, owner_project_id=NULL. Slug is the upsert key.
 *
 * Idempotent: re-running the bootstrap is safe (uses ON CONFLICT UPDATE).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertBuiltinProfile, type ProfileLessonType } from './taxonomyService.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('taxonomy-bootstrap');

interface ProfileFile {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  lesson_types: ProfileLessonType[];
}

/**
 * Resolve the config directory. In development this is config/taxonomy-profiles/
 * at the repo root; in the docker image it's /app/config/taxonomy-profiles/.
 * Both layouts work because we resolve relative to compiled module location.
 */
function resolveConfigDir(): string {
  // dist/services/taxonomyBootstrap.js → ../../config/taxonomy-profiles
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'config', 'taxonomy-profiles');
}

export async function bootstrapBuiltinTaxonomyProfiles(): Promise<{ seeded: number; skipped: number }> {
  const dir = resolveConfigDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    logger.warn({ dir, err: String(err) }, 'taxonomy-profiles config dir not found; skipping bootstrap');
    return { seeded: 0, skipped: 0 };
  }

  const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'));
  let seeded = 0;
  let skipped = 0;

  for (const file of jsonFiles) {
    const full = path.join(dir, file);
    try {
      const raw = await readFile(full, 'utf-8');
      const profile = JSON.parse(raw) as ProfileFile;
      if (!profile.slug || !profile.name || !Array.isArray(profile.lesson_types)) {
        logger.warn({ file }, 'profile file missing required fields; skipping');
        skipped++;
        continue;
      }
      await upsertBuiltinProfile({
        slug: profile.slug,
        name: profile.name,
        description: profile.description,
        version: profile.version,
        lesson_types: profile.lesson_types,
      });
      seeded++;
      logger.info({ slug: profile.slug, types: profile.lesson_types.length }, 'built-in profile seeded');
    } catch (err) {
      logger.error({ file, err: String(err) }, 'failed to seed built-in profile');
      skipped++;
    }
  }

  logger.info({ seeded, skipped, dir }, 'taxonomy bootstrap complete');
  return { seeded, skipped };
}
