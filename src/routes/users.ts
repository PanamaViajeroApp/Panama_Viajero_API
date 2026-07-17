import { Hono } from 'hono'
import { hashPassword } from '../lib/crypto'
import {
  requireAnyPermission,
  requirePermission,
} from '../middleware/auth'
import type { AppEnv, AuthUser, PermissionKey } from '../types'

const users = new Hono<AppEnv>()

const editablePermissionKeys = [
  'create_draft',
  'edit_draft',
  'edit_published',
  'delete_site',
  'publish',
] as const satisfies PermissionKey[]

type EditablePermissionKey = typeof editablePermissionKeys[number]

type UserRow = {
  id: string
  username: string
  account_type: AuthUser['accountType']
  must_change_password: number
  last_login_at: string | null
  created_at: string
  deleted_at: string | null
  create_draft: number | null
  edit_draft: number | null
  edit_published: number | null
  delete_site: number | null
  publish: number | null
  manage_users: number | null
  manage_permissions: number | null
}

type CreateUserBody = {
  username?: string
  temporaryPassword?: string
  accountType?: string
}

type PermissionBody = Partial<Record<EditablePermissionKey, unknown>>

function passwordIsValid(password: string): boolean {
  return password.length >= 12 && password.length <= 128
}

function usernameIsValid(username: string): boolean {
  return (
    username.length >= 3
    && username.length <= 64
    && /^[\p{L}\p{N}._-]+$/u.test(username)
  )
}

function permissionValue(value: number | null): boolean {
  return value === 1
}

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    accountType: row.account_type,
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    permissions: {
      create_draft: permissionValue(row.create_draft),
      edit_draft: permissionValue(row.edit_draft),
      edit_published: permissionValue(row.edit_published),
      delete_site: permissionValue(row.delete_site),
      publish: permissionValue(row.publish),
      manage_users: permissionValue(row.manage_users),
      manage_permissions: permissionValue(row.manage_permissions),
    },
  }
}

function userSelect(whereClause = ''): string {
  return `
    SELECT
      u.id,
      u.username,
      u.account_type,
      u.must_change_password,
      u.last_login_at,
      u.created_at,
      u.deleted_at,
      p.create_draft,
      p.edit_draft,
      p.edit_published,
      p.delete_site,
      p.publish,
      p.manage_users,
      p.manage_permissions
    FROM users u
    LEFT JOIN user_permissions p ON p.user_id = u.id
    ${whereClause}
  `
}

async function getUserById(
  database: D1Database,
  userId: string,
): Promise<UserRow | null> {
  return database
    .prepare(`${userSelect('WHERE u.id = ?')} LIMIT 1`)
    .bind(userId)
    .first<UserRow>()
}

function defaultPermissions(accountType: AuthUser['accountType']) {
  const coAdministrator = accountType === 'co_administrator'

  return {
    create_draft: coAdministrator ? 1 : 0,
    edit_draft: 1,
    edit_published: coAdministrator ? 1 : 0,
    delete_site: coAdministrator ? 1 : 0,
    publish: coAdministrator ? 1 : 0,
    manage_users: coAdministrator ? 1 : 0,
    manage_permissions: coAdministrator ? 1 : 0,
  }
}

users.get(
  '/',
  requireAnyPermission(['manage_users', 'manage_permissions']),
  async (context) => {
    const result = await context.env.DB
      .prepare(`
        ${userSelect('WHERE u.deleted_at IS NULL')}
        ORDER BY
          CASE u.account_type
            WHEN 'administrator' THEN 0
            WHEN 'co_administrator' THEN 1
            ELSE 2
          END,
          u.created_at ASC
      `)
      .all<UserRow>()

    return context.json({
      ok: true,
      users: result.results.map(serializeUser),
    })
  },
)

users.post(
  '/',
  requirePermission('manage_users'),
  async (context) => {
    const body = await context.req.json<CreateUserBody>().catch(() => null)
    const username = body?.username?.trim() || ''
    const temporaryPassword = body?.temporaryPassword || ''
    const accountType = body?.accountType

    if (!usernameIsValid(username)) {
      return context.json({
        ok: false,
        error: 'Username must contain 3 to 64 valid characters',
      }, 400)
    }

    if (!passwordIsValid(temporaryPassword)) {
      return context.json({
        ok: false,
        error: 'Temporary password must contain between 12 and 128 characters',
      }, 400)
    }

    if (accountType !== 'user' && accountType !== 'co_administrator') {
      return context.json({
        ok: false,
        error: 'Invalid account type',
      }, 400)
    }

    const existingUser = await context.env.DB
      .prepare(`
        SELECT id, deleted_at
        FROM users
        WHERE username = ? COLLATE NOCASE
        LIMIT 1
      `)
      .bind(username)
      .first<{ id: string; deleted_at: string | null }>()

    if (existingUser && !existingUser.deleted_at) {
      return context.json({
        ok: false,
        error: 'Username already exists',
      }, 409)
    }

    const userId = existingUser?.id || crypto.randomUUID()
    const passwordHash = await hashPassword(temporaryPassword)
    const now = new Date().toISOString()
    const permissions = defaultPermissions(accountType)
    const userStatement = existingUser
      ? context.env.DB
        .prepare(`
          UPDATE users
          SET
            username = ?,
            password_hash = ?,
            account_type = ?,
            must_change_password = 1,
            last_login_at = NULL,
            updated_at = ?,
            deleted_at = NULL
          WHERE id = ?
        `)
        .bind(username, passwordHash, accountType, now, userId)
      : context.env.DB
        .prepare(`
          INSERT INTO users (
            id,
            username,
            password_hash,
            account_type,
            must_change_password,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
        `)
        .bind(
          userId,
          username,
          passwordHash,
          accountType,
          now,
          now,
        )

    await context.env.DB.batch([
      userStatement,
      context.env.DB
        .prepare(`
          INSERT INTO user_permissions (
            user_id,
            create_draft,
            edit_draft,
            edit_published,
            delete_site,
            publish,
            manage_users,
            manage_permissions,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            create_draft = excluded.create_draft,
            edit_draft = excluded.edit_draft,
            edit_published = excluded.edit_published,
            delete_site = excluded.delete_site,
            publish = excluded.publish,
            manage_users = excluded.manage_users,
            manage_permissions = excluded.manage_permissions,
            updated_at = excluded.updated_at
        `)
        .bind(
          userId,
          permissions.create_draft,
          permissions.edit_draft,
          permissions.edit_published,
          permissions.delete_site,
          permissions.publish,
          permissions.manage_users,
          permissions.manage_permissions,
          now,
        ),
      context.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(userId),
    ])

    const user = await getUserById(context.env.DB, userId)
    return context.json({ ok: true, user: serializeUser(user!) }, 201)
  },
)

