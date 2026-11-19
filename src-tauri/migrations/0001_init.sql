CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL CHECK (json_valid(value)),
    updated_at INTEGER NOT NULL            -- Unix ms
) STRICT;

CREATE TABLE sessions (
    id             TEXT PRIMARY KEY,       -- UUIDv7, sortable by creation time
    title          TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,  -- JSON shape version of `data`
    data           TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX sessions_by_updated ON sessions (updated_at DESC);

CREATE TABLE attempts (
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,           -- CompletionAttempt.id
    started_at TEXT NOT NULL,
    data       TEXT NOT NULL CHECK (json_valid(data)),
    PRIMARY KEY (session_id, seq)
) STRICT, WITHOUT ROWID;
