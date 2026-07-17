import { Hono, type Context } from 'hono'
import { getActivityIconKey } from '../lib/activity-icons'
import { purgeExpiredSites } from '../lib/purge'
import {
  getSiteById,
  listSites,
  type SiteStatus,
} from '../lib/site-data'
import {
  requireAnyPermission,
  requirePermission,
} from '../middleware/auth'
import type { AppEnv, PermissionKey } from '../types'

const sites = new Hono<AppEnv>()

type ProvinceRow = {
  id: string
  slug: string
  name: string
  zone_mode: 'none' | 'colon_coast'
  supports_pacific_riviera: number
}

type SiteInput = {
  name: string
  previewDescription: string
  description: string
  location: string
  mapUrl: string
  province: string
  zone: 'costa_arriba' | 'costa_abajo' | null
  isPacificRiviera: boolean
  activities: string[]
}

function normalizeComparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function createSlug(value: string): string {
  return normalizeComparable(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'sitio'
}

function parseHttpsMapUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:'
      && (url.hostname === 'google.com' || url.hostname.endsWith('.google.com'))
      && url.pathname.startsWith('/maps/embed')
    )
  } catch {
    return false
  }
}

function parseSiteInput(body: unknown): {
  input?: SiteInput
  error?: string
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request body' }
  }

  const record = body as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const previewDescription = typeof record.previewDescription === 'string'
    ? record.previewDescription.trim()
    : ''
  const description = typeof record.description === 'string'
    ? record.description.trim()
    : ''
  const location = typeof record.location === 'string'
    ? record.location.trim()
    : ''
  const mapUrl = typeof record.mapUrl === 'string' ? record.mapUrl.trim() : ''
  const province = typeof record.province === 'string'
    ? record.province.trim()
    : ''
  const rawZone = typeof record.zone === 'string' ? record.zone : null
  const zone = rawZone === 'costa_arriba' || rawZone === 'costa_abajo'
    ? rawZone
    : null
  const isPacificRiviera = record.isPacificRiviera === true
  const rawActivities = Array.isArray(record.activities)
    ? record.activities
    : []
  const activities = Array.from(new Map(
    rawActivities
      .filter((activity): activity is string => typeof activity === 'string')
      .map((activity) => activity.trim())
      .filter(Boolean)
      .map((activity) => [normalizeComparable(activity), activity]),
  ).values())

  if (name.length < 2 || name.length > 160) {
    return { error: 'Site name must contain between 2 and 160 characters' }
  }

  if (description.length < 10 || description.length > 5000) {
    return { error: 'Description must contain between 10 and 5000 characters' }
  }

  if (previewDescription.length < 10 || previewDescription.length > 500) {
    return {
      error: 'Preview description must contain between 10 and 500 characters',
    }
  }

  if (location.length < 2 || location.length > 220) {
    return { error: 'Location must contain between 2 and 220 characters' }
  }

  if (!parseHttpsMapUrl(mapUrl) || mapUrl.length > 5000) {
    return { error: 'Map URL must be a valid Google Maps embed URL' }
  }

  if (!province) {
    return { error: 'Province is required' }
  }

  if (activities.length > 50 || activities.some((activity) => activity.length > 80)) {
    return { error: 'A site can contain up to 50 activities of 80 characters each' }
  }

  return {
    input: {
      name,
      previewDescription,
      description,
      location,
      mapUrl,
      province,
      zone,
      isPacificRiviera,
      activities,
    },
  }
}

async function resolveProvince(
  database: D1Database,
  identifier: string,
): Promise<ProvinceRow | null> {
  return database
    .prepare(`
      SELECT
        id,
        slug,
        name,
        zone_mode,
        supports_pacific_riviera
      FROM provinces
      WHERE
        id = ?
        OR slug = ?
        OR name = ? COLLATE NOCASE
      LIMIT 1
    `)
    .bind(identifier, identifier, identifier)
    .first<ProvinceRow>()
}

function validateProvinceOptions(
  province: ProvinceRow,
  input: SiteInput,
): string | null {
  if (province.zone_mode === 'colon_coast' && !input.zone) {
    return 'A Colon site must belong to costa_arriba or costa_abajo'
  }

  if (province.zone_mode !== 'colon_coast' && input.zone) {
    return 'The selected province does not support zones'
  }

  if (
    input.isPacificRiviera
    && province.supports_pacific_riviera !== 1
  ) {
    return 'The selected province does not support Pacific Riviera sites'
  }

  return null
}

