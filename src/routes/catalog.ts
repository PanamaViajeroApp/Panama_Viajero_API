import { Hono } from 'hono'
import { getActivityIconKey } from '../lib/activity-icons'
import { requireAnyPermission } from '../middleware/auth'
import type { AppEnv } from '../types'

const catalog = new Hono<AppEnv>()

catalog.get('/provinces', async (context) => {
  const result = await context.env.DB
    .prepare(`
      SELECT
        id,
        slug,
        name,
        zone_mode,
        supports_pacific_riviera,
        display_order
      FROM provinces
      ORDER BY display_order, name COLLATE NOCASE
    `)
    .all()

  return context.json({
    ok: true,
    provinces: result.results.map((province) => ({
      id: province.id,
      slug: province.slug,
      name: province.name,
      zoneMode: province.zone_mode,
      supportsPacificRiviera: province.supports_pacific_riviera === 1,
      displayOrder: province.display_order,
    })),
  })
})

catalog.get('/activities', async (context) => {
  const result = await context.env.DB
    .prepare(`
      SELECT id, name, icon_key, created_at, updated_at
      FROM activities
      ORDER BY name COLLATE NOCASE
    `)
    .all()

  return context.json({
    ok: true,
    activities: result.results.map((activity) => ({
      id: activity.id,
      name: activity.name,
      iconKey: activity.icon_key,
      createdAt: activity.created_at,
      updatedAt: activity.updated_at,
    })),
  })
})

catalog.post(
  '/activities',
  requireAnyPermission(['create_draft', 'edit_draft', 'edit_published']),
  async (context) => {
    const body = await context.req
      .json<{ name?: string; iconKey?: string }>()
      .catch(() => null)
    const name = body?.name?.trim() || ''

    if (name.length < 2 || name.length > 80) {
      return context.json({
        ok: false,
        error: 'Activity name must contain between 2 and 80 characters',
      }, 400)
    }

    const existingActivity = await context.env.DB
      .prepare(`
        SELECT id, name, icon_key
        FROM activities
        WHERE name = ? COLLATE NOCASE
        LIMIT 1
      `)
      .bind(name)
      .first<{ id: string; name: string; icon_key: string }>()

    if (existingActivity) {
      return context.json({
        ok: true,
        activity: {
          id: existingActivity.id,
          name: existingActivity.name,
          iconKey: existingActivity.icon_key,
        },
      })
    }

    const activity = {
      id: crypto.randomUUID(),
      name,
      iconKey: body?.iconKey?.trim() || getActivityIconKey(name),
    }

    await context.env.DB
      .prepare(`
        INSERT INTO activities (id, name, icon_key)
        VALUES (?, ?, ?)
      `)
      .bind(activity.id, activity.name, activity.iconKey)
      .run()

    return context.json({ ok: true, activity }, 201)
  },
)

export default catalog
