CREATE INDEX sessions_updated ON sessions(updated_at DESC, id);
CREATE INDEX messages_session ON messages(session_id, ordinal, created_at, id);
CREATE UNIQUE INDEX messages_active_ordinal ON messages(session_id, ordinal) WHERE active = 1;
CREATE INDEX generations_session ON generations(session_id, started_at, id);
CREATE INDEX models_provider ON models(provider_id);
CREATE UNIQUE INDEX generations_one_active ON generations(session_id) WHERE status IN ('pending', 'streaming');

CREATE TRIGGER sessions_active_update BEFORE UPDATE ON sessions
WHEN EXISTS (SELECT 1 FROM generations WHERE session_id = OLD.id AND status IN ('pending', 'streaming'))
BEGIN SELECT RAISE(ABORT, 'active_generation'); END;
CREATE TRIGGER sessions_active_delete BEFORE DELETE ON sessions
WHEN EXISTS (SELECT 1 FROM generations WHERE session_id = OLD.id AND status IN ('pending', 'streaming'))
BEGIN SELECT RAISE(ABORT, 'active_generation'); END;
CREATE TRIGGER providers_active_delete BEFORE DELETE ON providers
WHEN EXISTS (SELECT 1 FROM generations WHERE provider_id = OLD.id AND status IN ('pending', 'streaming'))
BEGIN SELECT RAISE(ABORT, 'active_generation'); END;
CREATE TRIGGER models_active_delete BEFORE DELETE ON models
WHEN EXISTS (SELECT 1 FROM generations WHERE model_id = OLD.id AND status IN ('pending', 'streaming'))
BEGIN SELECT RAISE(ABORT, 'active_generation'); END;
CREATE TRIGGER generations_immutable BEFORE UPDATE OF session_id, message_id, provider_id, model_id, request_parameters, request_snapshot, started_at ON generations
BEGIN SELECT RAISE(ABORT, 'immutable_generation'); END;
CREATE TRIGGER generations_matching_model BEFORE INSERT ON generations
WHEN NOT EXISTS (SELECT 1 FROM models WHERE id = NEW.model_id AND provider_id = NEW.provider_id)
BEGIN SELECT RAISE(ABORT, 'model_provider_mismatch'); END;
