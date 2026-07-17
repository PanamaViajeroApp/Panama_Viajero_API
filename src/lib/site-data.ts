export type SiteStatus = 'draft' | 'published'

export type SiteActivity = {
  id: string
  name: string
  iconKey: string
}

export type SiteImage = {
  id: string
  r2Key: string
  imageType: 'banner' | 'gallery'
  sortOrder: number
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
}

export type SiteRecord = {
  id: string
  slug: string
  name: string
  description: string
  location: string
  mapUrl: string
  province: {
    id: string
    slug: string
    name: string
    zoneMode: 'none' | 'colon_coast'
    supportsPacificRiviera: boolean
  }
  zone: 'costa_arriba' | 'costa_abajo' | null
  isPacificRiviera: boolean
  status: SiteStatus
  author: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
  purgeAt: string | null
  activities: SiteActivity[]
  images: SiteImage[]
}

type SiteRow = {
  id: string
  slug: string
  name: string
  description: string
  location: string
  map_url: string
  province_id: string
  province_slug: string
  province_name: string
  zone_mode: 'none' | 'colon_coast'
  supports_pacific_riviera: number
  zone: SiteRecord['zone']
  is_pacific_riviera: number
  status: SiteStatus
  author_name: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by_name: string | null
  purge_at: string | null
  activities_json: string
  images_json: string
}

const siteSelect = `
  SELECT
    s.id,
    s.slug,
    s.name,
    s.description,
    s.location,
    s.map_url,
    p.id AS province_id,
    p.slug AS province_slug,
    p.name AS province_name,
    p.zone_mode,
    p.supports_pacific_riviera,
    s.zone,
    s.is_pacific_riviera,
    s.status,
    COALESCE(updater.username, creator.username, 'Sistema') AS author_name,
    s.published_at,
    s.created_at,
    s.updated_at,
    s.deleted_at,
    deleter.username AS deleted_by_name,
    s.purge_at,
    COALESCE((
      SELECT json_group_array(json_object(
        'id', ordered_activities.id,
        'name', ordered_activities.name,
        'iconKey', ordered_activities.icon_key
      ))
      FROM (
        SELECT a.id, a.name, a.icon_key
        FROM site_activities sa
        INNER JOIN activities a ON a.id = sa.activity_id
        WHERE sa.site_id = s.id
        ORDER BY a.name COLLATE NOCASE
      ) AS ordered_activities
    ), '[]') AS activities_json,
    COALESCE((
      SELECT json_group_array(json_object(
        'id', ordered_images.id,
        'r2Key', ordered_images.r2_key,
        'imageType', ordered_images.image_type,
        'sortOrder', ordered_images.sort_order,
        'mimeType', ordered_images.mime_type,
        'sizeBytes', ordered_images.size_bytes,
        'width', ordered_images.width,
        'height', ordered_images.height
      ))
      FROM (
        SELECT
          si.id,
          si.r2_key,
          si.image_type,
          si.sort_order,
          si.mime_type,
          si.size_bytes,
          si.width,
          si.height
        FROM site_images si
        WHERE si.site_id = s.id
        ORDER BY
          CASE si.image_type WHEN 'banner' THEN 0 ELSE 1 END,
          si.sort_order,
          si.created_at
      ) AS ordered_images
    ), '[]') AS images_json
  FROM sites s
  INNER JOIN provinces p ON p.id = s.province_id
  LEFT JOIN users creator ON creator.id = s.created_by
  LEFT JOIN users updater ON updater.id = s.updated_by
  LEFT JOIN users deleter ON deleter.id = s.deleted_by
`

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsedValue = JSON.parse(value)
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch {
    return []
  }
}

function mapSiteRow(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    mapUrl: row.map_url,
    province: {
      id: row.province_id,
      slug: row.province_slug,
      name: row.province_name,
      zoneMode: row.zone_mode,
      supportsPacificRiviera: row.supports_pacific_riviera === 1,
    },
    zone: row.zone,
    isPacificRiviera: row.is_pacific_riviera === 1,
    status: row.status,
    author: row.author_name || 'Sistema',
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by_name,
    purgeAt: row.purge_at,
    activities: parseJsonArray<SiteActivity>(row.activities_json),
    images: parseJsonArray<SiteImage>(row.images_json),
  }
}

export async function listSites(
  database: D1Database,
  options: {
    status?: SiteStatus
    deleted?: boolean
  } = {},
): Promise<SiteRecord[]> {
  const conditions = [
    options.deleted ? 's.deleted_at IS NOT NULL' : 's.deleted_at IS NULL',
  ]
  const values: string[] = []

  if (options.status) {
    conditions.push('s.status = ?')
    values.push(options.status)
  }

  const result = await database
    .prepare(`
      ${siteSelect}
      WHERE ${conditions.join(' AND ')}
      ORDER BY datetime(s.updated_at) DESC, s.name COLLATE NOCASE
    `)
    .bind(...values)
    .all<SiteRow>()

  return result.results.map(mapSiteRow)
}

export async function getSiteById(
  database: D1Database,
  siteId: string,
): Promise<SiteRecord | null> {
  const row = await database
    .prepare(`
      ${siteSelect}
      WHERE s.id = ?
      LIMIT 1
    `)
    .bind(siteId)
    .first<SiteRow>()

  return row ? mapSiteRow(row) : null
}