async function createUniqueSlug(
  database: D1Database,
  name: string,
): Promise<string> {
  const baseSlug = createSlug(name)
  let candidate = baseSlug
  let suffix = 2

  while (
    await database
      .prepare('SELECT 1 FROM sites WHERE slug = ? LIMIT 1')
      .bind(candidate)
      .first()
  ) {
    candidate = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return candidate
}

function createActivityStatements(
  database: D1Database,
  siteId: string,
  activities: string[],
  now: string,
): D1PreparedStatement[] {
  return activities.flatMap((activityName) => {
    const activityId = crypto.randomUUID()

    return [
      database
        .prepare(`
          INSERT INTO activities (
            id,
            name,
            icon_key,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            updated_at = excluded.updated_at
        `)
        .bind(
          activityId,
          activityName,
          getActivityIconKey(activityName),
          now,
          now,
        ),
      database
        .prepare(`
          INSERT INTO site_activities (site_id, activity_id)
          SELECT ?, id
          FROM activities
          WHERE name = ? COLLATE NOCASE
          ON CONFLICT(site_id, activity_id) DO NOTHING
        `)
        .bind(siteId, activityName),
    ]
  })
}

function permissionError(
  context: Context<AppEnv>,
  permission: PermissionKey,
) {
  return context.json({
    ok: false,
    error: 'Insufficient permissions',
    permission,
  }, 403)
}

function sitePermission(status: SiteStatus): PermissionKey {
  return status === 'draft' ? 'edit_draft' : 'edit_published'
}

sites.get('/', async (context) => {
  const requestedStatus = context.req.query('status')

  if (
    requestedStatus
    && requestedStatus !== 'draft'
    && requestedStatus !== 'published'
  ) {
    return context.json({
      ok: false,
      error: 'Invalid site status',
    }, 400)
  }

  const records = await listSites(context.env.DB, {
    status: requestedStatus as SiteStatus | undefined,
  })

  return context.json({ ok: true, sites: records })
})

sites.get('/:siteId', async (context) => {
  const site = await getSiteById(context.env.DB, context.req.param('siteId'))

  if (!site || site.deletedAt) {
    return context.json({ ok: false, error: 'Site not found' }, 404)
  }

  return context.json({ ok: true, site })
})

sites.post(
  '/',
  requirePermission('create_draft'),
  async (context) => {
    const parsedBody = parseSiteInput(
      await context.req.json<unknown>().catch(() => null),
    )

    if (!parsedBody.input) {
      return context.json({
        ok: false,
        error: parsedBody.error,
      }, 400)
    }

    const province = await resolveProvince(
      context.env.DB,
      parsedBody.input.province,
    )

    if (!province) {
      return context.json({ ok: false, error: 'Province not found' }, 400)
    }

    const provinceError = validateProvinceOptions(province, parsedBody.input)
    if (provinceError) {
      return context.json({ ok: false, error: provinceError }, 400)
    }

    const authUser = context.get('authUser')
    const siteId = crypto.randomUUID()
    const slug = await createUniqueSlug(
      context.env.DB,
      parsedBody.input.name,
    )
    const now = new Date().toISOString()
    const statements = [
      context.env.DB
        .prepare(`
          INSERT INTO sites (
            id,
            slug,
            name,
            preview_description,
            description,
            location,
            map_url,
            province_id,
            zone,
            is_pacific_riviera,
            status,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
        `)
        .bind(
          siteId,
          slug,
          parsedBody.input.name,
          parsedBody.input.previewDescription,
          parsedBody.input.description,
          parsedBody.input.location,
          parsedBody.input.mapUrl,
          province.id,
          parsedBody.input.zone,
          parsedBody.input.isPacificRiviera ? 1 : 0,
          authUser.id,
          authUser.id,
          now,
          now,
        ),
      ...createActivityStatements(
        context.env.DB,
        siteId,
        parsedBody.input.activities,
        now,
      ),
    ]

    await context.env.DB.batch(statements)
    const site = await getSiteById(context.env.DB, siteId)

    return context.json({ ok: true, site }, 201)
  },
)

sites.patch(
  '/:siteId',
  requireAnyPermission(['edit_draft', 'edit_published']),
  async (context) => {
    const currentSite = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!currentSite || currentSite.deletedAt) {
      return context.json({ ok: false, error: 'Site not found' }, 404)
    }

    const requiredPermission = sitePermission(currentSite.status)
    if (!context.get('authUser').permissions[requiredPermission]) {
      return permissionError(context, requiredPermission)
    }

    const requestBody = await context.req
      .json<Record<string, unknown>>()
      .catch(() => null)

    if (!requestBody) {
      return context.json({ ok: false, error: 'Invalid request body' }, 400)
    }

    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(
      requestBody,
      field,
    )
    const parsedBody = parseSiteInput({
      name: requestBody.name ?? currentSite.name,
      previewDescription: requestBody.previewDescription
        ?? currentSite.previewDescription,
      description: requestBody.description ?? currentSite.description,
      location: requestBody.location ?? currentSite.location,
      mapUrl: requestBody.mapUrl ?? currentSite.mapUrl,
      province: requestBody.province ?? currentSite.province.id,
      zone: hasField('zone') ? requestBody.zone : currentSite.zone,
      isPacificRiviera: hasField('isPacificRiviera')
        ? requestBody.isPacificRiviera
        : currentSite.isPacificRiviera,
      activities: requestBody.activities
        ?? currentSite.activities.map((activity) => activity.name),
    })

    if (!parsedBody.input) {
      return context.json({
        ok: false,
        error: parsedBody.error,
      }, 400)
    }

    const province = await resolveProvince(
      context.env.DB,
      parsedBody.input.province,
    )

    if (!province) {
      return context.json({ ok: false, error: 'Province not found' }, 400)
    }

    const provinceError = validateProvinceOptions(province, parsedBody.input)
    if (provinceError) {
      return context.json({ ok: false, error: provinceError }, 400)
    }

    const now = new Date().toISOString()
    const statements = [
      context.env.DB
        .prepare(`
          UPDATE sites
          SET
            name = ?,
            preview_description = ?,
            description = ?,
            location = ?,
            map_url = ?,
            province_id = ?,
            zone = ?,
            is_pacific_riviera = ?,
            updated_by = ?,
            updated_at = ?
          WHERE id = ?
        `)
        .bind(
          parsedBody.input.name,
          parsedBody.input.previewDescription,
          parsedBody.input.description,
          parsedBody.input.location,
          parsedBody.input.mapUrl,
          province.id,
          parsedBody.input.zone,
          parsedBody.input.isPacificRiviera ? 1 : 0,
          context.get('authUser').id,
          now,
          currentSite.id,
        ),
      context.env.DB
        .prepare('DELETE FROM site_activities WHERE site_id = ?')
        .bind(currentSite.id),
      ...createActivityStatements(
        context.env.DB,
        currentSite.id,
        parsedBody.input.activities,
        now,
      ),
    ]

    await context.env.DB.batch(statements)
    const site = await getSiteById(context.env.DB, currentSite.id)

    return context.json({ ok: true, site })
  },
)

