import { Hono } from 'hono'
import { hashPassword, safeEqualStrings, verifyPassword } from '../lib/crypto'
import {
  clearFailedLogins,
  getLoginBlock,
  recordFailedLogin,
} from '../lib/login-protection'
import {
  createSession,
  destroySession,
} from '../lib/session'
import { requireAuth } from '../middleware/auth'
import type { AppEnv, AuthUser, PermissionKey } from '../types'

const auth = new Hono<AppEnv>()

type LoginUserRow = {
  id: string
  username: string
  password_hash: string
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

function passwordIsValid(password: string): boolean {
  return password.length >= 12 && password.length <= 128
}

function permissionsFromRow(
  row: LoginUserRow,
): Record<PermissionKey, boolean> {
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

auth.use('*', async (context, next) => {
  await next()
  context.header('Cache-Control', 'no-store')
})

auth.post('/bootstrap', async (context) => {
  const configuredSecret = context.env.BOOTSTRAP_SECRET
  const providedSecret = context.req.header('X-Bootstrap-Secret') || ''

  if (
    !configuredSecret
    || !(await safeEqualStrings(providedSecret, configuredSecret))
  ) {
    return context.json({
      ok: false,
      error: 'Invalid bootstrap credentials',
    }, 403)
  }

  const body = await context.req.json<{ password?: string }>().catch(() => null)
  const password = body?.password || ''

  if (!passwordIsValid(password)) {
    return context.json({
      ok: false,
      error: 'Password must contain between 12 and 128 characters',
    }, 400)
  }

  const existingAdministrator = await context.env.DB
    .prepare(`
      SELECT id, password_hash
      FROM users
      WHERE account_type = 'administrator'
      LIMIT 1
    `)
    .first<{ id: string; password_hash: string }>()

  if (
    existingAdministrator
    && existingAdministrator.password_hash.startsWith('pbkdf2-sha256$')
  ) {
    return context.json({
      ok: false,
      error: 'Administrator already configured',
    }, 409)
  }

  const administratorId = existingAdministrator?.id || crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const administratorStatement = existingAdministrator
    ? context.env.DB
      .prepare(`
        UPDATE users
        SET
          username = 'Administrador',
          password_hash = ?,
          account_type = 'administrator',
          must_change_password = 1,
          deleted_at = NULL,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(passwordHash, new Date().toISOString(), administratorId)
    : context.env.DB
      .prepare(`
        INSERT INTO users (
          id,
          username,
          password_hash,
          account_type,
          must_change_password
        ) VALUES (?, 'Administrador', ?, 'administrator', 1)
      `)
      .bind(administratorId, passwordHash)
  const permissionStatement = context.env.DB
    .prepare(`
      INSERT INTO user_permissions (
        user_id,
        create_draft,
        edit_draft,
        edit_published,
        delete_site,
        publish,
        manage_users,
        manage_permissions
      ) VALUES (?, 1, 1, 1, 1, 1, 1, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        create_draft = 1,
        edit_draft = 1,
        edit_published = 1,
        delete_site = 1,
        publish = 1,
        manage_users = 1,
        manage_permissions = 1,
        updated_at = excluded.updated_at
    `)
    .bind(administratorId)

  await context.env.DB.batch([
    administratorStatement,
    permissionStatement,
  ])

  return context.json({
    ok: true,
    message: 'Administrator configured',
    mustChangePassword: true,
  }, 201)
})

auth.post('/login', async (context) => {
  const body = await context.req
    .json<{ username?: string; password?: string }>()
    .catch(() => null)
  const username = body?.username?.trim() || ''
  const password = body?.password || ''

  if (!username || !password) {
    return context.json({
      ok: false,
      error: 'Invalid username or password',
    }, 401)
  }

  const loginBlock = await getLoginBlock(context, username)

  if (loginBlock.blocked) {
    context.header('Retry-After', String(loginBlock.retryAfterSeconds))
    return context.json({
      ok: false,
      error: 'Too many login attempts',
      retryAfterSeconds: loginBlock.retryAfterSeconds,
    }, 429)
  }

  const user = await context.env.DB
    .prepare(`
      SELECT
        u.id,
        u.username,
        u.password_hash,
        u.account_type,
        u.must_change_password,
        p.create_draft,
        p.edit_draft,
        p.edit_published,
        p.delete_site,
        p.publish,
        p.manage_users,
        p.manage_permissions
      FROM users u
      LEFT JOIN user_permissions p ON p.user_id = u.id
      WHERE
        u.username = ? COLLATE NOCASE
        AND u.deleted_at IS NULL
      LIMIT 1
    `)
    .bind(username)
    .first<LoginUserRow>()
  const passwordMatches = user?.password_hash.startsWith('pbkdf2-sha256$')
    ? await verifyPassword(password, user.password_hash)
    : false

  if (!user || !passwordMatches) {
    if (!user || !user.password_hash.startsWith('pbkdf2-sha256$')) {
      await hashPassword(password)
    }

    await recordFailedLogin(context, username)

    return context.json({
      ok: false,
      error: 'Invalid username or password',
    }, 401)
  }

  await Promise.all([
    clearFailedLogins(context, username),
    context.env.DB
      .prepare(`
        UPDATE users
        SET
          last_login_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        new Date().toISOString(),
        new Date().toISOString(),
        user.id,
      )
      .run(),
    context.env.DB
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .bind(new Date().toISOString())
      .run(),
  ])

  await createSession(context, user.id)

  return context.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      accountType: user.account_type,
      mustChangePassword: user.must_change_password === 1,
      permissions: permissionsFromRow(user),
    },
  })
})

auth.get('/me', requireAuth, (context) => {
  const authUser = context.get('authUser')

  return context.json({
    ok: true,
    user: {
      id: authUser.id,
      username: authUser.username,
      accountType: authUser.accountType,
      mustChangePassword: authUser.mustChangePassword,
      permissions: authUser.permissions,
    },
  })
})

auth.post('/change-password', requireAuth, async (context) => {
  const authUser = context.get('authUser')
  const body = await context.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => null)
  const currentPassword = body?.currentPassword || ''
  const newPassword = body?.newPassword || ''

  if (!passwordIsValid(newPassword)) {
    return context.json({
      ok: false,
      error: 'New password must contain between 12 and 128 characters',
    }, 400)
  }

  const user = await context.env.DB
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(authUser.id)
    .first<{ password_hash: string }>()

  if (
    !user
    || !(await verifyPassword(currentPassword, user.password_hash))
  ) {
    return context.json({
      ok: false,
      error: 'Current password is incorrect',
    }, 400)
  }

  if (await verifyPassword(newPassword, user.password_hash)) {
    return context.json({
      ok: false,
      error: 'New password must be different',
    }, 400)
  }

  const nextPasswordHash = await hashPassword(newPassword)
  const now = new Date().toISOString()

  await context.env.DB.batch([
    context.env.DB
      .prepare(`
        UPDATE users
        SET
          password_hash = ?,
          must_change_password = 0,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(nextPasswordHash, now, authUser.id),
    context.env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE user_id = ? AND id <> ?
      `)
      .bind(authUser.id, authUser.sessionId),
  ])

  return context.json({
    ok: true,
    message: 'Password updated',
  })
})

auth.post('/logout', async (context) => {
  await destroySession(context)

  return context.json({
    ok: true,
    message: 'Session closed',
  })
})

export default auth
