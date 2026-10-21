CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(kind, id)
);
CREATE INDEX IF NOT EXISTS records_scope ON records(kind, project_id, branch_id);
CREATE TABLE IF NOT EXISTS request_keys (
  request_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_job ON events(job_id, seq);
INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));
