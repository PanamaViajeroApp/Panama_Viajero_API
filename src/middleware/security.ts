import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'

export function getAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export const requireTrustedOrigin: MiddlewareHandler<AppEnv> = async (
  context,
  next,
) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    await next()
    return
  }

  const origin = context.req.header('Origin')

  if (
    origin
    && !getAllowedOrigins(context.env.ALLOWED_ORIGINS).includes(origin)
  ) {
    return context.json({
      ok: false,
      error: 'Origin not allowed',
    }, 403)
  }

  await next()
}
