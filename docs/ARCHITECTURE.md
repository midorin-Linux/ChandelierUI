# Architecture

Chandelier UI is one Tauri 2 application. The frontend never connects to an LLM server or opens SQLite directly. There is no separately deployed application server.

## Boundaries

- `src-tauri/src/commands.rs`: Tauri IPC boundary and application state. Commands accept typed payloads and return serializable, sanitized `AppError` values.
- `src-tauri/crates/chandelier-core/src/domain.rs`: shared persistence/IPC entities. Field names remain snake_case on the wire; invoke argument names follow Tauri's camelCase convention.
- `chandelier-core/src/infrastructure/database.rs`: SQLx, migrations, transactions and recovery. No React/Tauri dependency.
- `chandelier-core/src/services`: 生成ライフサイクル、階層別パラメータ、プロバイダー／モデル／アプリ設定のユースケース。
- `chandelier-core/src/infrastructure/http.rs`: OpenAI互換アダプター、再利用するreqwest接続プール、バイト境界に依存しないSSE解析。
- `chandelier-core/src/infrastructure/credentials.rs`: OS資格情報ストア。DBには参照のみ。
- `chandelier-core/src/telemetry`: 単調クロック・API報告usageからの計測、派生値と取得不能値の扱い。
- React presentation is replaceable independently of the Rust crate. Only the frontend IPC service imports Tauri APIs.

The existing Rust workspace is retained rather than adding a second backend. The core crate can be exercised without a webview or paid API.

TanStack Query handles persisted asynchronous data; Zustand handles selection and per-session live state. Provider variations are explicit settings on one adapter, not a plugin/trait framework without a second implementation. Standard platform clipboard and file locking avoid additional plugins.

## Storage and history

The desktop application resolves Tauri's application data directory and creates `chandelier.sqlite3` there. The database is not stored beside the executable or in this repository. WAL and foreign keys are enabled on connections. Schema changes use SQLx migrations.

A generation is an attempt, not an overwritten assistant answer. Editing or regenerating deactivates superseded messages while preserving their rows, request snapshots and generation records. Active messages form the visible conversation; session detail also exposes historical generation records. Session deletion intentionally deletes its conversation and attempts. Referenced provider/model records must not be silently removed from historical data.

Only one pending/streaming generation is permitted per session. Startup recovery changes unfinished attempts to failed and retains their last checkpoint. Checkpointing bounds crash loss; it is not a guarantee that the last received character has reached durable storage.

## Security boundaries

All SQL values are bound parameters. API keys do not belong in settings, request snapshots, events or logs. Credentials belong in the OS credential store, and inability to access it is an error rather than permission to save plaintext. Conversation text is rendered as React text, never HTML/Markdown.

Custom IPC commands are available only to the application's local webview. Unneeded opener permissions/plugins are removed. URL/settings validation belongs in Rust; frontend field constraints are only usability aids.

## Contracts

TypeScript uses strict mode and explicitly mirrored entity types. Rust serializes the actual entities at the IPC boundary. Contract changes must update `domain.rs`, `src/types` and IPC consumers together; a frontend build alone cannot prove runtime IPC compatibility. Exercise the desktop path after changing either side.

Metrics use serde_json's `float_roundtrip` feature so SQLite JSON round trips retain the observed floating-point values. Timing definitions and unavailable values are part of the contract, not frontend calculations; see `ANALYTICS.md`. A future API adapter belongs at the HTTP boundary, a future exact tokenizer at telemetry, and a new visual design only in frontend presentation/styles.
