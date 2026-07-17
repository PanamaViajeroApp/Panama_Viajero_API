import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { hashToken } from './crypto'

const maxFailedAttempts = 5
const attemptWindowMilliseconds = 15 * 60 * 1000
const blockDurationMilliseconds = 15 * 60 * 1000

type AttemptRow = {
  failed_attempts: number
  window_started_at: string
  blocked_until: string | null
}

async function getIdentifierHash(
  context: Context<AppEnv>,
  username: string,
): Promise<string> {
  const clientIp = context.req.header('CF-Connecting-IP')
    || context.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'local'

  return hashToken(`${username.trim().toLowerCase()}|${clientIp}`)
}

export async function getLoginBlock(
  context: Context<AppEnv>,
  username: string,
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const identifierHash = await getIdentifierHash(context, username)
  const attempt = await context.env.DB
    .prepare(`
      SELECT
        failed_attempts,
        window_started_at,
        blocked_until
      FROM auth_attempts
      WHERE identifier_hash = ?
    `)
    .bind(identifierHash)
    .first<AttemptRow>()

  if (!attempt?.blocked_until) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  const remainingMilliseconds = new Date(attempt.blocked_until).getTime() - Date.now()

  return {
    blocked: remainingMilliseconds > 0,
    retryAfterSeconds: Math.max(0, Math.ceil(remainingMilliseconds / 1000)),
  }
}

export async function recordFailedLogin(
  context: Context<AppEnv>,
  username: string,
): Promise<void> {
  const identifierHash = await getIdentifierHash(context, username)
  const now = new Date()
  const attempt = await context.env.DB
    .prepare(`
      SELECT
        failed_attempts,
        window_started_at,
        blocked_until
      FROM auth_attempts
      WHERE identifier_hash = ?
    `)
    .bind(identifierHash)
    .first<AttemptRow>()
  const windowExpired = !attempt
    || now.getTime() - new Date(attempt.window_started_at).getTime() > attemptWindowMilliseconds
  const failedAttempts = windowExpired
    ? 1
    : attempt.failed_attempts + 1
  const blockedUntil = failedAttempts >= maxFailedAttempts
    ? new Date(now.getTime() + blockDurationMilliseconds).toISOString()
    : null

  await context.env.DB
    .prepare(`
      INSERT INTO auth_attempts (
        identifier_hash,
        failed_attempts,
        window_started_at,
        blocked_until,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(identifier_hash) DO UPDATE SET
        failed_attempts = excluded.failed_attempts,
        window_started_at = excluded.window_started_at,
        blocked_until = excluded.blocked_until,
        updated_at = excluded.updated_at
    `)
    .bind(
      identifierHash,
      failedAttempts,
      windowExpired ? now.toISOString() : attempt.window_started_at,
      blockedUntil,
      now.toISOString(),
    )
    .run()
}

export async function clearFailedLogins(
  context: Context<AppEnv>,
  username: string,
): Promise<void> {
  const identifierHash = await getIdentifierHash(context, username)
  await context.env.DB
    .prepare('DELETE FROM auth_attempts WHERE identifier_hash = ?')
    .bind(identifierHash)
    .run()
}
