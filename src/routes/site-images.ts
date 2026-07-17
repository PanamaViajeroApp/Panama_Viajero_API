import { Hono, type Context } from 'hono'
import { getSiteById, type SiteStatus } from '../lib/site-data'
import { requireAnyPermission } from '../middleware/auth'
import type { AppEnv, PermissionKey } from '../types'

const siteImages = new Hono<AppEnv>()

const maxImageBytes = 10 * 1024 * 1024
const maxGalleryImages = 30

type ExistingImageRow = {
  id: string
  r2_key: string
  image_type: 'banner' | 'gallery'
}

function sitePermission(status: SiteStatus): PermissionKey {
  return status === 'draft' ? 'edit_draft' : 'edit_published'
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

async function isWebp(file: File): Promise<boolean> {
  if (file.type !== 'image/webp' || file.size < 12) return false

  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const text = String.fromCharCode(...signature)
  return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP'
}

function parsePositiveInteger(value: string | File | null): number | null {
  if (typeof value !== 'string' || !value) return null

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

siteImages.post(
  '/:siteId/images',
  requireAnyPermission(['edit_draft', 'edit_published']),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site || site.deletedAt) {
      return context.json({ ok: false, error: 'Site not found' }, 404)
    }

    const requiredPermission = sitePermission(site.status)
    if (!context.get('authUser').permissions[requiredPermission]) {
      return permissionError(context, requiredPermission)
    }

    const formData = await context.req.formData().catch(() => null)
    const file = formData?.get('file')
    const imageType = formData?.get('imageType')

    if (!(file instanceof File)) {
      return context.json({ ok: false, error: 'Image file is required' }, 400)
    }

    if (imageType !== 'banner' && imageType !== 'gallery') {
      return context.json({ ok: false, error: 'Invalid image type' }, 400)
    }

    if (file.size > maxImageBytes) {
      return context.json({
        ok: false,
        error: 'Image cannot exceed 10 MB',
      }, 413)
    }

    if (!(await isWebp(file))) {
      return context.json({
        ok: false,
        error: 'Only valid WebP images are accepted',
      }, 415)
    }

    if (imageType === 'gallery') {
      const galleryCount = await context.env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM site_images
          WHERE site_id = ? AND image_type = 'gallery'
        `)
        .bind(site.id)
        .first<{ total: number }>()

      if ((galleryCount?.total || 0) >= maxGalleryImages) {
        return context.json({
          ok: false,
          error: `A site can contain up to ${maxGalleryImages} gallery images`,
        }, 409)
      }
    }

    const existingBanner = imageType === 'banner'
      ? await context.env.DB
        .prepare(`
          SELECT id, r2_key, image_type
          FROM site_images
          WHERE site_id = ? AND image_type = 'banner'
        `)
        .bind(site.id)
        .all<ExistingImageRow>()
      : { results: [] }
    const nextGalleryOrder = imageType === 'gallery'
      ? await context.env.DB
        .prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM site_images
          WHERE site_id = ? AND image_type = 'gallery'
        `)
        .bind(site.id)
        .first<{ next_order: number }>()
      : null
    const imageId = crypto.randomUUID()
    const r2Key = `sites/${site.id}/${imageType}/${imageId}.webp`
    const now = new Date().toISOString()
    const sortOrder = imageType === 'banner'
      ? 0
      : nextGalleryOrder?.next_order || 0
    const width = parsePositiveInteger(formData?.get('width') || null)
    const height = parsePositiveInteger(formData?.get('height') || null)

    await context.env.IMAGES.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        siteId: site.id,
        imageType,
      },
    })

    try {
      const statements = [
        ...(imageType === 'banner'
          ? [
            context.env.DB
              .prepare(`
                DELETE FROM site_images
                WHERE site_id = ? AND image_type = 'banner'
              `)
              .bind(site.id),
          ]
          : []),
        context.env.DB
          .prepare(`
            INSERT INTO site_images (
              id,
              site_id,
              r2_key,
              image_type,
              sort_order,
              mime_type,
              size_bytes,
              width,
              height,
              created_by,
              created_at
            ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?)
          `)
          .bind(
            imageId,
            site.id,
            r2Key,
            imageType,
            sortOrder,
            file.size,
            width,
            height,
            context.get('authUser').id,
            now,
          ),
        context.env.DB
          .prepare(`
            UPDATE sites
            SET updated_by = ?, updated_at = ?
            WHERE id = ?
          `)
          .bind(context.get('authUser').id, now, site.id),
      ]

      await context.env.DB.batch(statements)
    } catch (error) {
      await context.env.IMAGES.delete(r2Key)
      throw error
    }

    if (existingBanner.results.length > 0) {
      await Promise.allSettled(
        existingBanner.results.map((image) => (
          context.env.IMAGES.delete(image.r2_key)
        )),
      )
    }

    return context.json({
      ok: true,
      site: await getSiteById(context.env.DB, site.id),
    }, 201)
  },
)

siteImages.delete(
  '/:siteId/images/:imageId',
  requireAnyPermission(['edit_draft', 'edit_published']),
  async (context) => {
    const site = await getSiteById(
      context.env.DB,
      context.req.param('siteId'),
    )

    if (!site || site.deletedAt) {
      return context.json({ ok: false, error: 'Site not found' }, 404)
    }

    const requiredPermission = sitePermission(site.status)
    if (!context.get('authUser').permissions[requiredPermission]) {
      return permissionError(context, requiredPermission)
    }

    const image = await context.env.DB
      .prepare(`
        SELECT id, r2_key, image_type
        FROM site_images
        WHERE id = ? AND site_id = ?
        LIMIT 1
      `)
      .bind(context.req.param('imageId'), site.id)
      .first<ExistingImageRow>()

    if (!image) {
      return context.json({ ok: false, error: 'Image not found' }, 404)
    }

    await context.env.IMAGES.delete(image.r2_key)
    const now = new Date().toISOString()
    await context.env.DB.batch([
      context.env.DB
        .prepare('DELETE FROM site_images WHERE id = ?')
        .bind(image.id),
      context.env.DB
        .prepare(`
          UPDATE sites
          SET updated_by = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(context.get('authUser').id, now, site.id),
    ])

    return context.json({
      ok: true,
      site: await getSiteById(context.env.DB, site.id),
    })
  },
)

export default siteImages
