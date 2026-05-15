/**
 * Phase 13 Sprint 13.5 — REST routes for taxonomy profiles.
 *
 * Two mount points:
 *   /api/taxonomy-profiles         — list, get-by-slug, create custom
 *   /api/projects/:id/taxonomy-profile — get active, activate, deactivate (mergeParams)
 *
 * Cross-tenant safety (r1 F2 fix): mutating routes under /api/projects/:id use
 * requireScope('id'); the create route validates body.owner_project_id against
 * the caller's scope (if scoped).
 */

import { Router } from 'express';
import {
  listTaxonomyProfiles,
  getTaxonomyProfileBySlug,
  createTaxonomyProfile,
  getActiveProfile,
  activateProfile,
  deactivateProfile,
  resolveProjectIdOrThrow,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireScope } from '../middleware/requireScope.js';
import { ContextHubError } from '../../core/errors.js';

// ── Global-namespace router: /api/taxonomy-profiles ──
export const taxonomyProfilesRouter = Router();

taxonomyProfilesRouter.get('/', async (req, res, next) => {
  try {
    const ownerQuery = req.query.owner_project_id;
    let owner: string | null | undefined = undefined;
    if (ownerQuery === 'null') owner = null;
    else if (typeof ownerQuery === 'string' && ownerQuery.length > 0) owner = ownerQuery;
    const is_builtin = req.query.is_builtin === 'true' ? true : req.query.is_builtin === 'false' ? false : undefined;
    res.json({ profiles: await listTaxonomyProfiles({ owner_project_id: owner, is_builtin }) });
  } catch (e) { next(e); }
});

taxonomyProfilesRouter.get('/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    const ownerQuery = req.query.owner_project_id;
    const owner = ownerQuery === 'null' || ownerQuery === undefined ? null : String(ownerQuery);
    const profile = await getTaxonomyProfileBySlug(slug, owner);
    if (!profile) { res.status(404).json({ error: 'not found' }); return; }
    res.json(profile);
  } catch (e) { next(e); }
});

taxonomyProfilesRouter.post('/', requireRole('writer'), async (req, res, next) => {
  try {
    const { slug, name, description, version, lesson_types, owner_project_id } = req.body ?? {};
    if (!owner_project_id || typeof owner_project_id !== 'string') {
      res.status(400).json({ error: 'owner_project_id (string) is required for custom profiles' });
      return;
    }
    // r1 F2 fix: when caller has a scope, body.owner_project_id must match it.
    const callerScope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    if (typeof callerScope === 'string' && callerScope.length > 0 && callerScope !== owner_project_id) {
      res.status(403).json({
        error: `Forbidden: API key scoped to '${callerScope}' cannot create a profile owned by '${owner_project_id}'`,
      });
      return;
    }
    const profile = await createTaxonomyProfile({ slug, name, description, version, lesson_types, owner_project_id });
    res.status(201).json(profile);
  } catch (e) {
    if (e instanceof ContextHubError) {
      res.status(e.code === 'BAD_REQUEST' ? 400 : 500).json({ error: e.message });
      return;
    }
    next(e);
  }
});

// ── Project-scoped router: /api/projects/:id/taxonomy-profile (mergeParams) ──
export const projectTaxonomyProfileRouter = Router({ mergeParams: true });

projectTaxonomyProfileRouter.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const profile = await getActiveProfile(projectId);
    res.json({ profile });
  } catch (e) { next(e); }
});

projectTaxonomyProfileRouter.post('/activate', requireRole('writer'), requireScope('id'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const { slug, activated_by } = req.body ?? {};
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'slug (string) is required' });
      return;
    }
    const result = await activateProfile({ project_id: projectId, slug, activated_by });
    if (result.status === 'profile_not_found') { res.status(404).json(result); return; }
    res.json(result);
  } catch (e) { next(e); }
});

projectTaxonomyProfileRouter.delete('/', requireRole('writer'), requireScope('id'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    res.json(await deactivateProfile(projectId));
  } catch (e) { next(e); }
});
