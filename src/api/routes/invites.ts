/**
 * Actor Data Boundary F-AUTH (Stream S3) — admin invite issuance.
 *
 * MOUNT (recorded for the integrator — §2.1): `app.use('/api/invites', invitesRouter)` AFTER the
 * blanket bearerAuth/sessionAuth gate (admin-only; an authenticated principal is required). The
 * register/accept flow lives on the PUBLIC /api/auth/register (auth.ts), not here.
 *
 *   POST /api/invites  (admin) — issue a single-use invite; returns the plaintext token ONCE.
 */

import { Router } from 'express';
import { assertAuthorized } from '../../services/authorize.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { issueInvite } from '../../services/invites.js';
import { ContextHubError } from '../../core/errors.js';

const router = Router();

/** POST /api/invites — admin issues an invite. The issuing principal is the delegation origin for any
 *  starter grant, so it must be a real authenticated principal (not the env-token fast-path). */
router.post('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const issuer = callerPrincipalOf(req);
    if (!issuer) {
      // Admin via the legacy env-token / auth-off has no principal id to attribute the invite + any
      // starter grant to. Issuing an invite (which can seed grants) requires a concrete issuer.
      throw new ContextHubError('BAD_REQUEST', 'Issuing an invite requires an authenticated principal (not the env-token fast-path).');
    }
    const { email, display_name, intended_kind, grant_template } = req.body ?? {};
    const invite = await issueInvite({
      email,
      createdBy: issuer,
      display_name: typeof display_name === 'string' ? display_name : undefined,
      intended_kind: intended_kind === 'agent' ? 'agent' : 'human',
      grant_template,
    });
    res.status(201).json({ status: 'created', invite_id: invite.invite_id, token: invite.token, email: invite.email, expires_at: invite.expires_at });
  } catch (e) { next(e); }
});

export { router as invitesRouter };
