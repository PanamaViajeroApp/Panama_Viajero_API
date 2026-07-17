import { Hono } from 'hono'
import type { Bindings } from '../types'

const health = new Hono<{ Bindings: Bindings }>()

health.get('/health', async (context) => {
  try {
    const databaseCheck = await context.env.DB
      .prepare('SELECT 1 AS connected')
      .first<{ connected: number }>()

    if (databaseCheck?.connected !== 1) {
      return context.json({
        ok: false,
        service: 'panama-viajero-api',
        database: 'unavailable',
      }, 503)
    }

    return context.json({
      ok: true,
      service: 'panama-viajero-api',
      environment: context.env.ENVIRONMENT,
      database: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Health check failed', error)

    return context.json({
      ok: false,
      service: 'panama-viajero-api',
      database: 'error',
    }, 503)
  }
})

export default health
