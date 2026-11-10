# Rust IPCコマンド一覧

UI再構築用の現行契約です。実装: `src-tauri/src/commands.rs`。登録: `src-tauri/src/lib.rs`。Rust型: `src-tauri/crates/chandelier-core/src/domain.rs`。対応するTypeScript型: `src/types/domain.ts`。既存の呼び出しサービス: `src/lib/tauri.ts`。

## 共通規約

- `invoke` のコマンド名はsnake_case、外側の引数名はcamelCaseです。
- `input` / `provider` / `model` の中身と戻り値のフィールドはsnake_caseです。
- `State<AppState>` はRust内部用です。Frontendから渡しません。
- エラーはPromiseのrejectとして `{ code: string, message: string }` を返します。表示にはこの安全化済みmessageを使います。
- Rustの `Option<T>` は `T | null`。`Result<()>` は戻り値を利用しない `invoke<void>` として扱います。
- created_at等はUnix epochミリ秒、計測値の `*_ms` は経過ミリ秒です。

## セッション・履歴

| コマンド | invoke引数 | 戻り値 | 動作・注意 |
| --- | --- | --- | --- |
| `bootstrap` | なし | `Bootstrap` | セッション一覧、プロバイダー、モデル、実効アプリ設定、データ保存先。初期表示で取得 |
| `create_session` | `{ title }` | `Session` | 新規作成。有効なら最後に選択したモデルを適用 |
| `session_detail` | `{ sessionId }` | `SessionDetail` | 現在有効なメッセージ、全生成試行、保存済みメトリクス |
| `update_session` | `{ sessionId, title, modelId, settings }` | `Session` | タイトル・選択モデル・セッション生成設定をまとめて更新。modelIdはnull可。最後のモデル選択も記憶 |
| `delete_session` | `{ sessionId }` | void | 会話・生成履歴・分析結果を削除。UIで確認を挟む |
| `generation_message` | `{ generationId }` | `Message` | 編集・再生成で非表示になった過去の出力も取得可能 |

`update_session.settings` はアプリ設定ではなく、生成パラメータのJSONオブジェクトです。変更しないtitle/modelId/settingsも現在値を渡してください。生成中のセッション更新・削除は拒否します。

`Bootstrap`:

```ts
{
  sessions: Session[]
  providers: Provider[]
  models: Model[]
  settings: AppPreferences
  data_directory: string
}
```

`SessionDetail`:

```ts
{
  session: Session
  messages: Message[]       // activeな会話のみ、ordinal順
  generations: Generation[] // 過去の試行を含む
  metrics: GenerationMetrics[] // generation_idで対応付ける
}
```

## チャット・ストリーミング

| コマンド | invoke引数 | 戻り値 | 動作 |
| --- | --- | --- | --- |
| `generate` | `{ input, onEvent }` | void | Channelへイベントを送り、終了状態の保存まで待つ |
| `cancel_generation` | `{ sessionId }` | void | 当該セッションのHTTP通信を中断。部分テキストを保持。停止対象がなくても成功 |

```ts
type GenerateInput = {
  session_id: string
  action: "send" | "regenerate" | "edit"
  content: string | null
  message_id: string | null
  parameters: GenerationParameters
}
```

- send: contentに本文、message_idはnull。
- regenerate: 最新のアシスタント応答を再生成。content/message_idはnull。
- edit: message_idに編集対象のユーザーメッセージID、contentに新本文。以降の有効な会話を置き換えますが、旧レコード・生成スナップショットは保持します。
- モデルはセッションのselected_model_idで決まります。送信前に目的のセッション・モデルを選択してください。
- 同一セッションの同時生成は1件だけです。

```ts
import { Channel, invoke } from "@tauri-apps/api/core"
import type { GenerateInput, StreamEvent } from "../types/domain"

const channel = new Channel<StreamEvent>()
channel.onmessage = (event) => {
  // session_id / generation_id / sequenceで対応付ける。
  // deltaは追加文字列。completed/cancelled/errorで最終状態を確定する。
}

const input: GenerateInput = {
  session_id: selectedSessionId,
  action: "send",
  content: draft,
  message_id: null,
  parameters: {},
}
await invoke<void>("generate", { input, onEvent: channel })
```

これはサービス層へ置く呼び出し例です。表示コンポーネントから直接invokeせず、Hook等を経由してください。

Channelイベント:

```ts
type StreamEvent = {
  generation_id: string
  session_id: string
  sequence: number
  kind: "started" | "delta" | "usage" | "completed" | "cancelled" | "error"
  message_id: string | null
  delta: string | null
  metrics: GenerationMetrics | null
  error: AppError | null
}
```

