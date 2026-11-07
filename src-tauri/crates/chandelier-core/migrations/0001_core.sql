CREATE TABLE providers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    base_url TEXT NOT NULL,
    authentication_mode TEXT NOT NULL CHECK (authentication_mode IN ('none', 'bearer')),
    credential_reference TEXT,
    timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds > 0),
    supports_usage INTEGER NOT NULL CHECK (supports_usage IN (0, 1)),
    default_parameters TEXT NOT NULL CHECK (json_valid(default_parameters) AND json_type(default_parameters) = 'object'),
    created_at INTEGER NOT NULL
);
CREATE TABLE models (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    model_identifier TEXT NOT NULL CHECK (length(trim(model_identifier)) > 0),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    context_window INTEGER CHECK (context_window > 0),
    capabilities TEXT NOT NULL CHECK (json_valid(capabilities) AND json_type(capabilities) = 'object'),
    default_parameters TEXT NOT NULL CHECK (json_valid(default_parameters) AND json_type(default_parameters) = 'object'),
    UNIQUE(id, provider_id)
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    selected_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    session_settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(session_settings) AND json_type(session_settings) = 'object')
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'cancelled', 'failed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    UNIQUE(id, session_id)
);
CREATE TABLE generations (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'cancelled', 'failed')),
    request_parameters TEXT NOT NULL CHECK (json_valid(request_parameters) AND json_type(request_parameters) = 'object'),
    request_snapshot TEXT NOT NULL CHECK (json_valid(request_snapshot) AND json_type(request_snapshot) = 'object'),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    finish_reason TEXT,
    error TEXT CHECK (error IS NULL OR json_valid(error)),
    FOREIGN KEY (message_id, session_id) REFERENCES messages(id, session_id) ON DELETE CASCADE,
    FOREIGN KEY (model_id, provider_id) REFERENCES models(id, provider_id) ON DELETE RESTRICT,
    CHECK ((status IN ('pending', 'streaming') AND finished_at IS NULL) OR (status IN ('completed', 'cancelled', 'failed') AND finished_at IS NOT NULL))
);
CREATE TABLE generation_metrics (
    generation_id TEXT PRIMARY KEY NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    metrics TEXT NOT NULL CHECK (json_valid(metrics) AND json_type(metrics) = 'object' AND json_extract(metrics, '$.generation_id') = generation_id)
);
CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL CHECK (json_valid(value))
);
