CREATE UNIQUE INDEX models_identity ON models(provider_id, model_identifier);
CREATE TRIGGER models_immutable_identity BEFORE UPDATE OF provider_id, model_identifier ON models
WHEN OLD.provider_id != NEW.provider_id OR OLD.model_identifier != NEW.model_identifier
BEGIN SELECT RAISE(ABORT, 'immutable_model'); END;
