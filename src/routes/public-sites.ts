import { Hono } from 'hono'
import {
  getPublishedSiteBySlug,
  listSites,
  type SiteRecord,
} from '../lib/site-data'
import type { AppEnv } from '../types'

const publicSites = new Hono<AppEnv>()

function toPublicSite(site: SiteRecord) {
  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    previewDescription: site.previewDescription,
    description: site.description,
    location: site.location,
    mapUrl: site.mapUrl,
    province: {
      id: site.province.id,
      slug: site.province.slug,
      name: site.province.name,
    },
    zone: site.zone,
    isPacificRiviera: site.isPacificRiviera,
    publishedAt: site.publishedAt,
    updatedAt: site.updatedAt,
    activities: site.activities,
    images: site.images.map((image) => ({
      id: image.id,
      url: `/api/v1/media/${image.id}`,
      imageType: image.imageType,
      sortOrder: image.sortOrder,
      width: image.width,
      height: image.height,
    })),
  }
}

publicSites.get('/', async (context) => {
  const sites = await listSites(context.env.DB, { status: 'published' })

  context.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return context.json({
    ok: true,
    sites: sites.map(toPublicSite),
  })
})

publicSites.get('/:slug', async (context) => {
  const site = await getPublishedSiteBySlug(
    context.env.DB,
    decodeURIComponent(context.req.param('slug')),
  )

  if (!site) {
    return context.json({ ok: false, error: 'Site not found' }, 404)
  }

  context.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return context.json({ ok: true, site: toPublicSite(site) })
})

export default publicSites
