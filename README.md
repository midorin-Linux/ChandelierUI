# Chandelier UI v0.1

OpenAI互換Chat Completions APIを使う、React + Tauri 2 + Rustのローカルデスクトップチャットアプリです。独立したアプリケーションサーバーは不要です。会話・生成試行・設定・計測結果はSQLiteに保存し、APIキーはOS資格情報ストアに保存します。

## 起動

前提: Node.js 24以降、pnpm、Rust、[Tauriのプラットフォーム要件](https://v2.tauri.app/start/prerequisites/)。WindowsのPowerShellでは `pnpm`、シェルが同名のPOSIXスクリプトを選ぶ場合は `pnpm.cmd` を使ってください。

```
pnpm install --frozen-lockfile
pnpm tauri dev
```

ブラウザーだけで `pnpm dev` を開いても、DB/HTTP/資格情報ストアは利用できません。ダミーデータへのフォールバックはありません。

1. 設定画面でプロバイダーを追加します。Base URLはAPIルート（例: `https://api.openai.com/v1`、`http://localhost:1234/v1`）。
2. 認証不要、またはBearer + APIキーを選び、保存・接続テストを行います。
3. モデル一覧を取得、またはモデルを手動追加します。コンテキスト長が不明なら空欄のままにします。
4. セッションを作成し、モデルを選択して送信します。Enterで送信、Shift+Enterで改行。IME変換中は送信しません。
5. 生成を停止しても部分テキストは残ります。再生成・ユーザーメッセージ編集は、過去の生成試行とリクエストを上書きしません。

`stream_options.include_usage` 非対応のサーバーでは、プロバイダー設定のUsage取得を無効にしてください。Usageがなくても時間計測は利用できます。API報告のスループットは、可視テキストだけのTPSではありません。

## 開発・検証

`@/` はプロジェクトルートを指します。Viteは `resolve.tsconfigPaths` で `tsconfig.json` のパスマッピングを共有します。

現在のチャットUIはTauriの `chat_completion` コマンドからOpenAI互換APIへSSEストリーミングで送信します（`stream: true`, `stream_options: {include_usage: true}`）。チャット本文は受信完了後に表示します。Base URLにAPIルート（例: `http://localhost:1234/v1`）を入力してEnterで確定すると、`list_models` コマンドが `GET /models` を呼び出します。入力中は取得せず、確定済みのURLを接続先に使用します。同じURLでEnterを押すかRefreshで再取得できます。返された実際のモデルIDをプロバイダー設定とモデルピッカーで共有します。固定のモデル候補やダミーデータへのフォールバックはありません。取得中・取得失敗・空一覧では実際の送信を行わず、理由を表示して入力を保持します。認証不要のエンドポイント向けで、APIキー認証は未対応です。HTTPはループバックのみ、それ以外はHTTPSを使用します。

送信ボタンまたはEnterで送信し、Shift+Enterで改行します。System prompt・Effort・会話履歴を含めて送信し、応答を会話に追加します。失敗時はユーザーメッセージを保持してエラーを表示し、再試行できます。送信中は重複送信を防ぎます。設定と会話はメモリー内のみで、再読み込みすると消えます。

`src/types/chat.ts` の `ProviderChatRequest` は接続先の `provider.base_url` と、Chat Completions形式の `request`（`model`・`messages`・`reasoning_effort`）を分けます。「Request JSON」は現在の設定と履歴のプレビューです。System promptは空でなければ先頭のsystemメッセージになります。通信時はUIのEffort `off`を`none`、`max`を`xhigh`に変換します。その他はそのまま送信するため、プロバイダーとモデルが対応する値を選んでください。

Analysisは送信・再試行ごとの計測履歴を保持します。TTFBは最初の空でないレスポンス本文バイトをアプリが受け取るまで、TTFTは最初の空でない表示テキストdeltaを受け取るまで、E2Eは完了までの単調時計による経過時間です。DecodeはE2E−TTFT、TPSはAPI出力トークン数÷Decode秒、平均TPOTはDecode÷（出力トークン数−1）です。出力トークン数には推論トークンが含まれる場合があり、可視テキストだけのTPSではありません。

SSEのイベントは複数トークンを含み得るため、厳密なITL平均・最大・標準偏差は取得不可とし、代わりに空でないテキストdeltaの受信間隔を別欄で表示します。DNS/TCP/TLSと接続確立の内訳は現在のHTTPクライアントでは取得不可です。PrefillとサーバーDecodeは対応サーバーの `timings.prompt_ms` / `timings.predicted_ms` のみを使用します。usageが欠ける場合や、`/models` に正の `context_length` がない場合、トークン数・TPS・コンテキスト使用率を推定せず取得不可とします。

各試行には送信時点のモデル・Base URL・ローカル/外部分類・時刻・同時リクエスト数・設定と、HTTPステータス・終了理由・タイムアウト・エラーを記録します。温度とmax_tokensは未指定（プロバイダー既定値）です。エラー率・タイムアウト率の分母はこの画面で記録した試行数、リトライ回数は明示的なRetryの試行数です。自動再試行や非ストリーミングへの自動切替はしません。履歴はメモリー内のみです。

```
pnpm build
node --experimental-strip-types src/lib/analysis.test.ts
pnpm exec eslint src
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
pnpm tauri build
```

主要APIテストはローカルのテストサーバーで動作し、有料APIや実在するキーを必要としません。OSストアの明示的な確認:

```
cargo test --manifest-path src-tauri/Cargo.toml -p chandelier-core native_store_roundtrip_and_deletion -- --ignored
```

既存の `just dev` / `just build` / `just web-build` / `just web-test` / `just rust-test` / `just clippy` も利用できます。`just fmt` はnightly rustfmtを使用します。`just deny` は別途cargo-denyとアドバイザリDBへのネットワークアクセスが必要です。

## 構成と改変

- `src/`: props中心の表示コンポーネント、カスタムHook、Zustand、TanStack Query、型付きIPCサービス。
- `src-tauri/`: Tauriの起動・Commands・権限設定。
- `src-tauri/crates/chandelier-core/`: Tauri非依存のドメイン、サービス、SQLx/HTTP/資格情報、計測。
- `docs/ARCHITECTURE.md`: レイヤーと契約。
- `docs/DATABASE.md`: スキーマと履歴・復旧・削除の扱い。
- `docs/API_COMPATIBILITY.md`: APIルート、互換性、パラメータ、ストリーミング。
- `docs/ANALYTICS.md`: 指標の定義・計算方法・取得不能値。
- `docs/UI_ARCHITECTURE.md`: UIの差し替え、状態管理、デザイン変更。

UIの色・角丸・レイアウト・タイポグラフィを変更するためにRustを変更する必要はありません。API契約を変更する場合だけ、Rustドメイン型とTypeScript型・サービス・利用箇所をまとめて更新してください。

## データと制限

データ保存先は設定画面に表示します。DBはTauriのアプリデータディレクトリに置き、WAL・外部キー・マイグレーション・トランザクション・未完了生成の復旧を使用します。アプリは同じデータ領域に対する二重起動を拒否します。

会話DBは暗号化されません。閉じた状態でデータディレクトリをバックアップし、OSアカウントとディスクを保護してください。DBの移動ではOS資格情報は移動しないため、キーの再登録が必要です。資格情報ストアが使えない環境では平文保存せず明示的に失敗します。リモートAPIにはHTTPSを使用してください。

Markdown、添付、Tool Calling、MCP、RAG、クラウド同期、複数モデルの並列生成は対象外です。メッセージは改行を保ったプレーンテキストです。正確な可視トークン計数器は導入せず、取得不能値・不明なコンテキスト長を捏造しません。
