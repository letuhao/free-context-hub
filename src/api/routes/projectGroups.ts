import { Router } from 'express';
import {
  createGroup,
  deleteGroup,
  listGroups,
  listGroupMembers,
  addProjectToGroup,
  removeProjectFromGroup,
  listGroupsForProject,
} from '../../core/index.js';

const router = Router();

/** GET /api/groups — list all groups with member counts */
router.get('/', async (req, res, next) => {
  try {
    const groups = await listGroups();
    res.json({ groups });
  } catch (e) { next(e); }
});

/** POST /api/groups — create a group */
router.post('/', async (req, res, next) => {
  try {
    const { group_id, name, description } = req.body;
    if (!group_id || !name) {
      res.status(400).json({ error: 'group_id and name are required' });
      return;
    }
    const group = await createGroup({ group_id: String(group_id), name: String(name), description });
    res.status(201).json(group);
  } catch (e) { next(e); }
});

/** DELETE /api/groups/:id — delete a group (members cascade) */
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteGroup(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/groups/:id/members — list project members of a group */
router.get('/:id/members', async (req, res, next) => {
  try {
    const members = await listGroupMembers(req.params.id);
    res.json({ group_id: req.params.id, members });
  } catch (e) { next(e); }
});

/** POST /api/groups/:id/members — add a project to a group */
router.post('/:id/members', async (req, res, next) => {
  try {
    const { project_id } = req.body;
    if (!project_id) {
      res.status(400).json({ error: 'project_id is required' });
      return;
    }
    const result = await addProjectToGroup(req.params.id, String(project_id));
    res.status(result.added ? 201 : 200).json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/groups/:id/members/:projectId — remove a project from a group */
router.delete('/:id/members/:projectId', async (req, res, next) => {
  try {
    const result = await removeProjectFromGroup(req.params.id, req.params.projectId);
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/projects/:projectId/groups — list groups a project belongs to */
router.get('/by-project/:projectId', async (req, res, next) => {
  try {
    const groups = await listGroupsForProject(req.params.projectId);
    res.json({ project_id: req.params.projectId, groups });
  } catch (e) { next(e); }
});

export { router as projectGroupsRouter };
