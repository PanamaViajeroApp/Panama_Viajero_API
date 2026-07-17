export type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  ALLOWED_ORIGINS: string
  SESSION_TTL_SECONDS: string
  BOOTSTRAP_SECRET?: string
}

export type PermissionKey =
  | 'create_draft'
  | 'edit_draft'
  | 'edit_published'
  | 'delete_site'
  | 'publish'
  | 'manage_users'
  | 'manage_permissions'

export type AuthUser = {
  id: string
  username: string
  accountType: 'administrator' | 'co_administrator' | 'user'
  mustChangePassword: boolean
  sessionId: string
  permissions: Record<PermissionKey, boolean>
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    authUser: AuthUser
  }
}
