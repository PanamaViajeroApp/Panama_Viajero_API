export async function purgeExpiredSites(
  database: D1Database,
  images: R2Bucket,
): Promise<number> {
  const now = new Date().toISOString()
  const expiredImages = await database
    .prepare(`
      SELECT si.r2_key
      FROM site_images si
      INNER JOIN sites s ON s.id = si.site_id
      WHERE
        s.deleted_at IS NOT NULL
        AND s.purge_at IS NOT NULL
        AND s.purge_at <= ?
    `)
    .bind(now)
    .all<{ r2_key: string }>()

  if (expiredImages.results.length > 0) {
    await images.delete(expiredImages.results.map((image) => image.r2_key))
  }

  const result = await database
    .prepare(`
      DELETE FROM sites
      WHERE
        deleted_at IS NOT NULL
        AND purge_at IS NOT NULL
        AND purge_at <= ?
    `)
    .bind(now)
    .run()

  return result.meta.changes
}
