import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, AuthUser, PermissionKey } from '../types'
import { createSecureToken, hashToken } from './crypto'

const sessionCookieName = 'pv_admin_session'

type SessionRow = {
  session_id: string
  user_id: string
  username: string
  account_type: AuthUser['accountType']
  must_change_password: number
  create_draft: number | null
  edit_draft: number | null
  edit_published: number | null
  delete_site: number | null
  publish: number | null
  manage_users: number | null
  manage_permissions: number | null
}

function getSessionTtl(context: Context<AppEnv>): number {
  const configuredTtl = Number(context.env.SESSION_TTL_SECONDS)
  return Number.isFinite(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : 28_800
}

function getCookieOptions(context: Context<AppEnv>) {
  const production = context.env.ENVIRONMENT === 'production'

  return {
    path: '/',
    httpOnly: true,
    secure: production,
    sameSite: production ? 'None' as const : 'Lax' as const,
    maxAge: getSessionTtl(context),
  }
}

function permissionsFromRow(row: SessionRow): Record<PermissionKey, boolean> {
  return {
    create_draft: row.create_draft === 1,
    edit_draft: row.edit_draft === 1,
    edit_published: row.edit_published === 1,
    delete_site: row.delete_site === 1,
    publish: row.publish === 1,
    manage_users: row.manage_users === 1,
    manage_permissions: row.manage_permissions === 1,
  }
}

export async function createSession(
  context: Context<AppEnv>,
  userId: string,
): Promise<void> {
  const token = createSecureToken()
  const tokenHash = await hashToken(token)
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + getSessionTtl(context) * 1000)

  await context.env.DB
    .prepare(`
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        expires_at
      ) VALUES (?, ?, ?, ?)
    `)
    .bind(sessionId, userId, tokenHash, expiresAt.toISOString())
    .run()

  setCookie(
    context,
    sessionCookieName,
    token,
    getCookieOptions(context),
  )
}

export async function getSessionUser(
  context: Context<AppEnv>,
): Promise<AuthUser | null> {
  const token = getCookie(context, sessionCookieName)
  if (!token) return null

  const tokenHash = await hashToken(token)
  const now = new Date()
  const row = await context.env.DB
    .prepare(`
      SELECT
        s.id AS session_id,
        u.id AS user_id,
        u.username,
        u.account_type,
        u.must_change_password,
        p.create_draft,
        p.edit_draft,
        p.edit_published,
        p.delete_site,
        p.publish,
        p.manage_users,
        p.manage_permissions
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      LEFT JOIN user_permissions p ON p.user_id = u.id
      WHERE
        s.token_hash = ?
        AND s.expires_at > ?
        AND u.deleted_at IS NULL
      LIMIT 1
    `)
    .bind(tokenHash, now.toISOString())
    .first<SessionRow>()

  if (!row) {
    deleteCookie(context, sessionCookieName, { path: '/' })
    return null
  }

  const nextExpiration = new Date(
    now.getTime() + getSessionTtl(context) * 1000,
  )

  await context.env.DB
    .prepare(`
      UPDATE sessions
      SET
        last_active_at = ?,
        expires_at = ?
      WHERE id = ?
    `)
    .bind(now.toISOString(), nextExpiration.toISOString(), row.session_id)
    .run()

  setCookie(
    context,
    sessionCookieName,
    token,
    getCookieOptions(context),
  )

  return {
    id: row.user_id,
    username: row.username,
    accountType: row.account_type,
    mustChangePassword: row.must_change_password === 1,
    sessionId: row.session_id,
    permissions: permissionsFromRow(row),
  }
}

export async function destroySession(
  context: Context<AppEnv>,
): Promise<void> {
  const token = getCookie(context, sessionCookieName)

  if (token) {
    const tokenHash = await hashToken(token)
    await context.env.DB
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
  }

  deleteCookie(context, sessionCookieName, { path: '/' })
}
