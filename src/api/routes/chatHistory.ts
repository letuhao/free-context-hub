import { Router } from 'express';
import {
  createConversation,
  listConversations,
  getConversation,
  addMessage,
  toggleMessagePin,
  deleteConversation,
} from '../../services/chatHistory.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** POST /api/chat/conversations — create a new conversation */
router.post('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await createConversation({
      projectId,
      title: req.body.title,
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** GET /api/chat/conversations — list conversations for a project */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listConversations({
      projectId,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/chat/conversations/:id — get conversation with messages */
router.get('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getConversation({
      conversationId: req.params.id,
      projectId,
    });
    if (!result) {
      res.status(404).json({ status: 'error', error: 'conversation not found' });
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/chat/conversations/:id/messages — add a message */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await addMessage({
      conversationId: req.params.id,
      projectId,
      role: req.body.role,
      content: req.body.content,
      metadata: req.body.metadata,
    });
    if (!result) {
      res.status(404).json({ status: 'error', error: 'conversation not found' });
      return;
    }
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** PATCH /api/chat/conversations/:id/messages/:msgId/pin — toggle pin */
router.patch('/:id/messages/:msgId/pin', async (req, res, next) => {
  try {
    const result = await toggleMessagePin({
      conversationId: req.params.id,
      messageId: req.params.msgId,
    });
    if (!result) {
      res.status(404).json({ status: 'error', error: 'message not found' });
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/chat/conversations/:id — delete conversation + messages */
router.delete('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow((req.query.project_id as string | undefined) ?? req.body?.project_id);
    const deleted = await deleteConversation({
      conversationId: req.params.id,
      projectId,
    });
    if (!deleted) {
      res.status(404).json({ status: 'error', error: 'conversation not found' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

export { router as chatHistoryRouter };
