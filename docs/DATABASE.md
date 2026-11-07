# Database and history

## Location and durability

Tauri resolves the application data directory. `chandelier.sqlite3`, its WAL/SHM files and an application lock live there, not in the installation directory. The desktop process holds an exclusive OS file lock before opening/recovering the DB; a second process must not recover a live process's generation. Closing/crashing the process releases that lock.

SQLx migrations are compiled from `src-tauri/crates/chandelier-core/migrations`. Connections use WAL and foreign keys. Multi-row conversation changes are transactional. Back up a closed application directory, or use SQLite's backup facilities; copying only a live `.sqlite3` file can omit committed WAL data.

## Entities

| Table                | Key and data                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sessions`           | `id` PK; title/timestamps; nullable selected-model FK; JSON session settings                                      |
| `messages`           | `id` PK, session FK; role/content/status/timestamps; ordinal and active flag                                      |
| `generations`        | `id` PK, session/message/provider/model FKs; immutable JSON parameters/snapshot; start/finish/status/reason/error |
| `generation_metrics` | Generation FK/PK; JSON measurement object, including null unavailable values                                      |
| `providers`          | `id` PK; API root/authentication/credential reference/timeout/usage flag/JSON defaults                            |
| `models`             | `id` PK; unique `(provider_id, model_identifier)` identity; display/context/capabilities/defaults                 |
| `settings`           | String key PK, JSON value; individual preference writes preserve server-owned last-model state                    |

Secrets are not stored in these entities. `credential_reference` identifies an OS credential-store entry, not the key itself. The database contains conversation plaintext and is **not encrypted**; protect the OS account and backups accordingly.

Migrations: `0001_core.sql` creates tables and FKs; `0002_guards.sql` adds active-generation/history guards and indexes; `0003_model_identity.sql` enforces unique and immutable provider/model identities. A migration error preserves existing data and fails startup rather than resetting the DB.

## Conversation transitions

- Send: persist the user message and create an empty pending assistant message plus generation in one transaction before networking.
- Stream: checkpoint cumulative assistant text and observed metrics at a 350 ms interval instead of writing every event. A crash may lose the not-yet-checkpointed tail.
- Finish/fail/cancel: update the assistant, attempt and metrics together; cancellation/failure never clears received text.
- Regenerate: deactivate the current assistant answer and append another attempt for the original user input. Previous attempts remain queryable.
- Edit: deactivate the edited user message and subsequent visible messages, then append a replacement user input and new attempt. Previous request snapshots remain unchanged.
- Restart: pending/streaming attempts become failed; checkpointed partial text survives. Recovery cannot know the exact monotonic elapsed time after process death, so it must not invent completion timings.

Session detail returns the visible message branch plus historical attempts/metrics. `generation_message(generationId)` retrieves the corresponding output even when its message is no longer active. `request_snapshot` is the reproducibility boundary: changing current model/provider/session settings must not rewrite past requests.

## Deletion

Deleting a session intentionally deletes its messages, attempts and metrics. UI confirmation is required. Provider/model deletion must not break referenced generation history; remove the relevant conversation history first if deletion is needed. Changing/deleting a currently generating conversation is rejected. Foreign keys and the active-generation uniqueness constraint are the final guard behind service-level checks.

Provider deletion removes its unused child models in the same transaction. A referenced model/provider or active-generation guard rejects and rolls back the entire deletion, including child models; no history is discarded to make deletion succeed. Deleting a model clears nullable session selection references.

## OS credential transaction boundary

Native storage uses [keyring's secure platform stores](https://docs.rs/keyring/4.2.0/keyring/v1/), without a plaintext fallback. New keys use staged references; failed DB writes clean up the staged entry and retain the old reference. Guarded provider deletion starts a DB transaction before touching the OS entry and restores the key if commit fails. SQLite and the OS store cannot commit atomically: a process crash between key deletion and DB commit may require API-key registration again. Backing up the database does not export OS credentials.
