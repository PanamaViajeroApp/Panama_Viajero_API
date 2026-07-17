export async function purgeExpiredSites(
  database: D1Database,
): Promise<number> {
  const result = await database
    .prepare(`
      DELETE FROM sites
      WHERE
        deleted_at IS NOT NULL
        AND purge_at IS NOT NULL
        AND purge_at <= ?
    `)
    .bind(new Date().toISOString())
    .run()

  return result.meta.changes
}
