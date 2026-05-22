CREATE TABLE IF NOT EXISTS release_html (
  cache_key TEXT PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  release_id TEXT NOT NULL,
  value_gzip_b64 TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_release_html_release
  ON release_html(repo_owner, repo_name, release_id);

CREATE INDEX IF NOT EXISTS idx_release_html_repo
  ON release_html(repo_owner, repo_name);

CREATE INDEX IF NOT EXISTS idx_release_html_expires
  ON release_html(expires_at);

CREATE INDEX IF NOT EXISTS idx_release_html_accessed
  ON release_html(accessed_at);