users.patch(
  '/:userId/permissions',
  requirePermission('manage_permissions'),
  async (context) => {
    const targetUser = await getUserById(
      context.env.DB,
      context.req.param('userId'),
    )

    if (!targetUser || targetUser.deleted_at) {
      return context.json({ ok: false, error: 'User not found' }, 404)
    }

    if (targetUser.account_type === 'administrator') {
      return context.json({
        ok: false,
        error: 'Administrator permissions are protected',
      }, 403)
    }

    const body = await context.req
      .json<{ permissions?: PermissionBody }>()
      .catch(() => null)
    const submittedPermissions = body?.permissions

    if (!submittedPermissions) {
      return context.json({
        ok: false,
        error: 'Permissions are required',
      }, 400)
    }

    for (const key of editablePermissionKeys) {
      if (
        Object.prototype.hasOwnProperty.call(submittedPermissions, key)
        && typeof submittedPermissions[key] !== 'boolean'
      ) {
        return context.json({
          ok: false,
          error: `Permission ${key} must be boolean`,
        }, 400)
      }
    }

    const currentPermissions = {
      create_draft: permissionValue(targetUser.create_draft),
      edit_draft: permissionValue(targetUser.edit_draft),
      edit_published: permissionValue(targetUser.edit_published),
      delete_site: permissionValue(targetUser.delete_site),
      publish: permissionValue(targetUser.publish),
    }
    const nextPermissions = editablePermissionKeys.reduce(
      (result, key) => ({
        ...result,
        [key]: Object.prototype.hasOwnProperty.call(submittedPermissions, key)
          ? submittedPermissions[key] === true
          : currentPermissions[key],
      }),
      {} as Record<EditablePermissionKey, boolean>,
    )
    const coAdministrator = targetUser.account_type === 'co_administrator'
    const now = new Date().toISOString()

    await context.env.DB
      .prepare(`
        INSERT INTO user_permissions (
          user_id,
          create_draft,
          edit_draft,
          edit_published,
          delete_site,
          publish,
          manage_users,
          manage_permissions,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          create_draft = excluded.create_draft,
          edit_draft = excluded.edit_draft,
          edit_published = excluded.edit_published,
          delete_site = excluded.delete_site,
          publish = excluded.publish,
          manage_users = excluded.manage_users,
          manage_permissions = excluded.manage_permissions,
          updated_at = excluded.updated_at
      `)
      .bind(
        targetUser.id,
        nextPermissions.create_draft ? 1 : 0,
        nextPermissions.edit_draft ? 1 : 0,
        nextPermissions.edit_published ? 1 : 0,
        nextPermissions.delete_site ? 1 : 0,
        nextPermissions.publish ? 1 : 0,
        coAdministrator ? 1 : 0,
        coAdministrator ? 1 : 0,
        now,
      )
      .run()

    const user = await getUserById(context.env.DB, targetUser.id)
    return context.json({ ok: true, user: serializeUser(user!) })
  },
)

users.delete(
  '/:userId',
  requirePermission('manage_users'),
  async (context) => {
    const authUser = context.get('authUser')
    const targetUser = await getUserById(
      context.env.DB,
      context.req.param('userId'),
    )

    if (!targetUser || targetUser.deleted_at) {
      return context.json({ ok: false, error: 'User not found' }, 404)
    }

    if (targetUser.account_type === 'administrator') {
      return context.json({
        ok: false,
        error: 'Administrator cannot be deleted',
      }, 403)
    }

    if (targetUser.id === authUser.id) {
      return context.json({
        ok: false,
        error: 'You cannot delete your own user',
      }, 409)
    }

    const now = new Date().toISOString()
    await context.env.DB.batch([
      context.env.DB
        .prepare(`
          UPDATE users
          SET
            deleted_at = ?,
            updated_at = ?
          WHERE id = ?
        `)
        .bind(now, now, targetUser.id),
      context.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(targetUser.id),
    ])

    return context.json({
      ok: true,
      message: 'User deleted',
    })
  },
)

export default users
