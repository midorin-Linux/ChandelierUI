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

```
pnpm build
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