sites.post(
  '/:siteId/publish',
  requirePermission('publish'),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site || site.deletedAt) {
      return context.json({ ok: false, error: 'Site not found' }, 404)
    }

    if (site.status !== 'draft') {
      return context.json({
        ok: false,
        error: 'Only drafts can be published',
      }, 409)
    }

    const now = new Date().toISOString()
    await context.env.DB
      .prepare(`
        UPDATE sites
        SET
          status = 'published',
          published_at = ?,
          updated_by = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(now, context.get('authUser').id, now, site.id)
      .run()

    return context.json({
      ok: true,
      site: await getSiteById(context.env.DB, site.id),
    })
  },
)

sites.delete(
  '/:siteId',
  requirePermission('delete_site'),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site || site.deletedAt) {
      return context.json({ ok: false, error: 'Site not found' }, 404)
    }

    const deletedAt = new Date()
    const purgeAt = new Date(deletedAt)
    purgeAt.setUTCDate(purgeAt.getUTCDate() + 50)

    await context.env.DB
      .prepare(`
        UPDATE sites
        SET
          deleted_at = ?,
          deleted_by = ?,
          purge_at = ?,
          updated_by = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        deletedAt.toISOString(),
        context.get('authUser').id,
        purgeAt.toISOString(),
        context.get('authUser').id,
        deletedAt.toISOString(),
        site.id,
      )
      .run()

    return context.json({
      ok: true,
      site: await getSiteById(context.env.DB, site.id),
    })
  },
)

sites.get('/trash/items', async (context) => {
  await purgeExpiredSites(context.env.DB, context.env.IMAGES)
  return context.json({
    ok: true,
    sites: await listSites(context.env.DB, { deleted: true }),
  })
})

sites.post(
  '/trash/:siteId/restore',
  requirePermission('delete_site'),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site?.deletedAt) {
      return context.json({ ok: false, error: 'Deleted site not found' }, 404)
    }

    const now = new Date().toISOString()
    await context.env.DB
      .prepare(`
        UPDATE sites
        SET
          deleted_at = NULL,
          deleted_by = NULL,
          purge_at = NULL,
          updated_by = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(context.get('authUser').id, now, site.id)
      .run()

    return context.json({
      ok: true,
      site: await getSiteById(context.env.DB, site.id),
    })
  },
)

sites.delete(
  '/trash/:siteId',
  requirePermission('delete_site'),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site?.deletedAt) {
      return context.json({ ok: false, error: 'Deleted site not found' }, 404)
    }

    if (site.images.length > 0) {
      await context.env.IMAGES.delete(
        site.images.map((image) => image.r2Key),
      )
    }

    await context.env.DB
      .prepare('DELETE FROM sites WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(site.id)
      .run()

    return context.json({
      ok: true,
      message: 'Site permanently deleted',
    })
  },
)

export default sites
