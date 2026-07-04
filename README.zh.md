# Pixie

[**English**](./README.md) | [**简体中文**](./README.zh.md) | [**日本語**](./README.ja.md)

> 一个用于**可插拔 AI 代理**的原生桌面工作区——一个处理编程、办公文档、数据分析、新闻、写作等的通用代理。对任何文件夹运行自主代理，按会话切换引擎，并实时观察它们的工作。内置**知识库**将对话自动总结为可搜索、可链接的笔记。使用 Tauri v2、React、TypeScript 和 Rust 构建。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg)
![Agents](https://img.shields.io/badge/engines-Claude%20%7C%20Cursor%20%7C%20CodeBuddy-orange.svg)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

![Pixie](src/assets/hero.svg)

Pixie 是一个轻量、快速的桌面外壳，用于**您已安装的代理 CLI**。它不附带自己的模型或 API 客户端——它生成一个外部代理进程，流式传输其 JSON 输出，并将其渲染为一个精致的原生应用程序。

每个对话绑定到一个**引擎**（目前：[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Cursor Agent](https://cursor.com/docs/cli/overview) 或 [CodeBuddy](https://www.codebuddy.ai/docs/cli/quickstart)）。您可以在工作区和会话中混合使用引擎：一个对话使用 Claude，另一个使用 Cursor，两者并行运行。

将 Pixie 用于编程、办公文档、数据分析、新闻、写作——只要无头代理 CLI 可以对您选择的文件夹中的文件和工具进行操作的任何地方。

---

## 主要特性

- **可插拔引擎** — 每个会话选择一个引擎。目前支持 Claude Code 和 Cursor Agent；后端已准备好添加更多引擎。
- **多工作区代理** — 添加任意数量的文件夹作为工作区。每个文件夹都成为代理的工作目录，许多会话可以并行流式传输。
- **实时代理活动** — 流式 markdown、语法高亮、实时工具调用卡片、扩展思考文本（取决于引擎）以及 token/成本/持续时间读数。
- **对话连续性** — 后续消息恢复同一个 CLI 会话，因此上下文在轮次之间保持。
- **每引擎模型配置** — 在设置中分别为每个引擎覆盖 API 密钥、模型和环境变量。
- **计划任务** — 按计划（每天、工作日或每 N 分钟/小时）对工作区无头运行提示。结果出现在侧边栏中并带有桌面通知。
- **工作区面板** — 一个可调整大小的侧面板，包含**文件**、**预览**、**Git**、**浏览器**和真正的**终端**（PTY 支持）。当您需要更深入的文件和版本控制访问时非常有用。
- **知识库** — 对话被总结为与 Obsidian 兼容的 markdown 笔记，并带有 YAML 前言。内置 BM25 搜索引擎（通过 jieba 进行 CJK 分词）对保险库进行索引以快速检索。KB 上下文被注入到代理消息中，以便代理可以利用过去的对话。相关笔记通过 `[[wiki-links]]` 链接以提高可发现性。
- **技能和插件市场** — 在磁盘上发现技能，从编辑器中插入 `/skill` 调用，并从市场浏览或安装插件。Pixie 遵循技能和插件的 **Claude 代理标准**（`.claude/skills`、`.claude-plugin/` 等）——由 Claude Code、Cursor Agent 和其他兼容引擎共享的事实约定。
- **系统托盘驻留** — 关闭窗口会隐藏到托盘，以便计划任务继续运行。
- **深色和浅色主题**、系统提示、键盘快捷键。
- **🌐 多语言支持** — 支持英语、简体中文和日语。

---

## 支持的引擎

| 引擎 | CLI | 说明 |
| --- | --- | --- |
| **Claude Code** | `claude` | 参考实现；技能、插件、MCP |
| **Cursor Agent** | `cursor-agent` / `agent` | 多模型循环；支持相同的技能和插件生态系统 |
| **CodeBuddy** | `cbc` | 腾讯 AI 编码代理；支持技能和插���标准 |

两种引擎都使用相同的**技能/市场约定**（Claude 格式的 `SKILL.md`、插件市场、`/skill-name` 调用）。Pixie 在 UI 中以引擎无关的方式呈现它们。

在使用 Pixie 之前，安装**至少一个**引擎并对其进行身份验证。参见[先决条件](#先决条件)。

---

## 先决条件

- [Node.js](https://nodejs.org/) v18 或更新版本
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) 稳定工具链
- **一个或多个代理 CLI**，已安装并经过身份验证：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — 您的 `PATH` 中的 `claude`
  - [Cursor Agent CLI](https://cursor.com/docs/cli/overview) — 您的 `PATH` 中的 `cursor-agent` 或 `agent`
  - [CodeBuddy Code](https://www.codebuddy.ai/docs/cli/quickstart) — 您的 `PATH` 中的 `cbc`

Pixie 在 `PATH` 以及常见位置（`/usr/local/bin`、Homebrew、`~/.local/bin`、nvm、`~/.cursor/bin`）中搜索引擎二进制文件。它获取您的交互式登录 shell，因此即使在从 `.app` 包启动时也会拾取环境变量（`ANTHROPIC_*`、`CURSOR_*` 等）。

## 安装

```bash
git clone https://github.com/white1or1black/pixie.git
cd pixie

pnpm install      # 前端依赖
```

## 运行

```bash
pnpm tauri dev   # 开发模式，支持热重载
```

要生成可分发包：

```bash
pnpm tauri build                       # 为您的操作系统生成所有包格式
pnpm tauri build --debug --bundles app # 快速调试 .app / 可执行文件
```

> **注意** — 引擎以无头模式运行，在工作区内自动批准工具执行。仅将 Pixie 指向您信任代理读取和修改的文件夹。参见[安全与数据](#安全与数据)。

---

## 使用方法

1. **添加工作区** — 侧边栏 → 工作区切换器 → *添加工作区*，然后选择一个文件夹。这是代理的工作目录（项目、笔记、运维脚本、磁盘上的任何内容）。
2. **选择引擎** — 使用侧边栏中的**引擎**下拉菜单（新会话的默认值）或依赖每个对话绑定的引擎。
3. **启动代理** — 输入消息并按 `Enter`。第一条消息开始一个新会话；随后的消息恢复它。
4. **观察它工作** — 工具调用、结果、思考文本和用量在回复下方实时更新。
5. **打开工作区面板** — 在标题栏中切换面板以查看文件、差异、终端和预览。
6. **技能和插件** — 在编辑器中点击 ✨ 以选择 `/skill` 调用，或在侧边栏中打开**技能**以管理插件市场。适用于任何遵循 Claude 代理技能标准的引擎（Claude Code、Cursor 等）。
7. **自动化** — **计划任务**按计时器运行提示。完成的运行出现在侧边栏中并通知您。
8. **更改语言** — 打开**设置**并选择您的首选语言（English、简体中文或日本語）。

### 键盘快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新对话 | `Ctrl/Cmd + N` |
| 切换侧边栏 | `Ctrl/Cmd + B` |
| 打开设置 | `Ctrl/Cmd + ,` |
| 搜索知识库 | `Ctrl/Cmd + K` |
| 发送消息 | `Enter` |
| 新行 | `Shift + Enter` |
| 停止生成 | `Esc` |

---

## 知识库

Pixie 包含一个本地优先的知识库，将您的对话历史转换为可搜索的笔记库。它设计为与（但不要求）[Obsidian](https://obsidian.md/) 一起使用。

### 工作原理

1. **总结** — 对话后，点击"总结"将其作为 markdown 笔记写入 `<vault>/Pixie/<slug>-<convId>.md`。笔记包括 YAML 前言（标题、conversation_id、工作区、引擎、标签、创建时间）和完整的对话记录。
2. **索引** — 基于 Rust 的倒排索引搜索引擎扫描保险库的 `Pixie/` 目录中的所有 `*.md` 文件。它构建一个带有 CJK 分词（jieba-rs）的 BM25 评分索引，用于中文、日文和韩文文本。
3. **搜索** — 按 `Ctrl/Cmd + K` 打开搜索面板。键入查询（最少 2 个字符）并获得带有片段、标签和日期的防抖 BM25 排序结果。按 `Enter` 在 Obsidian 中打开笔记，或内联复制内容。
4. **注入** — 切换知识库（输入栏中的数据库圆柱体图标）以将搜索结果中的相关片段注入到代理消息中作为上下文。这使代理可以引用过去的工作而无需重新解释。
5. **相关链接** — 编写新笔记时，总结器通过 BM25 搜索相关笔记，并在底部附加 `[[wiki-link]]` 引用，创建可导航的知识图谱。

### 设置

- **配置保险库路径** — 打开设置（`Ctrl/Cmd + ,`）并设置您的 Obsidian 保险库路径（默认：`~/Documents/Obsidian`）。
- **回填现有对话** — 使用设置中的"回填"按钮将所有过去的对话总结为笔记。
- **Obsidian 集成是可选的** — KB 完全在 Pixie 内工作。Obsidian 仅用于外部查看/编辑。

### 键盘快捷键

| 操作 | 快捷键 |
| --- | --- |
| 搜索知识库 | `Ctrl/Cmd + K` |

---

## 架构

Pixie 是一个 Tauri v2 应用程序：一个拥有进程和 PTY 生命周期的 Rust 后端，以及一个通过 IPC 桥接的 React 前端。

```
┌───────────────────────────────────────────────────────┐
│  前端  ·  React + TypeScript + Tailwind CSS              │
│                                                        │
│  hooks (useChat / useScheduledTasks)                   │
│      │  invoke()  ────────►  Tauri 命令                │
│      │  listen()  ◄────────  Tauri 事件（流式）        │
└──────────────────────────┬────────────────────────────┘
                           │  Tauri IPC 桥
┌──────────────────────────┴────────────────────────────┐
│  后端  ·  Rust (tokio)                                  │
│                                                        │
│  聊天         send_message(engine) / stop_generation   │
│  引擎        check_engines_available / model config   │
│  工作区      select / set_active / list_directory     │
│  知识库      search_kb / index_kb / summarize / …     │
│  Git / 文件 / 终端 / 技能 / 插件 / 计划任务            │
│                                                        │
│  事件: agent-response · agent-tool · agent-done · …    │
└──────────────────────────┬────────────────────────────┘
                           │  tokio::process（每个对话一个子进程）
┌──────────────────────────┴────────────────────────────┐
│  engine/  ·  可插拔代理后端                             │
│    claude.rs   Claude Code  (--print stream-json)      │
│    cursor.rs   Cursor Agent (--print stream-json)      │
│    mod.rs      NormalizedEvent · spawn · parse_line    │
└───────────────────────────────────────────────────────┘
```

消息流程：

- 前端调用 `invoke("send_message", { engine, conversationId, … })`。后端选择引擎，**每个对话**生成一个进程，并立即返回。
- 每个 NDJSON 行被解析为**标准化事件**（文本增量、工具开始/结果、用量、完成）。后端发出统一的 `agent-*` Tauri 事件。
- `useChat` 通过 `conversation_id` 路由更新，以便并行会话保持独立。
- `stop_generation` 通过 PID 终止子进程，而不阻塞流读取器。

**状态存储位置：** 对话（包括每会话的 `engine`）、工作区、主题和每引擎模型配置存储在 `localStorage` 中。计划任务和运行历史持久化在操作系统应用数据目录下。会话历史由每个引擎的 CLI 拥有（Claude 的 `--session-id` / `--resume`；Pixie 跟踪的 Cursor 会话 id）。

### 添加新引擎

1. 在 `src-tauri/src/engine/mod.rs` 中的 `ENGINE_IDS` 和 `src/types.ts` 中的 `AGENT_ENGINES` 中添加引擎 id。
2. 实现 `engine/<name>.rs`：`check_available`、`spawn_single`、`spawn_continue`、`parse_line`。
3. 在 `engine/mod.rs` 中连接调度。
4. 如果引擎需要环境覆盖，在 `ENGINE_MODEL_FIELDS` 中添加模型配置字段。

---

## 项目结构

```
pixie/
├── src/                         # 前端（React + TypeScript）
│   ├── components/              # ChatView、Sidebar、Settings、RightPanel、…
│   ├── hooks/                   # useChat、useScheduledTasks
│   ├── i18n/                    # 多语言支持
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── en.json
│   │       ├── zh.json
│   │       └── ja.json
│   ├── App.tsx
│   └── types.ts                 # EngineModelConfigs、AgentEngineId、…
├── src-tauri/
│   ├── src/
│   │   ├── engine/              # 可插拔代理后端
│   │   │   ├── mod.rs           # NormalizedEvent、AgentProcess、调度
│   │   │   ├── claude.rs
│   │   │   ├── cursor.rs
│   │   │   ├── codebuddy.rs
│   │   │   ├── persistent.rs    # 长生命会话管理
│   │   │   └── shared.rs        # Shell 环境、二进制发现
│   │   ├── search/              # 知识库搜索引擎
│   │   │   ├── mod.rs           # 索引生命周期、Tauri 命令
│   │   │   ├── bm25.rs          # BM25 评分 + jieba-rs CJK 分词器
│   │   │   ├── index.rs         # 倒排索引搜索引擎
│   │   │   └── parser.rs        # Obsidian YAML 前言解析器
│   │   ├── summarizer.rs        # Conversation → KB 笔记写入器
│   │   ├── lib.rs               # Tauri 命令、调度器、托盘
│   │   └── pty.rs
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

---

## 开发

```bash
pnpm dev                  # 仅 Vite 开发服务器（无 Tauri 外壳）
pnpm tauri dev            # 完整应用程序，支持热重载

pnpm lint                 # ESLint

cd src-tauri
cargo check               # Rust 类型检查
cargo clippy              # Rust 代码检查
cargo test                # 单元测试
```

### 关键技术

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri v2 |
| 前端 | React 19、TypeScript |
| 样式 | Tailwind CSS 4 |
| 构建工具 | Vite |
| 后端 | Rust、tokio |
| 国际化 | i18next、react-i18next |
| Markdown | react-markdown + remark-gfm |
| 终端 | xterm.js + portable-pty |
| 调度 | chrono |
| CJK 搜索 | jieba-rs（中文分词） |
| BM25 搜索 | 自定义倒排索引引擎 |

### 配置

打开**设置**（`Ctrl/Cmd + ,`）：

- **代理引擎** — 每个引擎的可用性、版本和二进制路径。
- **默认引擎** — 创建新会话时使用。
- **模型配置** — 每引擎环境覆盖（默认折叠）。Claude：`ANTHROPIC_*`、`CLAUDE_CODE_*`。Cursor：`CURSOR_API_KEY`、`CURSOR_MODEL`。CodeBuddy：`CODEBUDDY_*`。
- **知识库** — Obsidian 保险库路径、回填现有对话和索引重建。
- **系统提示** — 代理会话的可选提示。
- **主题** — 深色或浅色。
- **语言** — English、简体中文或日本語。

---

## 安全与数据

- 引擎以无头模式在工作区内运行自动批准的工具执行。仅添加您信任代理操作的工作区。
- Claude 的 `AskUserQuestion` 工具在流模式下被禁用（没有回答它的通道）；模型被引导用纯文本语言提问。
- 聊天内容、工作区和设置保持本地。计划任务和运行历史位于应用数据目录中。除了通过您配置的代理 CLI 外，不会向任何地方发送任何内容。

---

## 故障排除

**没有可用的引擎** — 安装至少一个 CLI（`claude`、`cursor-agent` 或 `cbc`）。检查设置 → *刷新*。使用 `claude --version`、`cursor-agent --version` 或 `cbc --version` 验证。

**未拾取环境变量** — Pixie 获取您的登录 shell（`$SHELL -i -l -c env`）。编辑 `.zprofile` / `.zshrc` 后重启应用程序。

**会话上的引擎错误** — 每个对话保持其绑定的引擎。开始新会话或为新聊天选择不同的默认引擎。

**构建错误** — `rustup update`、`cd src-tauri && cargo clean`、`rm -rf node_modules && pnpm install`。

**计划任务未触发** — Pixie 必须正在运行（托盘可以）。超过 5 分钟的逾期任务将被跳过以避免追赶爆发。使用*立即运行*进行测试。

**知识库搜索没有返回结果** — 确保设置中的保险库路径指向包含 `Pixie/` 子文件夹中的 `.md` 文件的有效目录。如果索引过期，请使用设置中的"重建索引"。最小查询长度为 2 个字符。

**KB 笔记未出现** — 首先总结一个对话。笔记被写入 `<vault>/Pixie/`。如果您���动或重命名了保险库，请在设置中更新路径并重建索引。

---

## 贡献

欢迎贡献——尤其是新的**引擎**和通用代理 UX 改进：

1. Fork 存储库并创建功能分支。
2. Rust：`cargo fmt` / `cargo clippy`。前端：`pnpm lint`。
3. 保持 Tauri 命令端到端类型化（Rust ↔ `src/types.ts`）。
4. 描述更改并打开拉取请求。

### 添加翻译

要贡献翻译：

1. 编辑 `src/i18n/locales/zh.json`、`src/i18n/locales/en.json` 或 `src/i18n/locales/ja.json`。
2. 遵循现有的 JSON 结构。
3. 打开拉取请求。

有关更多详细信息，请参阅 [i18n 文档](./PROJECT_I18N_INDEX.md)。

## 许可证

根据 [MIT 许可证](LICENSE)发布。
