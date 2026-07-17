import { Hono } from 'hono'
import { cors } from 'hono/cors'
import admin from './routes/admin'
import auth from './routes/auth'
import health from './routes/health'
import media from './routes/media'
import publicSites from './routes/public-sites'
import { getAllowedOrigins, requireTrustedOrigin } from './middleware/security'
import { purgeExpiredSites } from './lib/purge'
import type { AppEnv, Bindings } from './types'

const app = new Hono<AppEnv>()

const trustedCors = cors({
  origin: (origin, context) => (
    getAllowedOrigins(context.env.ALLOWED_ORIGINS).includes(origin)
      ? origin
      : null
  ),
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Bootstrap-Secret'],
  credentials: true,
  maxAge: 600,
})

app.use('/api/v1/auth/*', trustedCors)
app.use('/api/v1/admin/*', trustedCors)
app.use('/api/v1/auth/*', requireTrustedOrigin)
app.use('/api/v1/admin/*', requireTrustedOrigin)
app.use('/api/v1/public/*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  maxAge: 600,
}))
app.use('/api/v1/media/*', cors({
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'OPTIONS'],
  maxAge: 600,
}))

app.get('/', (context) => context.json({
  ok: true,
  service: 'panama-viajero-api',
  version: '0.1.0',
  health: '/api/v1/health',
}))

app.route('/api/v1', health)
app.route('/api/v1/media', media)
app.route('/api/v1/public/sites', publicSites)
app.route('/api/v1/auth', auth)
app.route('/api/v1/admin', admin)

app.notFound((context) => context.json({
  ok: false,
  error: 'Route not found',
}, 404))

app.onError((error, context) => {
  console.error('Unhandled API error', error)

  return context.json({
    ok: false,
    error: 'Internal server error',
  }, 500)
})

export default {
  fetch(
    request: Request,
    environment: Bindings,
    executionContext: ExecutionContext,
  ) {
    return app.fetch(request, environment, executionContext)
  },
  scheduled(
    _event: ScheduledEvent,
    environment: Bindings,
    executionContext: ExecutionContext,
  ) {
    executionContext.waitUntil(
      purgeExpiredSites(environment.DB, environment.IMAGES),
    )
  },
}
