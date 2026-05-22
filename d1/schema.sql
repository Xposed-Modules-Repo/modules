CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  value_gzip_b64 TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_entries_expires
  ON cache_entries(expires_at);

CREATE INDEX IF NOT EXISTS idx_cache_entries_namespace_accessed
  ON cache_entries(namespace, accessed_at);

CREATE TABLE IF NOT EXISTS cache_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
