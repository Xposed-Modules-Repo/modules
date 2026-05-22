CREATE TABLE IF NOT EXISTS module_records (
  cache_key TEXT PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  record_json TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_module_records_repo
  ON module_records(repo_owner, repo_name);

CREATE INDEX IF NOT EXISTS idx_module_records_expires
  ON module_records(expires_at);

CREATE INDEX IF NOT EXISTS idx_module_records_accessed
  ON module_records(accessed_at);

CREATE TABLE IF NOT EXISTS release_lists (
  cache_key TEXT PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  releases_json TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_release_lists_repo
  ON release_lists(repo_owner, repo_name);

CREATE INDEX IF NOT EXISTS idx_release_lists_expires
  ON release_lists(expires_at);

CREATE INDEX IF NOT EXISTS idx_release_lists_accessed
  ON release_lists(accessed_at);
