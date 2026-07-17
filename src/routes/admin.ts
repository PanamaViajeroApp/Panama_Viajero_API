import { Hono } from 'hono'
import { requireAuth, requirePermission } from '../middleware/auth'
import type { AppEnv } from '../types'

const admin = new Hono<AppEnv>()

admin.use('*', requireAuth)

admin.get(
  '/users',
  requirePermission('manage_users'),
  async (context) => {
    const result = await context.env.DB
      .prepare(`
        SELECT
          u.id,
          u.username,
          u.account_type,
          u.must_change_password,
          u.last_login_at,
          u.created_at,
          p.create_draft,
          p.edit_draft,
          p.edit_published,
          p.delete_site,
          p.publish,
          p.manage_users,
          p.manage_permissions
        FROM users u
        LEFT JOIN user_permissions p ON p.user_id = u.id
        WHERE u.deleted_at IS NULL
        ORDER BY u.created_at ASC
      `)
      .all()

    return context.json({
      ok: true,
      users: result.results,
    })
  },
)

export default admin
