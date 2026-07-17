PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'user'
    CHECK (account_type IN ('administrator', 'co_administrator', 'user')),
  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE user_permissions (
  user_id TEXT PRIMARY KEY,
  create_draft INTEGER NOT NULL DEFAULT 0 CHECK (create_draft IN (0, 1)),
  edit_draft INTEGER NOT NULL DEFAULT 0 CHECK (edit_draft IN (0, 1)),
  edit_published INTEGER NOT NULL DEFAULT 0 CHECK (edit_published IN (0, 1)),
  delete_site INTEGER NOT NULL DEFAULT 0 CHECK (delete_site IN (0, 1)),
  publish INTEGER NOT NULL DEFAULT 0 CHECK (publish IN (0, 1)),
  manage_users INTEGER NOT NULL DEFAULT 0 CHECK (manage_users IN (0, 1)),
  manage_permissions INTEGER NOT NULL DEFAULT 0 CHECK (manage_permissions IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'cancelled')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE provinces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  zone_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (zone_mode IN ('none', 'colon_coast')),
  supports_pacific_riviera INTEGER NOT NULL DEFAULT 0
    CHECK (supports_pacific_riviera IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  map_url TEXT NOT NULL,
  province_id TEXT NOT NULL,
  zone TEXT CHECK (zone IS NULL OR zone IN ('costa_arriba', 'costa_abajo')),
  is_pacific_riviera INTEGER NOT NULL DEFAULT 0
    CHECK (is_pacific_riviera IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  created_by TEXT,
  updated_by TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by TEXT,
  purge_at TEXT,
  CHECK (deleted_at IS NULL OR purge_at IS NOT NULL),
  FOREIGN KEY (province_id) REFERENCES provinces(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE site_activities (
  site_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  PRIMARY KEY (site_id, activity_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE RESTRICT
);

CREATE TABLE site_images (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE
    CHECK (LOWER(r2_key) LIKE '%.webp'),
  image_type TEXT NOT NULL
    CHECK (image_type IN ('banner', 'gallery')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'image/webp'
    CHECK (mime_type = 'image/webp'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_users_deleted_at ON users(deleted_at);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_password_resets_status ON password_reset_requests(status);
CREATE INDEX idx_sites_province_id ON sites(province_id);
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_sites_deleted_at ON sites(deleted_at);
CREATE INDEX idx_sites_purge_at ON sites(purge_at);
CREATE INDEX idx_sites_pacific_riviera ON sites(is_pacific_riviera);
CREATE INDEX idx_site_images_site_id ON site_images(site_id);

INSERT INTO provinces (
  id,
  slug,
  name,
  zone_mode,
  supports_pacific_riviera,
  display_order
) VALUES
  ('province-bocas-del-toro', 'bocas-del-toro', 'Bocas del Toro', 'none', 0, 1),
  ('province-chiriqui', 'chiriqui', 'Chiriqui', 'none', 0, 2),
  ('province-cocle', 'cocle', 'Cocle', 'none', 1, 3),
  ('province-colon', 'colon', 'Colon', 'colon_coast', 0, 4),
  ('province-darien', 'darien', 'Darien', 'none', 0, 5),
  ('province-guna-yala', 'guna-yala', 'Guna Yala', 'none', 0, 6),
  ('province-herrera', 'herrera', 'Herrera', 'none', 0, 7),
  ('province-los-santos', 'los-santos', 'Los Santos', 'none', 0, 8),
  ('province-panama', 'panama', 'Panama', 'none', 0, 9),
  ('province-panama-oeste', 'panama-oeste', 'Panama Oeste', 'none', 1, 10),
  ('province-veraguas', 'veraguas', 'Veraguas', 'none', 0, 11);
