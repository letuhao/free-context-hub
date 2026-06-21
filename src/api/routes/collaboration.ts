import { Router } from 'express';
import {
  addComment, listComments, deleteComment,
  voteFeedback, getFeedback, removeFeedback,
  addBookmark, removeBookmark, listBookmarks,
} from '../../services/collaboration.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';
import { callerPrincipalOf } from '../middleware/auth.js';

const router = Router();

// ── Comments: /api/lessons/:id/comments ──

router.get('/:id/comments', async (req, res, next) => {
  try {
    const result = await listComments({ lessonId: req.params.id, actingPrincipalId: callerPrincipalOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const result = await addComment({
      lessonId: String(req.params.id),
      actingPrincipalId: callerPrincipalOf(req),
      parentId: req.body.parent_id,
      author: req.body.author,
      content: req.body.content,
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  try {
    const deleted = await deleteComment({ commentId: String(req.params.commentId), actingPrincipalId: callerPrincipalOf(req) });
    if (!deleted) { res.status(404).json({ status: 'error', error: 'comment not found' }); return; }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

// ── Feedback: /api/lessons/:id/feedback ──

router.get('/:id/feedback', async (req, res, next) => {
  try {
    const result = await getFeedback({
      lessonId: req.params.id,
      actingPrincipalId: callerPrincipalOf(req),
      userId: req.query.user_id as string | undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/:id/feedback', async (req, res, next) => {
  try {
    const vote = Number(req.body.vote);
    if (vote !== 1 && vote !== -1) { res.status(400).json({ status: 'error', error: 'vote must be 1 or -1' }); return; }
    const result = await voteFeedback({
      lessonId: String(req.params.id),
      actingPrincipalId: callerPrincipalOf(req),
      userId: req.body.user_id,
      vote: vote as 1 | -1,
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.delete('/:id/feedback', async (req, res, next) => {
  try {
    const deleted = await removeFeedback({
      lessonId: String(req.params.id),
      actingPrincipalId: callerPrincipalOf(req),
      userId: String(req.query.user_id ?? req.body?.user_id ?? ''),
    });
    if (!deleted) { res.status(404).json({ status: 'error', error: 'feedback not found' }); return; }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

// ── Bookmarks: /api/bookmarks ──

const bookmarkRouter = Router();

bookmarkRouter.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listBookmarks({
      userId: req.query.user_id as string,
      projectId,
      actingPrincipalId: callerPrincipalOf(req),
    });
    res.json(result);
  } catch (e) { next(e); }
});

bookmarkRouter.post('/', async (req, res, next) => {
  try {
    const result = await addBookmark({
      userId: req.body.user_id,
      lessonId: req.body.lesson_id,
      actingPrincipalId: callerPrincipalOf(req),
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

bookmarkRouter.delete('/', async (req, res, next) => {
  try {
    const deleted = await removeBookmark({
      userId: (req.query.user_id as string) ?? req.body?.user_id,
      lessonId: (req.query.lesson_id as string) ?? req.body?.lesson_id,
      actingPrincipalId: callerPrincipalOf(req),
    });
    if (!deleted) { res.status(404).json({ status: 'error', error: 'bookmark not found' }); return; }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

export { router as collaborationRouter, bookmarkRouter };
