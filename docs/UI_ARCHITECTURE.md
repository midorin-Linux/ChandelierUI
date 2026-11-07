# UIの改変方法

## 画面構造と責務

`src/App.tsx` は画面の組み立てとイベントの接続を担当します。Rust IPC・HTTP・SQL・トークン計数・性能計算は表示コンポーネントに置きません。

- `AppLayout`: サイドバーとメイン領域の配置。
- `Sidebar` / `SessionList`: セッション作成・選択。永続化そのものは行いません。
- `ChatWorkspace`: 分析用Hookとチャット表示を接続するコンテナー。`ChatView` は選択セッションのヘッダー・履歴・入力領域を表示します。
- `MessageList` / `MessageItem`: プレーンテキスト表示、コピー、ユーザーメッセージ編集。HTML/Markdownを解釈しません。
- `ChatInput` / `ModelSelector`: IME対応入力・停止・モデル選択。通信はコールバック経由です。
- `SessionTitleForm`: タイトル変更。削除は確認操作を挟みます。
- `SettingsView` / `ProviderSettings` / `ModelSettings`: 設定画面・接続先・モデルの表示とフォーム操作。
- `AppSettings` / `SessionSettings` / `GenerationSettings`: アプリ表示設定と階層別の生成パラメータ。
- `AnalyticsPanel` / `MetricCard` / `ContextUsageIndicator`: Rustが計算済みの値、実行時設定、生成履歴の表示。数値の丸め以外の計測計算は行いません。

表示コンポーネントはpropsとイベントハンドラーを受け取ります。コンポーネントを差し替える際は同じデータとコールバックを新しい表示へ接続すればよく、Rustの変更は不要です。

## 状態管理と呼び出し

- `src/lib/tauri.ts`: Tauri APIをimportする唯一のサービス境界。invoke引数はcamelCase、返却エンティティはRustと同じsnake_caseです。未知のIPCエラーをそのまま表示せず、ユーザー向けエラーへ正規化します。
- `src/hooks/useSessions.ts`: TanStack Queryでbootstrap・セッション詳細を取得し、変更後に該当キャッシュを更新／無効化します。
- `src/hooks/useChat.ts` / `src/stores/chat.ts`: セッションごとの入力・編集・生成状態。Channelのgeneration ID／sequenceを確認し、重複・遅延イベントを除外します。
- `src/hooks/useSettings.ts`: 設定操作とキャッシュ更新。APIキーはフォーム内の一時状態だけに置き、保存後に消去します。
- `src/hooks/useAnalytics.ts` / `src/lib/analytics.ts`: 現行／過去の生成選択と保存済み出力の取得。実行時スナップショットを現在の設定で上書きしません。
- `src/hooks/usePreferences.ts` / `src/hooks/useAutoScroll.ts`: テーマ・OS追従・CSS変数・自動スクロールのDOM効果。
- `src/stores/ui.ts`: Zustandで選択セッションなどのクライアント状態を管理します。DBが永続データの正本です。
- `src/types/domain.ts`: Rust `domain.rs` のIPC型。契約変更では両方と呼び出し元を同時に更新します。

新しいバックエンド操作は、まずサービスに型付き関数を追加し、カスタムHookから呼び、表示にはコールバックだけを渡してください。ReactからSQLやLLMエンドポイントを呼び出す別経路は作りません。ブラウザーのみで開いた際はデスクトップアプリが必要である旨を表示し、ダミーデータには切り替えません。

## デザイン変更

- `src/App.css`: 既存Tailwind/shadcnの読み込み、ライト／ダークのCSS変数、基本スタイル。
- `src/components/workspace.css`: レイアウト・コンポーネント固有の調整。
- `src/components/settings.css`: 設定フォームのレイアウト。
- `src/components/ui`: 既存のButton/Textarea。用途が合う限り再利用し、別のUI基盤を重ねません。

色は `--background`、`--foreground`、`--primary`、`--muted`、`--border` 等、角丸は `--radius` から変更できます。アプリ設定は `--chat-width` と `--chat-font-size` に反映されます。レイアウトを作り直す場合も、キーボード操作・履歴へのスキップリンク・フォーカス表示・IME入力・ローディング／エラー表示・改行の保持・破壊的操作の確認は維持してください。

## 置き換え時の確認

1. `pnpm build` でstrict TypeScriptとViteを確認。
2. `pnpm tauri dev` で実際のIPC経路を確認（ブラウザーだけでは不可）。
3. セッション作成・切り替え・名前変更・削除と、再起動後の復元を確認。
4. チャット／分析のレイアウト変更でも、本文や計測値を表示層で再計算しないでください。
5. `pnpm test` でストリームの重複／遅延・終了状態、分析履歴の選択と未取得値の扱いを確認してください。
