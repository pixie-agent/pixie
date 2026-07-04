# Pixie

[**English**](./README.md) | [**简体中文**](./README.zh.md) | [**日本語**](./README.ja.md)

> **プラグ可能な AI エージェント**用のネイティブデスクトップワークスペース —— プログラミング、オフィス文書、データ分析、ニュース、ライティングなどを処理する汎用エージェント。任意のフォルダで自律エージェントを実行し、セッションごとにエンジンを切り替え、リアルタイムで動作を観察できます。内蔵の**ナレッジベース**は、会話を検索可能でリンク可能なノートとして自動要約します。Tauri v2、React、TypeScript、Rust で構築されています。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg)
![Agents](https://img.shields.io/badge/engines-Claude%20%7C%20Cursor%20%7C%20CodeBuddy-orange.svg)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

![Pixie](src/assets/hero.svg)

Pixie は、**既にインストールされているエージェント CLI**用の軽量で高速なデスクトップシェルです。独自のモデルや API クライアントは搭載されていません —— 外部エージェントプロセスを生成し、その JSON 出力をストリーミングして、洗練されたネイティブアプリとしてレンダリングします。

各会話は**エンジン**（現在：[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Cursor Agent](https://cursor.com/docs/cli/overview)、または [CodeBuddy](https://www.codebuddy.ai/docs/cli/quickstart)���にバインドされます。ワークスペースやセッション間でエンジンを混在できます：Claude で 1 つのチャット、Cursor でもう 1 つ、両方を並行して実行します。

Pixie をプログラミング、オフィス文書、データ分析、ニュース、ライティングなど、ヘッドレスエージェント CLI が選択したフォルダ内のファイルやツールを操作できる場所 anywhere で使用してください。

---

## ハイライト

- **プラグ可能なエンジン** — セッションごとにエンジンを選択。現在は Claude Code と Cursor Agent がサポートされています。バックエンドはさらに追加できるように構築されています。
- **マルチワークスペースエージェント** — 任意の数のフォルダをワークスペースとして追加。それぞれがエージェントの作業ディレクトリになり、多くのセッションを並列でストリーミングできます。
- **ライブエージェントアクティビティ** — シンタックスハイライト付きのストリーミング markdown、リアルタイムのツールコールカード、拡張思考テキスト（エンジン依存）、トークン/コスト/持続時間の読み取り。
- **会話の継続性** — フォローアップメッセージは同じ CLI セッションを再開するため、ターン間でコンテキストが保持されます。
- **エンジンごとのモデル設定** — 設定で各エンジン個別に API キー、モデル、環境変数をオーバーライド。
- **スケジュールされたタスク** — スケジュール（毎日、平日、または N 分/時間ごと）に対してワークスペースでヘッドレスにプロンプトを実行。結果はサイドバーに表示され、デスクトップ通知されます。
- **ワークスペースパネル** — **ファイル**、**プレビュー**、**Git**、**ブラウザ**、リアル**ターミナル**（PTY 対応）を備えたサイズ変更可能なサイドパネル。より深いファイルアクセスとバージョンコントロールアクセスが必要な場合に便利です。
- **ナレッジベース** — 会話は YAML フロントマター付きの Obsidian 互換 markdown ノートとして要約されます。CJK トークン化（jieba）を備えた内蔵 BM25 検索エンジンが、高速検索のために vault をインデックス化します。KB コンテキストがエージェントメッセージに挿入されるため、エージェントは過去の会話を活用できます。関連ノートは `[[wiki-links]]` でリンクされ、発見可能になります。
- **スキル & プラグインマーケットプレイス** — ディスク上のスキルを発見し、コンポーザーから `/skill` 呼び出しを挿入し、マーケットプレイスからプラグインを閲覧またはインストールします。Pixie はスキルとプラグインの **Claude エージェント標準**（`.claude/skills`、`.claude-plugin/` など）に従います —— Claude Code、Cursor Agent、および他の互換エンジン間で共有されている事実上の規約です。
- **システムトレイ常駐** — ウィンドウを閉じるとトレイに最小化されるため、スケジュールされたタスクは実行され続けます。
- **ダーク & ライトテーマ**、システムプロンプト、キーボードショートカット。
- **🌐 多言語対応** — 英語、簡体字中国語、日本語をサポート。

---

## サポートされているエンジン

| エンジン | CLI | メモ |
| --- | --- | --- |
| **Claude Code** | `claude` | リファレンス実装；スキル、プラグイン、MCP |
| **Cursor Agent** | `cursor-agent` / `agent` | マルチモデルループ。同じスキル & プラグインエコシステムをサポート |
| **CodeBuddy** | `cbc` | テンセント AI コーディングエージェント。スキル & プラグイン標準をサポート |

両方のエンジンは同じ**スキル/マーケットプレイス規約**（Claude 形式の `SKILL.md`、プラグインマーケットプレイス、`/skill-name` 呼び出し）を使用します。Pixie は UI でエンジンに依存しない方法で提示します。

Pixie を使用する前に、**少なくとも 1 つ**のエンジンをインストールして認証してください。[前提条件](#前提条件)を参照してください。

---

## 前提条件

- [Node.js](https://nodejs.org/) v18 以降
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) 安定ツールチェーン
- **1 つ以上のエージェント CLI**、インストール済みで認証済み：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `PATH` 内の `claude`
  - [Cursor Agent CLI](https://cursor.com/docs/cli/overview) — `PATH` 内の `cursor-agent` または `agent`
  - [CodeBuddy Code](https://www.codebuddy.ai/docs/cli/quickstart) — `PATH` 内の `cbc`

Pixie は `PATH` と一般的な場所（`/usr/local/bin`、Homebrew、`~/.local/bin`、nvm、`~/.cursor/bin`）でエンジンバイナリを検索します。対話型ログインシェルをソースするため、`.app` バンドルから起動しても環境変数（`ANTHROPIC_*`、`CURSOR_*` など）が取得されます。

## インストール

```bash
git clone https://github.com/white1or1black/pixie.git
cd pixie

pnpm install      # フロントエンド依存関係
```

## 実行

```bash
pnpm tauri dev   # ホットリロード付き開発モード
```

ディストリビュータブルバンドルを生成するには：

```bash
pnpm tauri build                       # OS のすべてのバンドル形式
pnpm tauri build --debug --bundles app # クイックデバッグ .app / 実行可能ファイル
```

> **注意** — エンジンは選択したワークスペース内で許可プロンプトをスキップしてヘッドレスモードで実行されるため、エージェントが読み取りおよび変更することを信頼できるフォルダのみを Pixie に指定してください。[セキュリティとデータ](#セキュリティとデータ)を参照してください。

---

## 使用方法

1. **ワークスペースを追加** — サイドバー → ワークスペーススイッチャー → *ワークスペースを追加*、フォルダを選択。これがエージェントの作業ディレクトリになります（プロジェクト、ノート、運用スクリプト、ディスク上の何でも）。
2. **エンジンを選択** — サイドバーの**エンジン**ドロップダウン（新規セッションのデフォルト）を使用するか、各会話のバインドされたエンジンに依存します。
3. **エージェントを開始** — メッセージを入力して `Enter` を押します。最初のメッセージは新しいセッションを開始し、後のメッセージはそれを再開します。
4. **動作を観察** — ツールコール、結果、思考テキスト、使用量が返信の下でライブ更新されます。
5. **ワークスペースパネルを開く** — ファイル、差分、ターミナル、プレビューが必要に応じてヘッダーでパネルを切り替えます。
6. **スキル & プラグイン** — コンポーザーで ✨ をクリックして `/skill` 呼び出しを選択するか、サイドバーの**スキル**を開いてプラグインマーケットプレイスを管理します。Claude エージェントスキル標準に従う任意のエンジン（Claude Code、Cursor など）で動作します。
7. **自動化** — **スケジュールされたタスク**はタイマーでプロンプトを実行します。完了した実行はサイドバーに表示され、通知されます。
8. **言語を変更** — **設定**を開き、好みの言語（English、简体中文、日本語）を選択します。

### キーボードショートカット

| 操作 | ショートカット |
| --- | --- |
| 新規チャット | `Ctrl/Cmd + N` |
| サイドバーを切り替え | `Ctrl/Cmd + B` |
| 設定を切り替え | `Ctrl/Cmd + ,` |
| ナレッジベースを検索 | `Ctrl/Cmd + K` |
| メッセージを送信 | `Enter` |
| 改行 | `Shift + Enter` |
| 生成を停止 | `Esc` |

---

## ナレッジベース

Pixie には、会話履歴を検索可能なノート vault に変換するローカルファーストのナレッジベースが含まれています。（必須ではありませんが）[Obsidian](https://obsidian.md/) と連携するように設計されています。

### 動作方法

1. **要約** — 会話後、「要約」をクリックして `<vault>/Pixie/<slug>-<convId>.md` として markdown ノートに書き込みます。ノートには YAML フロントマター（タイトル、conversation_id、ワークスペース、エンジン、タグ、作成日）と完全なトランスクリプトが含まれます。
2. **インデックス** — Rust ベースの転置インデックス検索エンジンが vault の `Pixie/` ディレクトリ内のすべての `*.md` ファイルをスキャンします。中国語、日本語、韓国語テキスト用に CJK トークン化（jieba-rs）を備えた BM25 スコアリングインデックスを構築します。
3. **検索** — `Ctrl/Cmd + K` を押して検索パレットを開きます。クエリを入力（最小 2 文字）し、スニペット、タグ、日付付きのデバウンス済み BM25 ランク結果を取得します。`Enter` を押して Obsidian でノートを開くか、内容をインラインでコピーします。
4. **注入** — ナレッジベースを切り替える（入力バーのデータベースシリンダーアイコン）と、検索結果の関連スニペットがエージェントメッセージにコンテキストとして挿入されます。これにより、エージェントは再説明なしに過去の作業を参照できます。
5. **関連リンク** — 新しいノートが書き込まれると、要約ツールは BM25 で関連ノートを検索し、底部に `[[wiki-link]]` 参照を追加して、ナビゲート可能なナレッジグラフを作成します。

### セットアップ

- **vault パスを設定** — 設定（`Ctrl/Cmd + ,`）を開き、Obsidian vault パスを設定します（デフォルト：`~/Documents/Obsidian`）。
- **既存の会話をバックフィル** — 設定の「バックフィル」ボタンを使用して、過去のすべての会話をノートとして要約します。
- **Obsidian との統合はオプション** — KB は完全に Pixie 内で動作します。Obsidian は外部表示/編集のみに必要です。

### キーボードショートカット

| 操作 | ショートカット |
| --- | --- |
| ナレッジベースを検索 | `Ctrl/Cmd + K` |

---

## アーキテクチャ

Pixie は Tauri v2 アプリです：プロセスと PTY ライフサイクルを所有する Rust バックエンドと、IPC ブリッジ経由の React フロントエンド。

```
┌───────────────────────────────────────────────────────┐
│  フロントエンド  ·  React + TypeScript + Tailwind CSS    │
│                                                        │
│  hooks (useChat / useScheduledTasks)                   │
│      │  invoke()  ────────►  Tauri コマンド             │
│      │  listen()  ◄────────  Tauri イベント（ストリーミング）│
└──────────────────────────┬────────────────────────────┘
                           │  Tauri IPC ブリッジ
┌──────────────────────────┴────────────────────────────┐
│  バックエンド  ·  Rust (tokio)                          │
│                                                        │
│  チャット       send_message(engine) / stop_generation  │
│  エンジン      check_engines_available / model config   │
│  ワークスペース select / set_active / list_directory     │
│  KB           search_kb / index_kb / summarize / …     │
│  Git / ファイル / ターミナル / スキル / プラグイン / スケジュール │
│                                                        │
│  イベント: agent-response · agent-tool · agent-done · … │
└──────────────────────────┬────────────────────────────┘
                           │  tokio::process（会話ごとに 1 つの子プロセス）
┌──────────────────────────┴────────────────────────────┐
│  engine/  ·  プラグ可能なエージェントバックエンド          │
│    claude.rs   Claude Code  (--print stream-json)      │
│    cursor.rs   Cursor Agent (--print stream-json)      │
│    mod.rs      NormalizedEvent · spawn · parse_line    │
└───────────────────────────────────────────────────────┘
```

メッセージの流れ：

- フロントエンドは `invoke("send_message", { engine, conversationId, … })` を呼び出します。バックエンドはエンジンを選択し、**会話ごとに** 1 つのプロセスを生成し、すぐに返します。
- 各 NDJSON 行は**正規化イベント**（テキストデルタ、ツール開始/結果、使用量、完了）に解析されます。バックエンドは統一された `agent-*` Tauri イベントを発行します。
- `useChat` は `conversation_id` で更新をルーティングするため、並列セッションは独立したままです。
- `stop_generation` はストリームリーダーをブロックせずに PID で子を強制終了します。

**状態の保存場所：** 会話（セッションごとの `engine` を含む）、ワークスペース、テーマ、エンジンごとのモデル設定は `localStorage` に保存されます。スケジュールされたタスクと実行履歴は OS アプリデータディレクトリに永続化されます。セッション履歴は各エンジンの CLI が所有します（Claude の `--session-id` / `--resume`。Pixie が追跡する Cursor セッション ID）。

### 新しいエンジンを追加

1. `src-tauri/src/engine/mod.rs` の `ENGINE_IDS` と `src/types.ts` の `AGENT_ENGINES` にエンジン ID を追加します。
2. `engine/<name>.rs` を実装します：`check_available`、`spawn_single`、`spawn_continue`、`parse_line`。
3. `engine/mod.rs` でディスパッチを接続します。
4. エンジンが環境オーバーライドを必要とする場合、`ENGINE_MODEL_FIELDS` にモデル設定フィールドを追加します。

---

## プロジェクト構造

```
pixie/
├── src/                         # フロントエンド（React + TypeScript）
│   ├── components/              # ChatView、Sidebar、Settings、RightPanel、…
│   ├── hooks/                   # useChat、useScheduledTasks
│   ├── i18n/                    # 多言語サポート
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── en.json
│   │       ├── zh.json
│   │       └── ja.json
│   ├── App.tsx
│   └── types.ts                 # EngineModelConfigs、AgentEngineId、…
├── src-tauri/
│   ├── src/
│   │   ├── engine/              # プラグ可能なエージェントバックエンド
│   │   │   ├── mod.rs           # NormalizedEvent、AgentProcess、ディスパッチ
│   │   │   ├── claude.rs
│   │   │   ├── cursor.rs
│   │   │   ├── codebuddy.rs
│   │   │   ├── persistent.rs    # 長寿命セッション管理
│   │   │   └── shared.rs        # Shell 環境、バイナリ発見
│   │   ├── search/              # ナレッジベース検索エンジン
│   │   │   ├── mod.rs           # インデックスライフサイクル、Tauri コマンド
│   │   │   ├── bm25.rs          # BM25 スコアリング + jieba-rs CJK トークナイザ
│   │   │   ├── index.rs         # 転置インデックス検索エンジン
│   │   │   └── parser.rs        # Obsidian YAML フロントマザーパーサー
│   │   ├── summarizer.rs        # Conversation → KB ノートライター
│   │   ├── lib.rs               # Tauri コマンド、スケジューラ、トレイ
│   │   └── pty.rs
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

---

## 開発

```bash
pnpm dev                  # Vite 開発サーバーのみ（Tauri シェルなし）
pnpm tauri dev            # ホットリロード付きフルアプリ

pnpm lint                 # ESLint

cd src-tauri
cargo check               # Rust 型チェック
cargo clippy              # Rust リント
cargo test                # ユニットテスト
```

### 主要技術

| レイヤー | テクノロジー |
| --- | --- |
| デスクトップフレームワーク | Tauri v2 |
| フロントエンド | React 19、TypeScript |
| スタイリング | Tailwind CSS 4 |
| ビルドツール | Vite |
| バックエンド | Rust、tokio |
| 国際化 | i18next、react-i18next |
| Markdown | react-markdown + remark-gfm |
| ターミナル | xterm.js + portable-pty |
| スケジューリング | chrono |
| CJK 検索 | jieba-rs（中国語単語分割） |
| BM25 検索 | カスタム転置インデックスエンジン |

### 設定

**設定**（`Ctrl/Cmd + ,`）を開きます：

- **エージェントエンジン** — 各エンジンの可用性、バージョン、バイナリパス。
- **デフォルトエンジン** — 新規セッション作成時に使用。
- **モデル設定** — エンジンごとの環境オーバーライド（デフォルトで折りたたまれています）。Claude：`ANTHROPIC_*`、`CLAUDE_CODE_*`。Cursor：`CURSOR_API_KEY`、`CURSOR_MODEL`。CodeBuddy：`CODEBUDDY_*`。
- **ナレッジベース** — Obsidian vault パス、既存の会話のバックフィル、インデックスの再構築。
- **システムプロンプト** — エージェントセッションのオプションプロンプト。
- **テーマ** — ダークまたはライト。
- **言語** — English、简体中文、日本語。

---

## セキュリティとデータ

- エンジンはアクティブワークスペース内で自動承認されたツール実行でヘッドレスモードで実行されます。エージェントに操作を信頼できるワークスペースのみを追加してください。
- Claude の `AskUserQuestion` ツールはストリーミングモードで無効になります（回答するチャネルがないため）。モデルは代わりにプレーンテキストで質問するように誘導されます。
- チャットコンテンツ、ワークスペース、設定はローカルに留まります。スケジュールされたタスクと実行履歴はアプリデータディレクトリにあります。設定したエージェント CLI を通じて以外、どこにも何も送信されません。

---

## トラブルシューティング

**利用可能なエンジンがない** — 少なくとも 1 つの CLI（`claude`、`cursor-agent`、または `cbc`）をインストールします。設定 → *更新* を確認します。`claude --version`、`cursor-agent --version`、または `cbc --version` で確認します。

**環境変数が取得されない** — Pixie はログインシェル（`$SHELL -i -l -c env`）をソースします。`.zprofile` / `.zshrc` を編集した後にアプリを再起動します。

**セッションでエンジンが間違っている** — 各会話はバインドされたエンジンを保持します。新しいセッションを開始するか、新しいチャットに異なるデフォルトエンジンを選択してください。

**ビルドエラー** — `rustup update`、`cd src-tauri && cargo clean`、`rm -rf node_modules && pnpm install`。

**スケジュールされたタスクが実行されなかった** — Pixie が実行されている必要があります（トレイでも OK）。5 分以上遅れたタスクは追いつきバーストを避けるためにスキップされます。*今すぐ実行*でテストしてください。

**ナレッジベース検索で結果が返らない** — 設定の vault パスが `Pixie/` サブフォルダ内の `.md` ファイルを含む有効なディレクトリを指していることを確認してください。インデックスが古い場合は、設定の「インデックスを再構築」を使用してください。最小クエリ長は 2 文字です。

**KB ノートが表示されない** — 最初に会話を要約してください。ノートは `<vault>/Pixie/` に書き込まれます。vault を移動または名前変更した場合は、設定でパスを更新してインデックスを再構築してください。

---

## 貢献

貢献を歓迎します — 特に新しい**エンジン**と汎用エージェント UX の改善：

1. リポジトリをフォークして機能ブランチを作成します。
2. Rust：`cargo fmt` / `cargo clippy`。フロントエンド：`pnpm lint`。
3. Tauri コマンドをエンドツーエンドで型付け（Rust ↔ `src/types.ts`）します。
4. 変更を説明するプルリクエストを開きます。

### 翻訳を追加する

翻訳を貢献するには：

1. `src/i18n/locales/ja.json`、`src/i18n/locales/en.json`、または `src/i18n/locales/zh.json` を編集します。
2. 既存の JSON 構造に従います。
3. プルリクエストを開きます。

詳細については、[i18n ドキュメント](./PROJECT_I18N_INDEX.md)を参照してください。

## ライセンス

[MIT ライセンス](LICENSE)でリリースされています。