| kind | UIの処理 |
| --- | --- |
| started | 生成・アシスタントメッセージIDを登録。入力は永続化済み。履歴を再取得 |
| delta | 非空テキストを追加。必要なら付属metricsを更新 |
| usage | Rust計算済みのmetricsを更新。本文に追加しない |
| completed | 成功として確定し、履歴・メトリクスを再取得 |
| cancelled | 中断状態。受信済み本文を保持し、エラー扱いにしない |
| error | 失敗状態と安全化済みerrorを表示。部分本文を保持 |

**generateのPromise解決だけで生成成功と判断しないでください。** API失敗・キャンセルはterminal Channelイベントとして通知され、その後Promiseが解決する場合があります。開始前の検証失敗やDB/IPC失敗はrejectされます。両方を処理し、terminalイベントを受け取れない場合は停止要求と履歴の再取得で状態を照合してください。自動再送は行いません。

ストリーム中の表示はChannelの累積本文を正本にし、DBチェックポイントの本文と二重に連結しないでください。古いgeneration_id、重複sequence、終了後のdeltaを無視してください。

## プロバイダー・モデル

| コマンド | invoke引数 | 戻り値 | 動作・注意 |
| --- | --- | --- | --- |
| `save_provider` | `{ provider, apiKey }` | `Provider` | 追加・編集。キーはOSストアへ保存。null/空文字は既存キー保持 |
| `delete_provider` | `{ providerId }` | void | 未使用の子モデルも同一トランザクションで削除。履歴参照・生成中は全体を拒否 |
| `test_provider` | `{ providerId }` | void | 保存済み設定でGET models。未保存フォームの値は使わない |
| `refresh_models` | `{ providerId }` | `Model[]` | GET modelsからキャッシュ更新。手動設定・未検出の既存モデルを保持 |
| `save_model` | `{ model }` | `Model` | 手動追加・表示名/コンテキスト長/機能/既定値の編集 |
| `delete_model` | `{ modelId }` | void | 履歴から参照されている場合は拒否。セッション選択の参照はnullへ |

Providerの必須フィールド: `id, name, base_url, authentication_mode, credential_reference, timeout_seconds, supports_usage, default_parameters, created_at`。新規idにはUUIDを使用します。認証は `none | bearer`。Base URLは `https://api.openai.com/v1` のようなAPIルートです。credential_referenceはサーバー管理で、呼び出し側からの指定は信用しません。新規created_atはRustで設定します。認証なしへ変更して保存すると古いキー参照とキーを削除します。

Modelの必須フィールド: `id, provider_id, model_identifier, display_name, context_window, capabilities, default_parameters`。context_windowは正の整数またはnull。保存済みモデルのprovider_id/model_identifierは変更不可で、組み合わせは一意です。別モデルとして新規登録してください。

capabilitiesは `{ unsupported_parameters?: NumericParameter[], max_tokens_parameter?: "max_tokens" | "max_completion_tokens" }`。未知のコンテキスト長は推測で埋めません。

## アプリ・生成設定

| コマンド | invoke引数 | 戻り値 | 動作 |
| --- | --- | --- | --- |
| `save_settings` | `{ settings }` | 実効アプリ設定 | 指定した編集可能キーを保存し、ログレベルも反映 |

アプリ設定:

| キー | 型・範囲 | 初期値 |
| --- | --- | --- |
| theme | system / light / dark | system |
| chat_width | 整数480～1600 px | 880 |
| font_size | 整数12～28 px | 15 |
| auto_scroll | boolean | true |
| log_level | off / error / warn / info / debug / trace | info |
| generation | GenerationParameters | {} |
| last_model_id | string / null、サーバー管理 | null |

last_model_idをsave_settingsへ渡しても変更しません。モデル選択にはupdate_sessionを使います。テーマ、幅、フォント、自動スクロールの実際のDOM反映は新UIの責務です。保存先はbootstrap.data_directoryを表示します。

GenerationParametersで指定可能なのは `system_prompt`（文字列）、`temperature`（0～2）、`top_p`（0～1）、`max_completion_tokens`（正の整数、最大2147483647）、`frequency_penalty` / `presence_penalty`（-2～2）。各キーは省略・nullも可能です。

優先順位はアプリ → プロバイダー → モデル → セッション → リクエスト。省略は継承、nullは継承値の削除です。最終的なAPIパラメータと本文は生成記録へ保存します。

## 分析・更新通知

分析専用コマンドはありません。session_detail.metricsをgeneration_idで選び、生成中はChannel.metricsを使います。過去の本文はgeneration_messageで取得します。Frontendは表示用の丸めだけを行い、TTFT・TPS・コンテキスト率を再計算しません。定義は `ANALYTICS.md` を参照してください。

設定変更などの全体通知イベントはありません。変更後にbootstrapと関連するsession_detailを再取得してください。APIキーはフォーム内の一時状態だけに保持し、保存後に消去します。戻り値・キャッシュへキーそのものは入りません。
