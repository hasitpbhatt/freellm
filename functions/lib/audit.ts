// Admin audit log: immutable trail for sensitive admin actions.
// Every entry must include: admin_id, action, target_type, target_id, justification.

import { newId } from './crypto'
import type { Bindings } from './types'

export type AuditAction =
  | 'vault_reveal'           // admin revealed a user's BYOK key (api_key)
  | 'pool_key_reveal'        // admin revealed a pool upstream key
  | 'model_provider_reveal'  // admin revealed a model provider's pool keys
  | 'user_impersonate'       // admin impersonated a user
  | 'config_change'          // admin changed critical config (future)
  | 'role_change';           // admin changed user role (future)

export type AuditTargetType =
  | 'connection'             // freellm_connections row
  | 'upstream_key'           // freellm_upstream_keys row
  | 'upstream_provider'      // freellm_upstream_providers row (all keys revealed)
  | 'model_provider'         // freellm_model_providers row (pool keys revealed)
  | 'user';                  // freellm_users row

export interface AuditLogEntry {
  admin_id: string
  action: AuditAction
  target_type: AuditTargetType
  target_id: string
  justification: string
  ip?: string
  user_agent?: string
}

/**
 * Writes an audit log entry. Best-effort: failure must not block the primary action.
 * Call AFTER the primary action succeeds, so the audit log reflects actual state.
 */
export async function writeAuditLog(
  env: Bindings,
  entry: AuditLogEntry,
): Promise<void> {
  const id = newId()
  const timestamp = Date.now()
  await env.DB
    .prepare(
      `INSERT INTO freellm_admin_audit_log (id, admin_id, action, target_type, target_id, justification, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      entry.admin_id,
      entry.action,
      entry.target_type,
      entry.target_id,
      entry.justification,
      entry.ip ?? null,
      entry.user_agent ?? null,
      timestamp,
    )
    .run()
    .catch((err) => {
      // Never throw — audit log failure must not block the primary operation.
      // Log to console for operator visibility.
      console.error('[audit] write failed:', err instanceof Error ? err.message : err)
    })
}

/**
 * Helper to extract client info from request for audit context.
 */
export function getClientInfo(c: { req: { header: (name: string) => string | undefined } }): {
  ip: string
  user_agent: string
} {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
  const user_agent = c.req.header('user-agent') ?? 'unknown'
  return { ip, user_agent }
}

/**
 * Validates that a justification string is present and reasonable.
 * Returns error message if invalid, null if valid.
 */
export function validateJustification(justification: unknown): string | null {
  const j = typeof justification === 'string' ? justification.trim() : ''
  if (!j) return 'Justification is required for this action.'
  if (j.length < 10) return 'Justification must be at least 10 characters.'
  if (j.length > 1000) return 'Justification must be at most 1000 characters.'
  return null
}