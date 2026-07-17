import type { MiddlewareHandler } from 'hono'
import type { AppEnv, PermissionKey } from '../types'
import { getSessionUser } from '../lib/session'

export const requireAuth: MiddlewareHandler<AppEnv> = async (
  context,
  next,
) => {
  const authUser = await getSessionUser(context)

  if (!authUser) {
    return context.json({
      ok: false,
      error: 'Authentication required',
    }, 401)
  }

  context.set('authUser', authUser)
  await next()
}

export const requireCompletedPasswordChange: MiddlewareHandler<AppEnv> = async (
  context,
  next,
) => {
  const authUser = context.get('authUser')

  if (authUser.mustChangePassword) {
    return context.json({
      ok: false,
      error: 'Password change required',
      code: 'PASSWORD_CHANGE_REQUIRED',
    }, 403)
  }

  await next()
}

export function requirePermission(
  permission: PermissionKey,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authUser = context.get('authUser')

    if (!authUser.permissions[permission]) {
      return context.json({
        ok: false,
        error: 'Insufficient permissions',
        permission,
      }, 403)
    }

    await next()
  }
}

export function requireAnyPermission(
  permissions: PermissionKey[],
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authUser = context.get('authUser')

    if (!permissions.some((permission) => authUser.permissions[permission])) {
      return context.json({
        ok: false,
        error: 'Insufficient permissions',
        permissions,
      }, 403)
    }

    await next()
  }
}
