import { Hono, type Context } from 'hono'
import type { AppEnv } from '../types'

type ImageRow = {
  r2_key: string
  mime_type: string
}

async function serveImage(
  context: Context<AppEnv>,
  publishedOnly: boolean,
): Promise<Response> {
  const publishedCondition = publishedOnly
    ? "AND s.status = 'published' AND s.deleted_at IS NULL"
    : ''
  const image = await context.env.DB
    .prepare(`
      SELECT si.r2_key, si.mime_type
      FROM site_images si
      INNER JOIN sites s ON s.id = si.site_id
      WHERE si.id = ? ${publishedCondition}
      LIMIT 1
    `)
    .bind(context.req.param('imageId'))
    .first<ImageRow>()

  if (!image) {
    return context.json({ ok: false, error: 'Image not found' }, 404)
  }

  const object = await context.env.IMAGES.get(image.r2_key)
  if (!object) {
    return context.json({ ok: false, error: 'Image not found' }, 404)
  }

  if (context.req.header('If-None-Match') === object.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: object.httpEtag },
    })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', image.mime_type)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', object.httpEtag)
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(object.body, { headers })
}

const publicMedia = new Hono<AppEnv>()
publicMedia.get('/:imageId', (context) => serveImage(context, true))

export const adminMedia = new Hono<AppEnv>()
adminMedia.get('/:imageId', (context) => serveImage(context, false))

export default publicMedia
