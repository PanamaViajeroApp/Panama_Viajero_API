import { Hono } from 'hono'
import catalog from './catalog'
import sites from './sites'
import users from './users'
import {
  requireAuth,
  requireCompletedPasswordChange,
} from '../middleware/auth'
import type { AppEnv } from '../types'

const admin = new Hono<AppEnv>()

admin.use('*', requireAuth)
admin.use('*', requireCompletedPasswordChange)
admin.route('/catalog', catalog)
admin.route('/sites', sites)
admin.route('/users', users)

export default admin
