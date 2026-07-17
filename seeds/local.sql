INSERT OR IGNORE INTO users (
  id,
  username,
  password_hash,
  account_type,
  must_change_password
) VALUES (
  'user-administrator',
  'Administrador',
  'LOCAL_AUTH_SETUP_REQUIRED',
  'administrator',
  1
);

INSERT OR IGNORE INTO user_permissions (
  user_id,
  create_draft,
  edit_draft,
  edit_published,
  delete_site,
  publish,
  manage_users,
  manage_permissions
) VALUES (
  'user-administrator',
  1,
  1,
  1,
  1,
  1,
  1,
  1
);
