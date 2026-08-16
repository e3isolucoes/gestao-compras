CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  budget TEXT,
  deadline TEXT,
  location TEXT,
  quantity TEXT,
  preferences TEXT,
  constraints_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
