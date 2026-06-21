/**
 * Actor Data Boundary S1 — /api/bootstrap (first-run wizard REST). **PRE-AUTH.**
 *
 * This router is mounted BEFORE the bearerAuth blanket gate (src/api/index.ts:101) — it must be
 * reachable with NO Authorization header, because it is what establishes the very first credential
 * (the chicken-and-egg of a fresh deployment). It is NOT ungated: every state-changing route requires
 * the deployment's ROOT_BOOTSTRAP_TOKEN (proof of out-of-band possession of the deployment secret),
 * exactly as the bootstrapRoot service already demands. `GET /status` is a safe read (no secret
 * revealed) but is ALSO token-gated to avoid a recon oracle on a public deployment.
 *
 * Endpoints (3-step first-run wizard):
 *   - GET  /status   → is root established? is a usable credential present? is the deployment
 *                      enforce-ready? (the wizard drives off this)
 *   - POST /root      → bootstrapRoot (seed root + mint the root credential, shown once)
 *   - POST /operator  → create the human operator principal (the daily login is NOT root)
 *   - POST /enforce    → assertEnforceReady (the lockout guard) — confirms the flip is SAFE before the
 *                      operator flips MCP_AUTH_ENABLED out-of-band.
 *
 * Mount `/api/bootstrap` BEFORE bearerAuth, ROOT_BOOTSTRAP_TOKEN-gated (recorded for the integrator).
 */

import { Router, type Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  bootstrapRoot,
  assertEnforceReady,
  hasUsableRootCredential,
} from '../../services/bootstrap.js';
import { getRootPrincipal, createPrincipal } from '../../services/principals.js';
import { getEnv } from '../../core/index.js';
import { ContextHubError } from '../../core/errors.js';

const router = Router();

/** Constant-time, length-independent secret comparison (mirrors bootstrap.ts secretsMatch). */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Read the presented bootstrap token from the request: Authorization: Bearer <token> OR an
 * `X-Bootstrap-Token` header OR a `token` body field. Returns '' when absent.
 */
function presentedToken(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const hdr = req.headers['x-bootstrap-token'];
  if (typeof hdr === 'string' && hdr.length > 0) return hdr;
  const body = (req.body ?? {}) as { token?: unknown };
  return typeof body.token === 'string' ? body.token : '';
}

/**
 * Assert the request carries the configured ROOT_BOOTSTRAP_TOKEN. Throws a typed ContextHubError on
 * any failure (no configured token → BAD_REQUEST; missing/invalid presented token → UNAUTHORIZED).
 * Shared by every bootstrap route so the pre-auth surface is uniformly token-gated.
 */
function assertBootstrapToken(req: Request): void {
  const configured = getEnv().ROOT_BOOTSTRAP_TOKEN;
  if (!configured) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'ROOT_BOOTSTRAP_TOKEN is not configured; set it in the environment before bootstrapping.',
    );
  }
  const presented = presentedToken(req);
  if (presented.length === 0) {
    throw new ContextHubError('UNAUTHORIZED', 'bootstrap token required.');
  }
  if (!secretsMatch(presented, configured)) {
    throw new ContextHubError('UNAUTHORIZED', 'invalid bootstrap token.');
  }
}

/** GET /api/bootstrap/status — first-run wizard state. Token-gated (recon oracle guard). */
router.get('/status', async (req, res, next) => {
  try {
    assertBootstrapToken(req);
    const root = await getRootPrincipal();
    const hasRoot = root !== null;
    const hasCredential = hasRoot ? await hasUsableRootCredential() : false;
    let enforceReady = false;
    let enforceBlocker: string | null = null;
    try {
      await assertEnforceReady();
      enforceReady = true;
    } catch (e) {
      enforceBlocker = e instanceof ContextHubError ? e.message : 'not enforce-ready';
    }
    res.json({
      has_root: hasRoot,
      root_principal_id: root?.principal_id ?? null,
      has_usable_credential: hasCredential,
      enforce_ready: enforceReady,
      enforce_blocker: enforceBlocker,
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/bootstrap/root — establish the root of trust + mint the root credential (shown once).
 * Body: { display_name? }. Token-gated (bootstrapRoot re-validates the token defensively too).
 */
router.post('/root', async (req, res, next) => {
  try {
    assertBootstrapToken(req);
    const { display_name } = (req.body ?? {}) as { display_name?: string };
    const result = await bootstrapRoot({
      presentedToken: presentedToken(req),
      display_name: typeof display_name === 'string' ? display_name : undefined,
    });
    // The key is present only on created/reissued; never on noop.
    res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (e) { next(e); }
});

/**
 * POST /api/bootstrap/operator — create the human operator principal (the daily login; NOT root).
 * Body: { display_name }. The actual login credential / password is established by F-AUTH (S3); this
 * step only seeds the principal so the operator account exists at first-run. Token-gated.
 */
router.post('/operator', async (req, res, next) => {
  try {
    assertBootstrapToken(req);
    // Root must exist first — the operator is created against an established trust anchor.
    if (!(await getRootPrincipal())) {
      throw new ContextHubError('CONFLICT', 'establish root first (POST /api/bootstrap/root).');
    }
    const { display_name } = (req.body ?? {}) as { display_name?: string };
    if (!display_name || typeof display_name !== 'string') {
      res.status(400).json({ error: 'display_name is required' });
      return;
    }
    const principal = await createPrincipal({ kind: 'human', display_name });
    res.status(201).json({ status: 'created', principal });
  } catch (e) { next(e); }
});

/**
 * POST /api/bootstrap/enforce — the enforce-ready (lockout) guard. Returns 200 + the root principal
 * id when the deployment is SAFE to flip MCP_AUTH_ENABLED on; a 409 CONFLICT (with the blocker
 * message) otherwise. Does NOT flip the flag (that is an out-of-band env change) — it confirms the
 * flip cannot lock the operator out. Token-gated.
 */
router.post('/enforce', async (req, res, next) => {
  try {
    assertBootstrapToken(req);
    const root = await assertEnforceReady();
    res.json({ status: 'enforce_ready', root_principal_id: root.principal_id });
  } catch (e) { next(e); }
});

export { router as bootstrapRouter };
