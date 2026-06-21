/**
 * Actor Data Boundary F-AUTH (Stream S3) — invites (the only path to a new human principal).
 *
 * There is NO open self-signup. An admin/root issues an invite (out-of-band token, hash-only storage,
 * short TTL, single-use). `acceptInvite` = the register flow: it creates a `human` principal, sets the
 * password credential, and (optionally) applies a subtree-bounded starter grant from the invite
 * template. Single-use is enforced atomically (accepted_at guard in the consuming UPDATE).
 *
 * The starter grant is granted_by the invite's CREATOR (the admin who issued it), preserving the
 * delegation-tree origin — never granted_by the new principal itself (no self-grant).
 */

import { createHash, randomBytes } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { hashPassword } from './passwordCredentials.js';
import { SCOPE_TYPES, CAPABILITIES, type ScopeType, type Capability } from './grants.js';

function intEnv(key: string, dflt: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface GrantTemplate {
  scope_type: ScopeType;
  scope_id: string | null;
  capability: Capability;
}

function validateGrantTemplate(t: unknown): GrantTemplate | null {
  if (t === null || t === undefined) return null;
  if (typeof t !== 'object') throw new ContextHubError('BAD_REQUEST', 'grant_template must be an object.');
  const obj = t as Record<string, unknown>;
  if (!SCOPE_TYPES.includes(obj.scope_type as ScopeType)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid grant_template.scope_type. Allowed: ${SCOPE_TYPES.join(', ')}.`);
  }
  if (!CAPABILITIES.includes(obj.capability as Capability)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid grant_template.capability. Allowed: ${CAPABILITIES.join(', ')}.`);
  }
  // A starter grant must NOT be global (escalation guard) — invites seed bounded access only.
  if (obj.scope_type === 'global') {
    throw new ContextHubError('BAD_REQUEST', 'grant_template may not be a global grant; invites seed subtree-bounded access only.');
  }
  return {
    scope_type: obj.scope_type as ScopeType,
    scope_id: typeof obj.scope_id === 'string' ? obj.scope_id : null,
    capability: obj.capability as Capability,
  };
}

export interface IssuedInvite {
  invite_id: string;
  /** The plaintext token — returned ONCE to the issuer to convey out-of-band. */
  token: string;
  email: string;
  expires_at: string;
}

/** Issue an invite. `createdBy` MUST be the admin principal id (the delegation origin for any starter
 *  grant). The plaintext token is returned once; only its hash is stored. */
export async function issueInvite(params: {
  email: string;
  createdBy: string;
  display_name?: string;
  intended_kind?: 'human' | 'agent';
  grant_template?: unknown;
  ttlSeconds?: number;
}): Promise<IssuedInvite> {
  if (typeof params.email !== 'string' || !params.email.includes('@')) {
    throw new ContextHubError('BAD_REQUEST', 'A valid email is required.');
  }
  if (!isUuid(params.createdBy)) {
    throw new ContextHubError('BAD_REQUEST', 'issueInvite requires the issuing principal id.');
  }
  const kind = params.intended_kind ?? 'human';
  if (kind !== 'human' && kind !== 'agent') {
    throw new ContextHubError('BAD_REQUEST', 'intended_kind must be human or agent.');
  }
  const template = validateGrantTemplate(params.grant_template);
  const token = randomBytes(32).toString('base64url');
  const ttl = params.ttlSeconds ?? intEnv('AUTH_INVITE_TTL_SECONDS', 7 * 24 * 3600);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const res = await getDbPool().query<{ invite_id: string; expires_at: Date }>(
    `INSERT INTO invites (token_hash, email, intended_kind, display_name, grant_template, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING invite_id, expires_at`,
    [hashToken(token), params.email.trim(), kind, params.display_name ?? null, template ? JSON.stringify(template) : null, params.createdBy, expiresAt],
  );
  return { invite_id: res.rows[0].invite_id, token, email: params.email.trim(), expires_at: res.rows[0].expires_at.toISOString() };
}

export interface AcceptedInvite {
  principal_id: string;
  display_name: string;
  email: string;
}

/**
 * Accept an invite = register. Atomic single-use: the invite is consumed in a transaction; if it was
 * already accepted/expired the whole thing rolls back and nothing is created. Creates a human
 * principal, sets its password, and applies the starter grant (if any), granted_by the invite creator.
 */
export async function acceptInvite(params: { token: string; password: string; display_name?: string }): Promise<AcceptedInvite> {
  if (typeof params.token !== 'string' || params.token.length === 0) {
    throw new ContextHubError('BAD_REQUEST', 'Invite token is required.');
  }
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Consume the invite ATOMICALLY: only a live, unaccepted, unexpired invite matches; stamp accepted_at.
    const inv = await client.query<{ invite_id: string; email: string; intended_kind: string; display_name: string | null; grant_template: GrantTemplate | null; created_by: string | null }>(
      `UPDATE invites SET accepted_at = now()
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        RETURNING invite_id, email, intended_kind, display_name, grant_template, created_by`,
      [hashToken(params.token)],
    );
    if (inv.rowCount === 0) {
      throw new ContextHubError('BAD_REQUEST', 'Invite is invalid, already used, or expired.');
    }
    const invite = inv.rows[0];
    const displayName = params.display_name?.trim() || invite.display_name?.trim() || invite.email;

    // Create the principal within the same txn so a password-policy failure rolls back the consume.
    const pres = await client.query<{ principal_id: string }>(
      `INSERT INTO principals (kind, status, display_name, is_root) VALUES ($1, 'active', $2, false) RETURNING principal_id`,
      [invite.intended_kind, displayName],
    );
    const principalId = pres.rows[0].principal_id;

    // Password (validates policy; throws BAD_REQUEST → rollback). Inlined INSERT so it shares the txn.
    const hash = await hashPassword(params.password);
    await client.query(
      `INSERT INTO human_credentials (principal_id, password_hash) VALUES ($1, $2)`,
      [principalId, hash],
    );

    // Starter grant (optional), granted_by the issuing admin — preserves delegation origin.
    if (invite.grant_template && invite.created_by) {
      await client.query(
        `INSERT INTO grants (grantee_principal, scope_type, scope_id, capability, granted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (grantee_principal, scope_type, scope_id, capability) WHERE revoked_at IS NULL DO NOTHING`,
        [principalId, invite.grant_template.scope_type, invite.grant_template.scope_id, invite.grant_template.capability, invite.created_by],
      );
    }

    await client.query(`UPDATE invites SET accepted_principal = $2 WHERE invite_id = $1`, [invite.invite_id, principalId]);
    await client.query('COMMIT');
    return { principal_id: principalId, display_name: displayName, email: invite.email };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
