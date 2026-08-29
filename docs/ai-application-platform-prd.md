# Pixie AI 应用平台需求文档

状态：Draft v8  
日期：2026-07-25  
目标版本：MVP 0.1 -> Platform 1.0

## 0. 摘要与核心决策

Pixie Applications 的最优产品形态不是“让 Agent 随便生成一个项目”，而是“让 Agent 在 Pixie 可验证、可安装、可运行、可分发的应用协议内生成一个轻量 AI 应用”。因此本 PRD 的核心决策是：

- 应用必须协议优先：`pixie.application.json` 是唯一 source of truth，UI、Agent、inputs、outputs、actions、permissions 都必须能被机器校验。
- MVP 只支持静态前端入口和 Agent action，不支持任意前端构建链、后台服务和远程代码执行。
- 创建必须从模板开始，模板定义可用形态和 validator 规则，避免 Application Studio 演变为不可控的通用项目生成器。
- 安装、发布、运行必须经过同一个 validator 和权限审查链路，失败时阻断，不靠聊天承诺保证正确性。
- GitHub 是分发源，不是 Pixie 的信任根；安装前不执行代码，运行时按权限最小化授权。
- 应用运行结果必须结构化记录，支持审计、复现、更新回滚和后续产品分析。

MVP 的成功标准：一个非技术用户可以在 10 分钟内从模板创建一个可运行 AI 应用；一个高级用户可以在不离开 Pixie 的情况下把应用发布到 GitHub；另一个用户可以从 GitHub 安装并运行，且全流程不需要手动编辑 JSON 或命令行排错。

## 0.1 设计原则

- Local-first：应用源码、安装包、运行数据默认在本机，Pixie 不上传用户数据。
- Contract-first：manifest 比 README、聊天记录和 UI 文案优先，所有运行行为以 contract 为准。
- Least privilege：默认无文件写入、无 shell、无网络；高风险权限显式声明、安装确认、运行确认。
- Reproducible：每次运行记录 app version、source commit、engine/model、inputs、outputs 和错误。
- Progressive disclosure：普通用户只看到模板、输入和结果；开发者可以展开 manifest、diff、权限和日志。
- Fail closed：validator 不确定时按失败处理，禁止安装、发布、运行。
- Upgrade-safe：更新应用不得覆盖用户私有数据；权限扩大必须重新确认；本地修改不得被静默覆盖。

## 1. 背景

当前未提交代码已经开始引入 `Pixie Applications`：

- 后端新增 `pixie.application.json` manifest 解析、校验、本地安装、GitHub clone 安装、卸载、打开入口文件。
- 前端新增 `Applications` 入口、Application Studio 会话、右侧 `App` 预览 tab。
- 应用目录默认包含 `pixie.application.json`、`ui/index.html`、`agent/instructions.md`。

但当前实现还没有形成完整闭环：

- 创建流程只是选目录并生成默认文件，没有模板、校验、发布检查和应用级状态。
- GitHub 当前只支持 clone 安装，不支持一键创建远端仓库、commit、push、更新发布信息；本 PRD 将发布能力列为 MVP 目标能力的一部分。
- 应用只能预览入口 HTML 或用系统打开文件，还不能在 Pixie 内作为独立应用运行。
- manifest 定义了 `inputs`、`outputs`、`actions`、`permissions`，但运行时还没有真正执行 action、传入 input、收集 output。
- 安装后的应用没有更新、版本比较、信任提示、权限审查和运行记录。

本需求目标是把“应用”重新定义为 Pixie 内的一等能力：用户可以在当前产品中创建 AI 应用，托管到 GitHub，从 GitHub 拉取安装，并在 Pixie 内简洁使用。

## 2. 产品定位

Pixie AI 应用是一种由 manifest 声明、由本地文件承载、由 AI Agent 驱动、可通过 GitHub 分发的轻量应用。

一个 AI 应用由四类资产组成：

- UI：用户可见界面，MVP 使用静态 HTML/CSS/JS，入口由 `manifest.entry` 指定。
- Agent：应用背后的 AI 行为说明，入口由 `manifest.agent` 指定。
- Contract：`inputs`、`outputs`、`actions`、`permissions` 描述应用能力和边界。
- Source：本地目录或 GitHub 仓库，作为安装、更新、协作和分发来源。

一句话定义：

> Pixie AI Application = UI + Agent Instructions + Manifest Contract + Local/GitHub Source

## 3. 用户目标

目标用户：

- 普通用户：希望用自然语言创建一个可复用的小工具，例如日报生成器、合同审查器、数据清洗器。
- 高级用户：希望把自己做好的 AI 应用发布到 GitHub，分享给别人安装。
- 团队用户：希望从 GitHub 拉取内部 AI 应用，在 Pixie 中统一安装、运行、升级。

核心体验目标：

- 创建要简单：选择目录 -> 描述需求 -> 右侧实时预览 -> 一键保存/安装。
- 托管要简单：连接 GitHub 或检测本机 `gh` -> 填 repo 名称 -> 一键发布。
- 安装要简单：粘贴 GitHub `owner/repo` 或 URL -> Pixie 校验 -> 安装 -> 直接使用。
- 使用要简单：Applications 列表点击应用 -> 填输入 -> 运行 -> 查看输出。
- 构建要受控：用户和 Agent 都必须在 Pixie 定义的应用规则、模板、manifest schema、权限模型和发布门禁内完成构建，避免生成不可安装、不可运行、不可审查的自由形态项目。

### 3.1 用户画像与 Jobs To Be Done

普通用户：

- JTBD：当我反复让 AI 做同一类任务时，我希望把提示词、输入字段和输出格式固化成一个可点击运行的应用，这样每次不用重新解释需求。
- 成功信号：能通过自然语言描述完成创建；不需要理解 manifest；运行失败时知道下一步怎么修。

高级用户：

- JTBD：当我做出一个好用的 AI 工作流时，我希望把它作为一个 GitHub 仓库发布，别人可以安装、审查和更新。
- 成功信号：Pixie 自动生成 README、权限说明、发布 diff；发布后拿到可复制安装地址。

团队用户：

- JTBD：当团队有内部提示词、流程和工具约定时，我希望成员从同一来源安装受控应用，并能审计版本、权限和运行记录。
- 成功信号：安装来源、commit、权限变更、运行历史清晰；更新不会破坏本地数据和团队治理。

应用开发者：

- JTBD：当我构建 Pixie 应用时，我希望有模板、schema、validator、预览和运行日志，让我快速定位问题。
- 成功信号：Studio 在每次改动后给出精确错误；发布前检查能提前发现不可安装、不可运行和不安全行为。

### 3.2 成功指标

MVP 定量指标：

- 从 `Create App` 到本地首次成功运行的 P50 时间 <= 10 分钟。
- 从 GitHub URL 到安装成功的 P50 时间 <= 60 秒，不含网络 clone 时间。
- validator 错误中，>= 90% 提供可操作修复建议。
- 应用安装失败不留下残缺 registry 记录，成功率可被运行日志统计。
- 高风险权限应用的安装确认展示率和运行确认展示率为 100%。
- 发布流程中，Pixie 只 stage 应用目录内文件，误包含应用目录外文件的概率为 0。

MVP 定性指标：

- 普通用户不需要手动打开或编辑 `pixie.application.json`。
- 开发者可以仅凭 Inspector 错误修复大多数 manifest 问题。
- GitHub 安装前，用户能清楚判断“这个应用来自哪里、要什么权限、会执行什么 action”。

## 4. 非目标

MVP 不做以下事情：

- 不做云端应用商店后端。
- 不托管用户运行数据到 Pixie 服务器。
- 不支持任意远程代码无沙箱执行。
- 不实现复杂多页面前端工程构建链路，MVP 先支持静态入口。
- 不强制用户使用 GitHub OAuth；MVP 可优先使用本机 Git/GitHub CLI。
- 不允许 Application Studio 变成通用代码项目生成器；它只生成 Pixie AI Application 规范内的应用。
- 不实现跨应用依赖、应用间调用、后台常驻应用、定时触发应用或多用户协作编辑。
- 不支持远程 iframe 应用直接接入 Pixie IPC。
- 不承诺 GitHub 仓库内容可信；Pixie 只提供校验、权限提示和本地隔离。

## 5. 闭环流程

### 5.0.0 应用生命周期状态

Pixie 必须用明确状态驱动 UI 和命令可用性，避免“看起来可用但实际不能运行”：

```text
Draft -> Validated -> Installed -> Runnable -> Running -> Completed
      -> Invalid
      -> Published
      -> UpdateAvailable
      -> UpdateBlocked
      -> Uninstalled
```

状态定义：

- `Draft`：Studio 中正在创建或修改，尚未通过 validator。
- `Validated`：manifest、模板、路径、权限和入口文件通过校验，但尚未安装。
- `Installed`：registry 已记录，源码目录可访问，数据目录已创建。
- `Runnable`：已安装，且当前 manifest/action/input/output 仍通过运行前校验。
- `Running`：某个 action 正在执行，产生 run record 和流式事件。
- `Completed`：运行结束，outputs 已解析和持久化。
- `Invalid`：源码缺失、manifest 破损、权限未知、入口缺失或路径越界。
- `Published`：存在 GitHub source metadata，包含 URL、branch、commit。
- `UpdateAvailable`：远端 commit 或 version 新于本地安装记录。
- `UpdateBlocked`：更新存在冲突、权限升级未确认或 validator 未通过。
- `Uninstalled`：registry 移除；数据可保留或按用户选择删除。

状态机规则：

- 只有 `Validated` 可以安装，只有 `Runnable` 可以运行，只有 validator 通过且发布门禁通过才可以发布。
- `Invalid` 状态不允许运行、发布、更新，只允许打开 Studio 修复、重新校验或卸载。
- `Running` 状态允许取消，不允许同时对同一个 app/action 启动并发运行，除非 manifest 后续声明 `concurrency`。
- 更新不会直接覆盖 `Running` 应用；必须等待运行完成或用户取消。

### 5.0 受控构建原则

Application Studio 必须把用户构建行为框在 Pixie 规则下。用户可以自由描述目标，但不能自由定义应用形态；Agent 可以实现 UI 和 Agent instructions，但必须服从 Pixie 的 manifest、目录结构、权限和运行协议。

硬性规则：

- 应用根目录必须包含 `pixie.application.json`。
- 用户可见 UI 必须从 `manifest.entry` 进入。
- Agent 行为必须从 `manifest.agent` 进入。
- inputs、outputs、actions、permissions 必须显式声明。
- 普通应用不得依赖未声明的环境变量、后台服务、外部构建命令或隐藏入口。
- 发布、安装、运行前必须通过 Pixie validator。
- validator 未通过时，禁止安装、发布和运行，只允许继续修复。

Agent 构建边界：

- Agent 只能修改应用目录内文件。
- Agent 不能把主入口迁移到未声明文件。
- Agent 不能创建绕过 `manifest.entry` 的替代预览入口。
- Agent 不能引入需要 `npm install`、`pnpm install`、数据库、后台服务或 daemon 的架构，除非后续 manifest 明确支持。
- Agent 不能新增权限而不更新 manifest。
- Agent 不能在 README 或聊天回复中声明能力，必须写入 manifest。

模板边界：

- MVP 只提供 Pixie 官方模板，例如：
  - `single-action-form`：一个输入表单、一个 Run action、一个 markdown/json 输出。
  - `document-helper`：文件输入、Agent 处理、markdown 输出。
  - `data-transformer`：textarea/json 输入、json/markdown 输出。
- 创建应用时必须从模板开始。
- 模板决定初始目录结构、manifest 字段和可用控件。
- 用户自然语言需求只能在模板能力范围内扩展，超出范围时 Pixie 应提示“当前模板不支持”，并建议切换模板或升级到高级模式。

发布门禁：

- manifest 校验通过。
- `entry` 和 `agent` 文件存在。
- 所有 action 都可以被 Pixie runtime 识别。
- 未声明权限不得出现在运行计划中。
- Git diff 中不能包含应用目录外文件。
- README 必须包含安装方式和权限说明。
- 应用目录内不得包含大于阈值的二进制文件，MVP 默认单文件 <= 20 MB，总大小 <= 100 MB。
- 发布前必须生成可复现的 `PublishPlan`，确认后执行的文件集合不得和 plan 不一致。

### 5.1 创建应用

入口：侧边栏 `Applications` -> `Create App`。

流程：

1. 用户选择模板。
2. 用户选择或新建一个本地目录。
3. Pixie 生成标准应用骨架：
   - `pixie.application.json`
   - `ui/index.html`
   - `agent/instructions.md`
   - 可选：`README.md`、`.gitignore`
4. Pixie 创建 Application Studio 会话，并把该目录加入 workspace。
5. 用户用自然语言描述应用需求。
6. Pixie 把模板规则、manifest schema、允许文件范围和输出协议注入 Agent prompt。
7. Agent 编辑 manifest、UI、agent instructions。
8. 右侧 `App` tab 始终预览 `manifest.entry`。
9. Pixie 实时校验 manifest 和入口文件，显示应用是否可安装/可运行。
10. 用户点击 `Install locally`，应用进入本机 Applications 列表。

### 5.2 开发和预览

Application Studio 必须提供三个固定区域：

- Chat：用户用自然语言驱动 Agent 修改应用。
- App Preview：只渲染 `pixie.application.json` 中的 `entry`。
- Inspector：显示 manifest 摘要、inputs、outputs、actions、permissions、校验错误。

关键规则：

- `pixie.application.json` 是 source of truth。
- App 预览不跟随普通文件点击，只跟随 `manifest.entry`。
- 如果 `manifest.entry` 不存在或 HTML 不可读，预览区显示可操作错误。
- Agent 生成或修改应用后，用户不需要手动刷新预览。
- Studio 必须持续显示 validator 状态；失败项应给出可修复原因。
- Studio 的完成条件不是 Agent 回复“完成”，而是 validator 通过且应用可运行。

### 5.3 本地安装

入口：

- Studio 内 `Install locally`
- Applications 页面 `Install local directory`
- Applications 页面 `Link local app`

安装模式：

- Copy install：复制目录到 Pixie 数据目录，适合稳定使用。
- Link install：直接引用开发目录，适合边开发边使用。

安装前校验：

- manifest JSON 合法。
- `id` 合法且唯一。
- `name`、`entry` 必填。
- `entry` 文件存在且在应用目录内。
- `agent` 文件存在且在应用目录内。
- `permissions` 必须属于已知权限枚举。
- `actions` 引用的 input/output id 必须存在。
- 目录结构必须符合模板声明的允许范围。
- 应用不得包含未被 manifest 引用的可执行入口。

安装后：

- 应用出现在 Applications 列表。
- 显示名称、版本、来源、权限、actions、更新时间。
- 可以运行、打开源码目录、卸载。

### 5.4 发布到 GitHub

入口：Studio 或应用详情页 `Publish to GitHub`。

MVP 推荐实现：

- 优先使用本机 `git` 和 GitHub CLI `gh`。
- 如果目录不是 git repo，Pixie 可以执行 `git init`。
- 如果没有远端，Pixie 调用 `gh repo create --source {dir} --push` 创建并推送。
- 如果已有远端，Pixie 执行 commit 和 push。
- 如果 `gh` 不存在或未登录，Pixie 给出最小引导：安装/登录 `gh`，或改用手动 remote URL。

发布流程：

1. Pixie 运行发布前检查。
2. 用户填写 GitHub repo：
   - repo name
   - owner/org
   - visibility：private/public
   - commit message
3. Pixie 展示将要发布的文件 diff。
4. Pixie 展示 validator、权限、模板合规、目录边界检查结果。
5. 用户确认。
6. Pixie 执行：
   - `git init`，如需要
   - `git add` 应用目录内文件
   - `git commit`
   - `gh repo create --source {dir} --private|--public --push`，如无远端
   - 或 `git push`
7. 发布成功后，manifest registry 记录 GitHub URL、branch、commit。
8. 应用详情页展示 `Install URL`，用户可复制 `owner/repo` 或 HTTPS URL。

增强版：

- 内置 GitHub 登录，使用 OAuth/GitHub App。
- 通过 GitHub REST API 创建 repo，再用 git push。
- 支持 release/tag、应用截图、README 自动生成、版本发布说明。

### 5.5 从 GitHub 安装

入口：Applications -> `Install from GitHub`。

输入支持：

- `owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- SSH git URL
- 可选 branch/tag/commit

安装流程：

1. 用户粘贴 GitHub 来源。
2. Pixie clone 到临时目录。
3. Pixie 读取并校验 `pixie.application.json`。
4. Pixie 展示安装确认：
   - 应用名称、版本、作者、描述
   - permissions
   - inputs/outputs/actions
   - GitHub URL、branch、commit
5. 用户确认安装。
6. Pixie 移动到应用安装目录并写入 registry。
7. 应用出现在列表，点击即可使用。

安全要求：

- 安装前不执行应用代码。
- HTML 预览使用 sandbox。
- 权限必须展示并由用户确认。
- 私有仓库安装优先复用本机 git 凭据；内置 token 支持放到增强版。

### 5.6 使用应用

入口：Applications 列表 -> 点击应用。

应用使用页包含：

- 左侧/顶部：应用名称、描述、版本、来源、权限。
- 主区域：由 manifest `inputs` 自动生成表单。
- Action 区：显示 manifest `actions`。
- 输出区：显示 action 运行后的 `outputs`。
- 可选右侧：应用 UI iframe。

运行流程：

1. 用户打开应用。
2. Pixie 根据 manifest 渲染输入表单。
3. 用户填写 input。
4. 用户点击 action，例如 `Run`。
5. Pixie 创建应用运行记录。
6. Pixie 将以下上下文发送给 Agent：
   - app manifest
   - app agent instructions
   - user inputs
   - selected action
   - output contract
   - application data path
7. Agent 在应用工作区执行。
8. Pixie 解析 Agent 输出，写入 outputs。
9. 用户可以复制、保存、重新运行或继续追问。

MVP 的 Agent 输出协议：

Agent 最终必须返回一个 JSON fenced block：

```json
{
  "outputs": {
    "result": "今日完成客户回访 12 次，待跟进 3 项。"
  }
}
```

Pixie 解析失败时，记录 `output_json_invalid`；如果存在 `markdown` 或 `text` output，则降级把完整回复写入第一个可用 output，并把 run status 标记为 `completed_with_parse_warning`，否则 run status 为 `failed`。

## 6. Manifest 规格

文件名：`pixie.application.json`

MVP schema：

```json
{
  "schemaVersion": "0.1",
  "id": "daily-report",
  "name": "Daily Report",
  "version": "0.1.0",
  "description": "Generate a daily report from notes and tasks.",
  "template": {
    "id": "single-action-form",
    "version": "0.1"
  },
  "author": {
    "name": "User",
    "url": "https://github.com/user"
  },
  "entry": "ui/index.html",
  "agent": "agent/instructions.md",
  "permissions": ["ai:model", "storage", "filesystem:workspace-read"],
  "inputs": [
    {
      "id": "goal",
      "label": "Goal",
      "type": "textarea",
      "required": true
    }
  ],
  "outputs": [
    {
      "id": "result",
      "label": "Result",
      "type": "markdown",
      "preview": true
    }
  ],
  "actions": [
    {
      "id": "run",
      "label": "Run",
      "inputs": ["goal"],
      "outputs": ["result"],
      "mode": "agent"
    }
  ]
}
```

字段要求：

- `id`：全局唯一，允许字母、数字、`.`、`-`、`_`，长度 3-64，建议使用反向域名或 GitHub owner 前缀降低冲突，例如 `com.acme.daily-report`。
- `schemaVersion`：必填，MVP 只接受 `0.1`。
- `template`：MVP 必填，用于声明应用基于哪个 Pixie 模板创建；必须包含 `id` 和 `version`。
- `name`：必填，长度 1-80，用于 UI 展示。
- `version`：必填，必须是合法 SemVer。
- `description`：必填，长度 1-500，用于安装确认和 README 一致性检查。
- `entry`：相对路径，必须在应用目录内。
- `agent`：相对路径，必须在应用目录内。
- `permissions`：必须来自 Pixie 已知权限列表。
- `inputs[].type`：`text`、`textarea`、`number`、`boolean`、`select`、`file`、`json`。
- `outputs[].type`：`text`、`markdown`、`json`、`file`、`html`。
- `actions[].mode`：MVP 支持 `agent`；后续支持 `ui`、`workflow`、`tool`。

MVP 必须保证文档示例、JSON Schema、Rust typed manifest、模板 fixture 四者一致；任何字段口径变化必须同时更新这四处，否则视为实现未完成。

### 6.1 兼容性策略

schema 版本策略：

- `schemaVersion` 使用字符串，MVP 固定为 `0.1`。
- Pixie 可以读取同主版本的向后兼容字段；不能理解的主版本必须阻断安装和运行。
- 未知顶层字段可以保留，但不能影响 runtime 行为；validator 应给 warning 而不是静默执行。
- 废弃字段必须至少保留一个 minor 版本的 warning 期。

运行时兼容策略：

- `minimumPixieVersion`：后续建议加入，用于声明最低 Pixie 版本。
- `engine`：MVP 不允许应用绑定特定 engine/model；只允许使用当前用户选择或 Pixie 默认 engine。
- `capabilities`：后续用于声明可选能力，例如 `uiBridge`、`networkFetch`、`backgroundTasks`。

建议增强字段：

```json
{
  "minimumPixieVersion": "0.1.0",
  "homepage": "https://github.com/user/daily-report",
  "repository": {
    "type": "github",
    "url": "https://github.com/user/daily-report"
  },
  "license": "MIT",
  "keywords": ["report", "writing"],
  "screenshots": ["docs/screenshot.png"]
}
```

MVP 可以先解析并展示这些字段，但不依赖它们完成运行。

### 6.2 输入字段规格

通用字段：

- `id`：必填，action 内唯一引用，允许字母、数字、`.`、`-`、`_`。
- `label`：必填，前端显示名称。
- `description`：可选，用于 tooltip 或 helper text。
- `required`：默认 false。
- `default`：可选，必须和 type 匹配。
- `placeholder`：可选，仅用于文本类输入。
- `validation`：可选，声明最小/最大长度、数字范围、文件类型等。

类型约束：

- `text`：单行字符串。
- `textarea`：多行字符串。
- `number`：数字，可声明 `min`、`max`、`step`。
- `boolean`：布尔值，前端用 checkbox/toggle。
- `select`：必须声明 `options`，每项包含 `label` 和 `value`。
- `file`：MVP 只传入用户选择文件的路径引用和元数据，不把文件内容自动注入 prompt；读取必须受 `filesystem:workspace-read` 或后续 `file:read-selected` 权限约束。
- `json`：必须能被 JSON parser 解析；可选 `schema` 用于后续校验。

示例：

```json
{
  "id": "tone",
  "label": "Tone",
  "type": "select",
  "required": true,
  "default": "concise",
  "options": [
    { "label": "Concise", "value": "concise" },
    { "label": "Detailed", "value": "detailed" }
  ]
}
```

### 6.3 输出字段规格

输出字段必须服务于可渲染、可复制和可审计：

- `id`：必填，action 引用。
- `label`：必填。
- `type`：必填。
- `preview`：可选，最多一个 output 建议设为 true，作为默认展示。
- `filenameTemplate`：当 `type=file` 时可选，用于保存文件名。
- `schema`：当 `type=json` 时可选，用于校验 Agent 输出。

输出类型策略：

- `text`：纯文本展示，禁止解释为 HTML。
- `markdown`：渲染 markdown，但必须做 HTML sanitization。
- `json`：结构化展示；解析失败触发 `output_json_invalid`，存在可降级输出时状态为 `completed_with_parse_warning`，否则状态为 `failed`。
- `file`：输出必须是应用 data path 内的文件引用，不能指向任意系统路径。
- `html`：高风险输出，MVP 默认不支持作为 Agent 运行结果直接执行脚本；可渲染 sanitized HTML 或作为文件下载。

### 6.4 Action 规格

Action 是用户可触发的最小运行单元：

- `id`：必填，应用内唯一。
- `label`：必填，显示在按钮或菜单中。
- `description`：可选。
- `inputs`：必填数组，引用已声明 input。
- `outputs`：必填数组，引用已声明 output。
- `mode`：MVP 只支持 `agent`。
- `confirmation`：可选，高风险 action 可声明运行前确认文案。
- `timeoutSeconds`：可选，MVP 默认 300，最大 1800。

运行约束：

- 一个 action 只能访问其声明的 inputs 和 outputs。
- 如果 action 需要高风险权限，UI 必须在 action 级别展示，而不是只在应用级别展示。
- 运行前必须再次校验当前 manifest，防止安装后源码被外部修改。

### 6.5 模板字段

```json
{
  "template": {
    "id": "single-action-form",
    "version": "0.1"
  }
}
```

模板字段用于限制 validator 和 Studio 行为。MVP 应把 `template` 作为必填字段处理，例如 `single-action-form` 可以要求至少一个 input、一个 action，并且 action mode 必须是 `agent`。

## 7. 权限模型

MVP 权限枚举：

- `ai:model`：允许调用当前用户配置的 Agent/模型。
- `storage`：允许读写应用私有数据目录。
- `filesystem:workspace-read`：允许读取用户选择的工作区文件。
- `filesystem:workspace-write`：允许修改用户选择的工作区文件。
- `network`：允许 Agent 使用网络能力。
- `shell`：允许执行 shell 命令，高风险。
- `clipboard:write`：允许把结果写入剪贴板，MVP 可先由用户手动复制替代。
- `file:read-selected`：建议新增，允许读取用户在本次运行中显式选择的文件，风险低于整个 workspace 读取。

权限策略：

- 安装时展示权限。
- 首次运行高风险权限时二次确认。
- 权限变更后升级应用必须重新确认。
- 应用不能默认获得 Pixie 主项目的完整文件访问权，除非用户把目标目录作为运行工作区。

### 7.1 权限分级

低风险权限：

- `ai:model`
- `storage`
- `file:read-selected`

中风险权限：

- `filesystem:workspace-read`
- `network`
- `clipboard:write`

高风险权限：

- `filesystem:workspace-write`
- `shell`

确认策略：

- 安装确认：所有权限都展示，用户必须确认安装。
- 运行确认：中风险权限首次运行确认，高风险权限每个 action 首次运行确认。
- 权限升级：应用更新后新增或扩大权限时，必须重新确认；用户拒绝则更新进入 `UpdateBlocked`。
- 记住选择：只按 app id + source commit + permission set 记住；commit 或权限变化后失效。
- 降权更新：权限减少不需要二次确认，但应在更新说明中展示。

### 7.2 Runtime 执行协议

`application_run` 输入：

```json
{
  "appId": "daily-report",
  "actionId": "run",
  "inputs": {
    "goal": "Summarize today's notes"
  },
  "workspacePath": "/Users/user/Documents/Notes",
  "conversationId": "optional-existing-conversation",
  "idempotencyKey": "7f8c6f8a-1e3e-4a98-8d0d-c7e93a9c0f3e"
}
```

运行前步骤：

1. 读取 registry 中的 app entry。
2. 重新读取并校验当前 manifest。
3. 校验 action 存在、input 类型正确、required input 已填写。
4. 校验权限确认状态。
5. 创建 run record，状态为 `running`。
6. 构造 Agent prompt，注入 manifest、agent instructions、action、inputs、output contract、权限边界和 data path。
7. 启动 Agent，订阅标准化事件。
8. 收集最终输出并解析为 outputs。
9. 写入 run record，状态为 `completed`、`completed_with_parse_warning`、`output_contract_failed`、`failed` 或 `cancelled`。

Agent prompt 必须包含不可变运行约束：

- 只执行所选 action。
- 只使用本次 action 声明的 inputs。
- 只生成 manifest 声明的 outputs。
- 不得请求未声明权限。
- 不得把未声明能力写入结果。
- 若无法完成，必须按错误协议返回结构化错误。

### 7.3 输出协议

MVP 支持两种输出路径：

首选结构化输出：

```json
{
  "outputs": {
    "result": "今日完成客户回访 12 次，待跟进 3 项。"
  },
  "metadata": {
    "confidence": "medium",
    "notes": "optional"
  }
}
```

错误输出：

```json
{
  "error": {
    "code": "missing_input",
    "message": "The input 'goal' is required.",
    "recoverable": true
  }
}
```

解析规则：

- Pixie 只解析最后一个合法 JSON fenced block。
- JSON 中只能接受 `outputs`、`metadata`、`error` 三个顶层执行字段。
- `outputs` 中不得包含未声明 output id；出现未知 id 时记 warning 并忽略。
- 必填 output 缺失时 run status 为 `output_contract_failed`，同时记录 `output_contract_failed` 错误。
- 解析失败时记录 `output_json_invalid`；如果存在 `markdown` 或 `text` output，则降级写入第一个可用 output，同时状态标记为 `completed_with_parse_warning`；否则状态标记为 `failed`。

### 7.4 运行事件

前端需要可流式渲染以下事件：

```text
application-run-started
application-run-agent-delta
application-run-tool-started
application-run-tool-finished
application-run-output-parsed
application-run-failed
application-run-completed
application-run-cancelled
```

事件必须包含：

- `runId`
- `appId`
- `actionId`
- `sequence`
- `timestamp`
- `payload`

事件序列必须单调递增，前端可用 `runId + sequence` 去重。

### 7.5 取消、重试和失败恢复

- 用户可以取消 running 状态，后端必须终止对应 Agent 进程或发送停止信号。
- 取消后 run record 状态为 `cancelled`，保留已收到的 delta 和部分输出。
- 用户主动点击“重新运行”或“重试失败任务”表示发起新的业务运行，必须生成新的 `idempotencyKey` 并创建新的 run id，不能覆盖旧运行记录。
- 同一个 `idempotencyKey` 的网络重试或 UI 重放必须返回同一个 run id，不得创建第二条 run record。
- 同一 action 默认串行运行；后续可由 manifest 声明 `concurrency: "parallel"`。
- 如果应用源码在运行中发生变化，本次运行仍按启动时读取的 manifest snapshot 记录；下次运行重新校验。

## 8. 数据模型

后端 registry：

```text
Pixie data root: /Users/user/Library/Application Support/Pixie
Registry: /Users/user/Library/Application Support/Pixie/applications.json
Installed app source root: /Users/user/Library/Application Support/Pixie/applications/daily-report/source
App private data root: /Users/user/Library/Application Support/Pixie/application-data/daily-report
```

建议扩展：

```json
{
  "apps": [
    {
      "id": "daily-report",
      "name": "Daily Report",
      "version": "0.1.0",
      "source": {
        "type": "github",
        "url": "https://github.com/user/daily-report.git",
        "branch": "main",
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "linked": false
      },
      "installPath": "/Users/user/Library/Application Support/Pixie/applications/daily-report",
      "dataPath": "/Users/user/Library/Application Support/Pixie/application-data/daily-report",
      "installedAt": "2026-07-25T10:00:00Z",
      "updatedAt": "2026-07-25T10:00:00Z",
      "manifestHash": "sha256:4f8c2d0b7a9e6c1d5b3a2f90123456789abcdef0123456789abcdef012345678",
      "trusted": false,
      "permissionGrants": [
        {
          "permissions": ["ai:model", "storage"],
          "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
          "grantedAt": "2026-07-25T10:00:00Z"
        }
      ],
      "lastRunAt": "2026-07-25T10:05:00Z"
    }
  ]
}
```

运行记录：

```text
Run history directory: /Users/user/Library/Application Support/Pixie/application-runs/daily-report
Run record file: /Users/user/Library/Application Support/Pixie/application-runs/daily-report/018f3d7a-1c2b-7a90-b4d1-9f8a76543210.json
```

`run-id` 由后端生成，必须是 36 字符 canonical UUID 字符串，不得接受包含路径分隔符、空白控制字符或 URL 保留字符的 run id。读取 run history 时，后端只能从合法 UUID 文件名派生 `runId`；文件名不合法的记录必须作为无效本地文件隔离或忽略并记录本地诊断日志，不得返回到任何 `ApplicationRunHistoryItem`。JSON 记录内容中的 run id 只可作为一致性校验字段，不能作为 `ApplicationRun.runId` 或 `diagnostic: 'corrupted'` item `runId` 的来源；JSON 记录内容中的 app id 也只可作为一致性校验字段，不能覆盖请求或目录上下文确认的 `appId`。若合法 UUID 文件名对应的 JSON 无法解析、run id 缺失/非法或与文件名不一致、app id 缺失/非法或与请求/目录上下文不一致，必须返回 `diagnostic: 'corrupted'` item。

记录内容：

- run id（冗余一致性校验字段；读取时以 canonical UUID 文件名为权威来源）
- app id/version/commit（app id 为冗余一致性校验字段；读取历史时以请求参数或 run history 目录上下文为权威来源）
- action id
- inputs
- outputs
- engine/model
- manifest snapshot/hash
- source url/branch/commit
- status
- started/finished time
- error

### 8.1 安装目录策略

Copy install：

- 复制源码到 Pixie data root 下的 `applications/{appId}/source`，例如 `/Users/user/Library/Application Support/Pixie/applications/daily-report/source`。
- registry 中 `linked=false`。
- 更新时可安全替换 source 目录，但不得删除 dataPath。
- 适合从 GitHub 安装和稳定使用。

Link install：

- registry 记录外部目录绝对路径。
- registry 中 `linked=true`。
- Pixie 不接管目录生命周期，卸载只移除 registry。
- 每次运行前重新校验，外部修改可导致应用进入 `Invalid`。
- 适合 Application Studio 开发。

临时目录：

- GitHub 安装先 clone 到 Pixie data root 下的 `tmp/application-install/{installAttemptId}`，例如 `/Users/user/Library/Application Support/Pixie/tmp/application-install/018f3d7a-1c2b-7a90-b4d1-9f8a76543210`。
- 校验通过并经用户确认后再原子移动到安装目录。
- 任意失败必须清理临时目录，不写入 registry。

### 8.1.1 Registry 原子性与锁

所有会修改 `applications.json`、source 目录或 run record 的命令必须满足原子性：

- 写 registry 采用 `write temp file -> fsync file -> atomic rename -> fsync parent dir`，禁止直接覆盖写。
- 每次成功写 registry 后保留上一份可读 `.bak`，`.bak` 更新失败不得影响主写入成功，但必须记录 warning。
- 安装、更新、卸载、发布写回 source metadata 时必须持有应用级锁。
- 同一 `appId` 同一时间只允许一个写操作；读操作可以并发，但必须读取完整文件。
- install/update 先准备 source 到临时目录，校验通过后 rename 到目标 source；registry 写入成功前不得删除旧 source。
- registry 写入失败时必须清理新 source 或临时目录；清理失败返回部分失败错误，并保留可恢复路径。
- uninstall 先标记 registry 状态或删除 registry entry，再按用户选择删除 source/data，删除失败要返回部分失败状态。
- run record 必须先创建 `running` 记录，再启动 Agent；Agent 启动失败也要有失败 run record。
- run record 写入采用与 registry 相同的 temp file + fsync + rename 规则；最终状态更新不得覆盖已有事件，只能追加事件并更新 summary。
- source metadata 写回 manifest registry 时必须同时写入 `manifestHash`、`source.commit` 和 `updatedAt`，三者不能分批提交。

锁粒度：

- 全局 registry 锁：保护 `applications.json` 读改写。
- app source 锁：保护 `applications/{appId}/source` 替换。
- app run 锁：保护同一 app/action 默认串行运行。
- idempotency 锁：保护同一 command + idempotency key 的 request hash 和结果记录。

锁顺序必须固定，避免死锁：

1. idempotency 锁。
2. 全局 registry 锁。
3. app source 锁。
4. app run 锁。

命令不得反向获取锁；如果无法按顺序获取，必须释放已持有锁并返回可重试错误。

错误恢复：

- 发现 registry JSON 损坏时，Pixie 应保留损坏文件副本，尝试读取上一份 `.bak`，并在 UI 中进入只读恢复态。
- 更新失败必须保留旧 source 和旧 registry entry；不能出现 registry 指向不存在 source 的状态。
- 单条 run history 文件无法解析、字段缺失/非法或不一致时不应阻断应用列表和运行；`application_run_list` 不得因此整体返回 command error。合法 UUID 文件名对应的 JSON 无法解析、run id 缺失/非法或与文件名不一致、app id 缺失/非法或与请求/目录上下文不一致时，必须返回 `diagnostic: 'corrupted'` item，并附带后端从文件名派生的 `runId`、从请求或目录上下文确认的 `appId`、后端派生的 `recordPath` 作为只读展示和诊断文本。JSON 内容中的 run id 不得作为 `kind: 'run'` item 或 `diagnostic: 'corrupted'` item 的 `runId` 来源；JSON 内容中的 app id 也不得覆盖请求或目录上下文确认的 `appId`。文件名不合法时没有可信 `runId`，不得返回任何 `kind: 'run'` item 或 `diagnostic: 'corrupted'` item，只能隔离或忽略该文件并记录本地诊断日志。`recordPath` 不得作为任何 command 的输入、打开目标、路径解析来源或安全判断依据。UI 打开原始文件时必须通过 `application_open` 的 `run-record` target 传入 `runId`，由后端先校验 `runId` 再根据固定 run history 目录解析并校验记录路径；`corrupted` 不是 `ApplicationRunStatus`。

### 8.2 更新策略

版本比较：

- `version` 必须遵循 SemVer；无法解析时 validator 阻断安装、发布和更新。
- GitHub 应用优先使用 remote commit 判断是否有更新，再展示 manifest version 变化。
- 本地 link 应用不提供“更新”，只提供“重新校验”。

更新流程：

1. 拉取远端到临时目录。
2. 读取新 manifest 并校验。
3. 对比旧 manifest：
   - version
   - permissions
   - inputs/outputs/actions
   - template
   - entry/agent
4. 展示更新确认页。
5. 如果权限升级，要求重新确认。
6. 如果本地 copy install source 有用户修改，进入 `UpdateBlocked`，提示用户备份、覆盖或转为 link。
7. 确认后替换 source，保留 dataPath 和 run history。
8. 写入 update record。

回滚策略：

- MVP 至少保留上一版本 source 目录或 commit metadata。
- 更新失败必须回滚 registry 和 source 到更新前状态。
- 回滚不回滚 application data，除非后续引入数据迁移协议。

### 8.3 数据迁移策略

MVP 不执行自动数据迁移。

后续建议在 manifest 中加入：

```json
{
  "dataVersion": "1",
  "migrations": []
}
```

在没有迁移协议前，应用更新不得修改、移动或删除 `application-data/{appId}` 中的既有文件。

## 9. 前端信息架构

侧边栏：

- Applications

Applications 页面：

- Header：Applications
- Primary action：Create App
- Install：
  - Install from GitHub
  - Install local directory
  - Link local app
- Installed Apps：
  - app name
  - version
  - source badge
  - permissions summary
  - Open / Update / Uninstall

Application Detail：

- Overview
- Run
- Source
- Settings

Application Studio：

- Chat
- App Preview
- Manifest Inspector
- Publish button
- Install locally button

关键 UX 原则：

- 普通用户不需要理解 git、manifest、branch 才能创建和使用。
- 高级信息折叠展示，不阻塞主流程。
- 所有危险动作有明确确认：发布、覆盖安装、权限升级、卸载、shell 权限运行。
- 错误必须给下一步，例如“未检测到 gh，请先运行 gh auth login 或改用 HTTPS remote”。
- UI 不提供“空白项目随便生成”的入口；创建必须先选模板。
- 当用户提出超出模板能力的需求时，Studio 应先解释限制并提供模板切换，而不是让 Agent 自由发挥。

## 10. 后端命令需求

公开 Tauri command 必须统一为单个 `request` 参数，业务结果类型见第 26.3 章；外层返回 `CommandResult<ResultType>`，前端不得直接依赖异常字符串。

MVP 新增公开命令：

- `application_validate(request: ApplicationValidateRequest) -> ApplicationValidateResult`
- `application_template_list(request: ApplicationTemplateListRequest) -> ApplicationTemplateListResult`
- `application_create(request: ApplicationCreateRequest) -> ApplicationCreateResult`
- `application_get(request: ApplicationGetRequest) -> ApplicationGetResult`
- `application_run(request: ApplicationRunRequest) -> ApplicationRunResult`
- `application_run_list(request: ApplicationRunListRequest) -> ApplicationRunListResult`
- `application_update(request: ApplicationUpdateRequest) -> ApplicationUpdateResult`
- `application_publish_plan(request: ApplicationPublishPlanRequest) -> ApplicationPublishPlanResult`
- `application_publish(request: ApplicationPublishRequest) -> ApplicationPublishResult`
- `github_env_check(request: GitHubEnvironmentCheckRequest) -> GitHubEnvironmentCheckResult`

现有公开命令的 MVP 契约升级：

- `application_list(request: ApplicationListRequest) -> ApplicationListResult`
- `application_install_local(request: ApplicationInstallLocalRequest) -> ApplicationInstallLocalResult`
- `application_install_github(request: ApplicationInstallGitHubRequest) -> ApplicationInstallGitHubResult`
- `application_uninstall(request: ApplicationUninstallRequest) -> ApplicationUninstallResult`
- `application_open(request: ApplicationOpenRequest) -> ApplicationOpenResult`

历史迁移逻辑：

- 旧 Studio 默认初始化逻辑必须迁移到 `application_create`；若后端保留迁移兼容逻辑，只能作为内部实现细节，不注册为公开 command contract，不暴露独立 request/result 类型给前端。

运行历史列表契约：

- `application_run_list` 的成功结果可以同时包含 `kind: 'run'` item 和 `diagnostic: 'corrupted'` item；单条合法 UUID 文件名对应的 JSON 无法解析、run id 缺失/非法或与文件名不一致、app id 缺失/非法或与请求/目录上下文不一致时不得升级为 command error。
- 合法 UUID 文件名对应的 JSON 解析失败、JSON run id 缺失/非法或与文件名不一致、JSON app id 缺失/非法或与请求/目录上下文不一致时，返回 `diagnostic: 'corrupted'` item，`runId` 必须来自文件名。
- `diagnostic: 'corrupted'` item 的 `appId` 必须来自 `ApplicationRunListRequest.appId` 或后端遍历 run history 目录时确认的目录上下文；JSON 内容中的 app id 不得覆盖该值。
- `corrupted` 是 `ApplicationRunHistoryItem` 的诊断类型，不是 `PixieApplicationError.code`，也不是 `ApplicationRunStatus`。
- 非法文件名没有可信 `runId`，不得返回任何 `kind: 'run'` item 或 `diagnostic: 'corrupted'` item，只能隔离或忽略该文件并写本地诊断日志。
- 前端若要打开 `diagnostic: 'corrupted'` item 的原始记录，只能调用 `application_open({ appId, target: 'run-record', runId })`；不得把 `recordPath` 回传给任何 command。

Git 命令扩展：

- `git_init(request: GitInitRequest) -> GitInitResult`
- `git_remote_list(request: GitRemoteListRequest) -> GitRemoteListResult`
- `git_add(request: GitAddRequest) -> GitAddResult`
- `git_commit(request: GitCommitRequest) -> GitCommitResult`
- `git_push(request: GitPushRequest) -> GitPushResult`
- `github_repo_create(request: GitHubRepoCreateRequest) -> GitHubRepoCreateResult`

Validator 输出要求：

```json
{
  "ok": false,
  "errors": [
    {
      "code": "manifest_entry_missing",
      "message": "manifest.entry points to ui/index.html, but the file does not exist.",
      "path": "pixie.application.json"
    }
  ],
  "warnings": [],
  "template": {
    "id": "single-action-form",
    "ok": true
  }
}
```

Validator 必须覆盖：

- manifest schema。
- 模板规则。
- 路径越界。
- 文件存在性。
- action/input/output 引用。
- 权限枚举。
- 发布目录边界。
- 高风险权限提示。

### 10.1 后端模块建议

建议把当前 `src-tauri/src/lib.rs` 中的应用逻辑拆分为独立模块，降低主文件复杂度：

```text
src-tauri/src/application/
  mod.rs
  manifest.rs       // parse + typed manifest
  validate.rs       // validator + template rules
  registry.rs       // applications.json read/write
  install.rs        // local/github install
  runtime.rs        // application_run + output parsing
  publish.rs        // git/gh publish plan + execute
  templates.rs      // official templates
  security.rs       // path/csp/secret checks
```

前端建议拆分：

```text
src/components/applications/
  ApplicationsPanel.tsx
  ApplicationCreateModal.tsx
  ApplicationDetail.tsx
  ApplicationRunView.tsx
  ApplicationStudioInspector.tsx
  ApplicationPublishDialog.tsx
  ApplicationInstallConfirm.tsx
```

关键约束：

- `MarketplacePanel` 不再承载 Applications 主流程，避免 Skills 和 Applications 的状态、文案、错误处理继续耦合。
- `Application Studio` 不靠 conversation title 识别；conversation metadata 必须包含 `mode`、`applicationPath`、`templateId`。
- Rust 后端负责真实校验和权限判断，前端只展示状态，不做安全决策。

### 10.2 错误码规范

错误响应必须稳定，便于前端做针对性 UI：

```json
{
  "code": "manifest_entry_missing",
  "message": "manifest.entry points to ui/index.html, but the file does not exist.",
  "severity": "error",
  "path": "pixie.application.json",
  "field": "entry",
  "fix": "Create ui/index.html or update manifest.entry to an existing file."
}
```

错误码分类：

- `manifest_*`：JSON、schema、字段、引用错误。
- `template_*`：模板不匹配、目录结构不合规。
- `permission_*`：未知权限、权限升级、未确认。
- `path_*`：越界、symlink、缺失、不可读。
- `install_*`：clone、copy、registry、冲突。
- `publish_*`：git/gh、diff、secret、remote、push。
- `runtime_*`：action、input、engine、timeout、cancel。
- `output_*`：JSON 解析、contract、文件输出错误。
- `idempotency_*`：重复请求、key 冲突、重试恢复错误。

前端展示规则：

- error 阻断主动作。
- warning 不阻断，但必须在确认页展示。
- info 用于解释状态，例如“检测到 gh 已登录”。
- 每个 error 必须有 `fix`，没有 fix 的错误视为后端质量 bug。

### 10.3 P0 错误码清单

MVP 首批必须落盘并测试以下错误码，前端不得依赖后端自由文本判断业务状态：

| Code | Severity | 阻断动作 | 触发条件 |
| --- | --- | --- | --- |
| `manifest_json_invalid` | error | validate/install/publish/run | manifest 不是合法 JSON |
| `manifest_schema_unsupported` | error | install/publish/run | `schemaVersion` 不是 MVP 支持版本 |
| `manifest_required_field_missing` | error | install/publish/run | 缺少必填执行字段 |
| `manifest_semver_invalid` | error | install/publish/update | `version` 不是合法 SemVer |
| `manifest_id_invalid` | error | install/publish | `id` 字符、长度或格式不合规 |
| `manifest_id_conflict` | error | install/publish | 不同 source 使用相同 id，或 publish target 的 `appId` 与 `path` 解析结果不一致 |
| `manifest_reference_missing` | error | install/publish/run | action 引用不存在的 input/output |
| `manifest_entry_missing` | error | validate/install/publish/run | `manifest.entry` 指向的文件不存在 |
| `manifest_agent_missing` | error | validate/install/publish/run | `manifest.agent` 指向的文件不存在 |
| `template_unknown` | error | create/install/publish | template id 不存在 |
| `template_rule_failed` | error | validate/install/publish | 应用不满足模板规则 |
| `path_missing` | error | install/publish/run | 非 entry/agent 的引用文件不存在 |
| `path_absolute` | error | install/publish/run | manifest 路径为绝对路径 |
| `path_escape` | error | install/publish/run | manifest 路径包含 `..` 或 canonicalize 后越界 |
| `path_symlink_escape` | error | install/publish/run | symlink resolved path 越过 app root |
| `permission_unknown` | error | install/publish/run | manifest 声明未知权限 |
| `permission_grant_required` | error | run/update | 中高风险权限未确认 |
| `permission_upgrade_required` | error | update | 更新新增或扩大权限 |
| `install_clone_failed` | error | install | GitHub clone 失败 |
| `install_registry_write_failed` | error | install/update/uninstall | registry 原子写失败 |
| `install_registry_corrupted` | error | list/install/update/uninstall | registry JSON 损坏且无法从 `.bak` 恢复 |
| `publish_plan_invalid` | error | publish | plan 已过期或和当前 diff 不一致 |
| `publish_readme_inconsistent` | error | publish | README 声明了 manifest 没有的权限、action、input 或 output |
| `publish_secret_detected` | error | publish | secret scan 高置信发现 |
| `publish_outside_app_files` | error | publish | plan 发现应用目录外文件将被提交 |
| `publish_git_failed` | error | publish | git init/add/commit 失败 |
| `publish_push_failed` | error | publish | gh repo create 或 git push 失败 |
| `runtime_action_missing` | error | run | actionId 不存在 |
| `runtime_input_invalid` | error | run | required 缺失或类型不匹配 |
| `runtime_concurrency_blocked` | error | run | 同一 app/action 已有运行且未声明并发 |
| `runtime_run_id_invalid` | error | open | `ApplicationOpenRequest.runId` 不是 canonical UUID；该错误码只用于请求参数校验，不能用于 `application_run_list` 读取历史文件时发现的文件名或 JSON 内容问题 |
| `runtime_record_write_failed` | error | run | run record 原子创建或最终写入失败 |
| `runtime_record_missing` | error | open | `application_open` 的 `run-record` target 找不到对应 run record |
| `runtime_timeout` | error | run | action 超时 |
| `runtime_cancelled` | info | run | 用户取消 |
| `output_json_invalid` | warning/error | run | Agent 输出 JSON 无法解析 |
| `output_contract_failed` | error | run | 必填 output 缺失或类型不匹配 |
| `idempotency_key_conflict` | error | create, install, run, update, publish, uninstall, git_init, git_add, git_commit, git_push, github_repo_create | 同一 idempotency key 搭配了不同 request hash |
| `idempotency_recovery_failed` | error | create, install, run, update, publish, uninstall, git_init, git_add, git_commit, git_push, github_repo_create | 同 key 同 hash 重试但无法恢复首次结果或继续未完成操作 |

错误码命名规则：

- 新增错误码必须属于现有分类前缀。
- 修改错误码语义必须同步更新前端 i18n、测试 fixture 和 PRD。
- 删除错误码必须经过一个版本的 deprecated warning 期，除非该错误码尚未发布。
- `output_json_invalid` 的 severity 由是否可降级决定：存在可用 `markdown` 或 `text` output 时为 warning，否则为 error。
- run history 读取中的单条文件名或 JSON 内容问题不新增 P0 command error code。合法 UUID 文件名对应的 JSON 无法解析、JSON run id 缺失/非法或与文件名不一致、JSON app id 缺失/非法或与请求/目录上下文不一致时，`application_run_list` 必须按第 10 章契约返回 `diagnostic: 'corrupted'` item；文件名非法时没有可信 `runId`，只能隔离或忽略该文件并写本地诊断日志。

## 11. GitHub 集成策略

依据 GitHub 官方文档，MVP 可使用 GitHub CLI 创建远端仓库并推送本地代码；`gh repo create --source {dir} --push` 支持从已有本地目录创建远端并推送。私有仓库 clone/推送可优先复用用户本机 git/gh 凭据。若后续使用 REST API 或 fine-grained PAT，需要针对 repo 创建、contents 读写等 endpoint 配置相应权限。

MVP 决策：

- 不在 Pixie 内存储 GitHub token。
- 优先检测 `gh auth status`。
- 使用 `git` 和 `gh` 子进程完成 publish。
- 安装公开仓库无需登录。
- 安装私有仓库依赖用户本机 git 凭据。

增强版：

- Pixie 内置 GitHub OAuth/GitHub App 登录。
- 支持选择 owner/org 和 repo。
- 支持 GitHub release/tag。
- 支持应用市场索引仓库。

参考：

- GitHub Docs: [Adding locally hosted code to GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- GitHub CLI manual: [`gh repo create`](https://cli.github.com/manual/gh_repo_create)
- GitHub Docs: REST API repositories and fine-grained token permissions
- Tauri v2: [Security](https://v2.tauri.app/security/) and [Capabilities](https://v2.tauri.app/security/capabilities/)
- OWASP: [Top 10 for Large Language Model Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)

### 11.1 PublishPlan 规格

发布前必须先生成 plan，不允许点击 Publish 后直接执行命令：

```json
{
  "planId": "7b19c2f2-9e0e-4d41-8f7a-5a22a6e0f1b3",
  "appId": "daily-report",
  "target": {
    "mode": "installed-app-at-path",
    "appId": "daily-report",
    "path": "/Users/user/apps/daily-report"
  },
  "appRoot": "/Users/user/apps/daily-report",
  "validator": { "ok": true, "errors": [], "warnings": [] },
  "git": {
    "isRepo": true,
    "currentBranch": "main",
    "baseCommit": "0123456789abcdef0123456789abcdef01234567",
    "hasRemote": false,
    "remoteUrl": null,
    "changedFiles": ["pixie.application.json", "ui/index.html", "agent/instructions.md"],
    "outsideAppFiles": [],
    "hasUntrackedFiles": true
  },
  "github": {
    "ghInstalled": true,
    "authenticated": true,
    "viewer": "user",
    "availableOwners": ["user", "org"]
  },
  "security": {
    "secretScan": { "ok": true, "findings": [] },
    "largeFiles": []
  },
  "readme": {
    "exists": true,
    "consistency": {
      "blocking": [],
      "warnings": []
    }
  },
  "fileInventoryHash": "sha256:8d7b6c5a4f3e2d1c0b9a887766554433221100ffeeddccbbaa99887766554433",
  "manifestHash": "sha256:4f8c2d0b7a9e6c1d5b3a2f90123456789abcdef0123456789abcdef012345678",
  "readmeConsistencyHash": "sha256:1a2b3c4d5e6f7081928374655647382910abcdefabcdef1234567890abcdef12",
  "secretScanHash": "sha256:9f8e7d6c5b4a39281726354433221100ffeeddccbbaa99887766554433221100",
  "generatedAt": "2026-07-25T10:00:00Z",
  "expiresAt": "2026-07-25T10:15:00Z"
}
```

PublishPlan 门禁：

- `validator.ok=true`。
- `outsideAppFiles=[]`。
- secret scan 无 error 级发现。
- README/manifest consistency 无 blocking 项。
- 如果 remote 已存在，必须确认是否推送到该 remote。
- 如果 branch 未设置 upstream，必须在 UI 中显示目标 remote/branch。
- 如果工作区有应用目录外改动，不 stage、不提交，只在 plan 中提示。
- plan 默认 15 分钟过期；过期后必须重新生成。

### 11.2 GitHub 安装源解析

解析规则：

- `owner/repo` -> `https://github.com/owner/repo.git`
- `https://github.com/owner/repo` -> append `.git` only for clone command if needed。
- `https://github.com/owner/repo.git` -> 原样使用。
- `git@github.com:owner/repo.git` -> SSH clone。
- `?ref={branch|tag|commit}` 或独立 branch 输入用于指定 ref。

安全规则：

- 只把 GitHub URL 作为 source metadata，不把本机凭据写入 registry。
- 私有仓库 clone 失败时给出凭据修复建议，不要求用户把 token 粘贴给 Pixie。
- 安装确认页展示 resolved commit，不能只展示 branch 名称。

### 11.3 PublishPlan 一致性与防重

`application_publish_plan` 返回的 plan 必须包含可校验摘要，`application_publish` 只能执行仍然有效的 plan：

```json
{
  "planId": "7b19c2f2-9e0e-4d41-8f7a-5a22a6e0f1b3",
  "appId": "daily-report",
  "target": {
    "mode": "installed-app-at-path",
    "appId": "daily-report",
    "path": "/Users/user/apps/daily-report"
  },
  "appRoot": "/Users/user/apps/daily-report",
  "git": {
    "baseCommit": "0123456789abcdef0123456789abcdef01234567",
    "currentBranch": "main"
  },
  "fileInventoryHash": "sha256:8d7b6c5a4f3e2d1c0b9a887766554433221100ffeeddccbbaa99887766554433",
  "manifestHash": "sha256:4f8c2d0b7a9e6c1d5b3a2f90123456789abcdef0123456789abcdef012345678",
  "readmeConsistencyHash": "sha256:1a2b3c4d5e6f7081928374655647382910abcdefabcdef1234567890abcdef12",
  "secretScanHash": "sha256:9f8e7d6c5b4a39281726354433221100ffeeddccbbaa99887766554433221100",
  "generatedAt": "2026-07-25T10:00:00Z",
  "expiresAt": "2026-07-25T10:15:00Z"
}
```

执行发布前必须重新计算：

- 当前 branch。
- staged/unstaged diff。
- 应用目录文件 inventory。
- manifest hash。
- README/manifest consistency。
- secret scan 结果。
- plan target 的 canonical app root。

如果任何值和 plan 不一致，`application_publish` 必须返回 `publish_plan_invalid`，要求用户重新生成 plan。这样可以避免用户在确认页和真正 push 之间修改文件，导致发布内容和确认内容不一致。

防重规则：

- `application_publish` 必须接受 idempotency key。
- 同一个 idempotency key 重试时，如果 commit 已经创建且 push 成功，返回同一个 `PublishResult`。
- 如果 commit 已创建但 push 失败，重试只允许继续 push 同一个 commit，不得创建新 commit。
- 如果 plan 已过期或 source 已变化，不得复用旧 idempotency key 强行发布。

## 12. 安全与隔离

安装安全：

- clone 后只读取 manifest，不执行代码。
- 校验路径必须在应用目录内，防止 `../` 越界。
- manifest 中未知字段允许存在但不参与执行。
- 未知权限必须阻断安装或要求开发者修正。

运行安全：

- iframe 使用 sandbox。
- 默认不允许应用 UI 直接调用 Tauri invoke。
- action 运行通过 Pixie 后端统一调度。
- `shell`、`filesystem:workspace-write` 为高风险权限；`network` 为中风险权限，但因底层 Agent 引擎未必能做精细网络隔离，运行确认文案必须明确风险。
- 高风险权限在运行前需要用户确认并可记住选择。

数据安全：

- 应用私有数据写入 `application-data/{appId}`。
- 卸载默认保留数据，提供“同时删除数据”选项。
- 安装更新不得覆盖用户数据。

### 12.1 威胁模型

主要风险：

- 恶意 GitHub 应用通过 HTML/JS 试图调用 Pixie/Tauri IPC。
- 恶意 manifest 使用 `../`、绝对路径或 symlink 逃逸应用目录。
- Prompt injection 诱导 Agent 忽略应用 instructions、泄露 workspace 内容或请求未声明权限。
- Agent 输出未消毒 HTML/markdown，导致 XSS 或危险链接。
- 更新版本扩大权限、替换入口或引入 shell 行为，但用户未察觉。
- 发布流程误把用户工作区其他文件提交到 GitHub。
- 私有仓库凭据、环境变量或 token 被写入应用源码、README 或运行记录。

必须缓解：

- 路径 canonicalize 后校验前缀，拒绝应用目录外路径。
- 入口 HTML 在 sandbox iframe 或独立受限 WebView 中渲染，不暴露 Tauri invoke。
- 默认 Content Security Policy：禁止远程脚本，限制 `connect-src`，后续由权限显式放开。
- markdown/html 输出必须 sanitization；外链点击用系统浏览器打开并显示目标域名。
- Agent prompt 注入“权限和输出 contract 不可被用户输入覆盖”的系统级约束。
- 运行前把用户输入和应用 instructions 分区传入，避免混淆。
- 发布前 secret scan：检查常见 token/API key 模式和 `.env` 文件，发现即阻断或强确认。
- Git 操作只能在应用根目录执行，并且 stage 文件集合来自 publish plan。

### 12.2 沙箱策略

MVP 推荐：

- UI 预览使用 iframe sandbox：`allow-scripts` 可按模板开启，默认不允许 `allow-same-origin`。
- 禁止应用 UI 直接访问 Pixie Tauri IPC；所有 action 通过 Pixie 外层 UI 触发。
- 如果必须让 UI 与 runtime 通信，后续引入窄接口 `PixieAppBridge`，只允许：
  - 读取 manifest summary
  - 提交已声明 action 的 inputs
  - 订阅当前 run outputs
  - 读取应用私有 data path 中已授权资源
- `PixieAppBridge` 必须按 app id、action id 和 permission gate 授权，不把通用 `invoke` 暴露给 iframe。

### 12.3 参考安全基线

- Tauri v2 使用 capability 限制前端可访问的权限，Pixie 应避免把主窗口能力透传给应用 iframe。
- GitHub CLI 官方支持 `gh repo create --source {dir} --push`，MVP 发布流程可以基于本机 `git`/`gh`，避免在 Pixie 内保存 token。
- OWASP LLM 风险中，Prompt Injection、Insecure Output Handling、Excessive Agency、Sensitive Information Disclosure 与 Pixie Applications 直接相关，validator、权限门禁和输出消毒必须作为 MVP 基线，而不是增强项。

## 13. MVP 验收标准

创建闭环：

- 用户能从 Applications 页面选择模板并创建新应用目录。
- Pixie 自动生成标准文件。
- Studio 会话自动打开，并显示 App 预览。
- Studio 显示实时 validator 状态。
- 用户让 Agent 修改 UI 后，App 预览自动刷新。
- 用户只能在 validator 通过后安装当前应用。

发布闭环：

- Pixie 能检测当前目录 git/gh 状态。
- 用户只能在 validator 和发布门禁通过后，通过 Pixie 把应用发布到 GitHub。
- 发布成功后能复制 GitHub 安装地址。
- 发布前能看到 diff 和 manifest 校验结果。

安装闭环：

- 用户粘贴 `owner/repo` 能安装公开 GitHub 应用。
- 安装前展示权限和应用信息。
- 安装成功后应用出现在 Applications 列表。
- 用户能更新、卸载应用。

使用闭环：

- 用户点击应用能进入运行页。
- Pixie 根据 manifest 自动生成输入表单。
- 用户点击 action 后，Agent 按 instructions 执行。
- 输出按 manifest outputs 展示。
- 运行记录可查看。

质量标准：

- 所有主流程错误都有明确下一步。
- 没有需要用户手动编辑 JSON 才能完成普通流程的步骤。
- manifest 校验覆盖路径、安全、action 引用、权限枚举。
- 发布和安装过程中不会误删非应用目录。

### 13.1 测试矩阵

Manifest validator：

- 合法最小 manifest 通过。
- JSON 非法、必填字段缺失、未知 schemaVersion 阻断。
- `entry`/`agent` 缺失阻断。
- `entry`/`agent` 使用 `../`、绝对路径、symlink 逃逸阻断。
- action 引用不存在 input/output 阻断。
- 未知权限阻断，高风险权限产生 warning/confirmation requirement。
- 模板规则不满足阻断。

安装：

- Copy install 成功写 registry、复制 source、创建 dataPath。
- Link install 成功写 registry、不复制 source。
- 同 id 重复安装要求确认覆盖。
- GitHub clone 失败不写 registry。
- validator 失败不写 registry。
- 安装过程中异常不留下半成品目录。

运行：

- required input 缺失阻断。
- input 类型不匹配阻断。
- action 不存在阻断。
- Agent 返回合法 JSON，outputs 正确展示。
- Agent 返回非法 JSON，按降级规则处理。
- output 缺失或未知 output id 产生正确状态。
- 用户取消后进程停止，run record 为 `cancelled`。
- 高风险权限未确认时阻断运行。

发布：

- 非 git repo 可 init。
- 无 remote 可通过 gh 创建并 push。
- 有 remote 可 commit/push。
- publish plan 只包含应用目录内文件。
- secret scan 发现 `.env` 或 token-like 内容时阻断或强确认。
- gh 不存在、未登录、无权限、repo 已存在时都有明确修复建议。

更新：

- 远端新 commit 可检测。
- 权限不变更新可安装。
- 权限升级进入确认。
- 新 manifest validator 失败进入 `UpdateBlocked`。
- 本地 copy source 修改时不静默覆盖。

前端：

- 普通用户创建流程不要求编辑 JSON。
- Studio 预览只跟随 `manifest.entry`。
- Inspector 展示 errors/warnings/fixes。
- Applications 列表、详情、运行页在空态、错误态、加载态均可用。
- i18n 覆盖英文、中文、日文新增文案。

### 13.2 质量门禁 Definition of Done

每个 Phase 交付必须满足：

- 有 Rust 单元测试覆盖 validator、registry、path security、output parser。
- 有前端组件测试或手工测试记录覆盖主流程状态。
- 新增 Tauri command 有稳定 TypeScript 类型。
- 所有用户可见文案进入 i18n。
- 所有危险操作有确认页或确认弹窗。
- 文档、README 模板和示例应用同步更新。
- 不引入应用目录外文件写入、删除或 git stage 行为。

## 14. 分阶段实现

### Phase 0：协议和重构准备

- 从 `lib.rs` 拆出 application 模块。
- 定义 typed manifest、ValidationReport、ApplicationRun、PublishPlan 类型。
- 增加模板定义和 validator 基础测试。
- 为 conversation metadata 增加 `mode`、`applicationPath`、`templateId`。
- 拆分 `ApplicationsPanel`，停止复用 `MarketplacePanel` 承载应用主流程。

### Phase 1：补齐本地应用闭环

- 新增模板系统，MVP 至少支持 `single-action-form`。
- 完善 manifest validator。
- 新增 Application Detail/Run 页面。
- 实现 `application_run`。
- 实现 outputs 解析与运行记录。
- Studio 增加 Install locally 和 Manifest Inspector。

### Phase 2：GitHub 发布闭环

- 新增 git/gh 环境检测。
- 实现 publish plan。
- 实现 git init/add/commit/push。
- 实现 `gh repo create --source {dir} --push`。
- 发布成功后写回 source metadata。

### Phase 3：GitHub 安装/更新体验

- 安装前确认页。
- 权限确认。
- 版本和 commit 展示。
- 应用 update。
- 私有仓库错误引导。

### Phase 4：平台化增强

- 内置 GitHub 登录。
- 应用 marketplace/index。
- 应用模板库。
- release/tag 支持。
- 应用 UI 与 Pixie runtime bridge。

## 15. 当前代码需要调整的点

- `application_open` 必须改为后端受控的只读导航命令：`detail` 在 Pixie 内打开应用详情，`source`/`entry`/`run-record` 由后端解析 registry、manifest 或 run history 后打开，禁止前端直接传任意本地路径给通用外部打开 API；`run-record` 只能由后端根据已校验 `appId` 和 canonical UUID `runId` 解析固定 run history 目录，不能读取或信任 `recordPath`、JSON 内容中的路径或前端传入路径。
- `Application Studio` 当前靠 conversation title 判断模式，容易被重命名破坏；应在 conversation metadata 中加入 `mode: "application-studio"` 和 `applicationPath`。
- manifest parser 目前较宽松，validator 需要更严格，特别是路径越界、action 引用、权限枚举。
- `App` tab 文案目前硬编码英文，应纳入 i18n。
- Applications 页面和 Skills Marketplace 共用 `MarketplacePanel`，随着功能扩展建议拆成 `ApplicationsPanel`。
- 现有 Git 面板只有只读能力，需要新增 commit/push/publish command。
- 应用运行时尚未实现，必须补上 `application_run` 才能称为“在当前产品中使用”。

## 16. 决策结论与开放问题

已决策：

- AI 应用 MVP 只支持静态 `ui/index.html` 和相对静态资源，不支持前端构建工程。
- 应用 MVP 不允许声明特定 engine/model；使用用户当前 Pixie engine 设置，后续再加兼容性声明。
- 应用运行使用独立 run session 和 run record，不复用普通 conversation 作为数据模型；可以可选关联 conversationId 便于继续追问。
- 权限确认按 app id + source commit + permission set 记住；权限或 commit 变化后重新确认。
- GitHub 发布允许推送已有远端，但必须展示 remote/branch/diff 并二次确认；不允许静默覆盖。
- 应用更新遇到本地修改进入 `UpdateBlocked`，由用户选择备份、覆盖或转为 link。
- 团队私有应用索引仓库不是 MVP，放入 Platform 1.0 增强。
- Phase 1 只强交付 `single-action-form`，另外两个模板作为 Phase 1.5 示例，不阻塞运行闭环。
- `network` 在 MVP 作为中风险权限允许，但必须安装确认和首次运行确认；如果底层 engine 无法隔离网络，则 UI 文案必须明确“由当前 Agent 引擎执行，Pixie 无法强制隔离网络访问”。
- `html` output MVP 只做 sanitized preview 或下载，不执行 script。

仍开放但不阻塞 MVP：

- Platform 1.0 是否引入签名 publisher，还是先使用组织 allowlist + commit checksum。
- 内置 GitHub OAuth 使用 GitHub App 还是 device flow。
- 应用 UI bridge 的最小事件 API 形态。

## 17. 示例官方模板

### 17.1 single-action-form

适用场景：

- 日报、周报、邮件、总结、改写、提取、分类、格式转换。

目录：

```text
pixie.application.json
README.md
ui/index.html
agent/instructions.md
```

规则：

- 至少 1 个 input。
- 至少 1 个 output。
- 必须有且只有一个默认 action：`run`。
- action mode 必须为 `agent`。
- 不允许 shell。
- 默认权限：`ai:model`、`storage`。

### 17.2 document-helper

适用场景：

- 文件摘要、合同审查、简历优化、会议纪要整理。

规则：

- 必须包含一个 `file` input。
- 默认使用 `file:read-selected`，不默认授予 workspace read。
- output 默认 markdown。
- 如果需要写回文件，必须显式申请 `filesystem:workspace-write`。

### 17.3 data-transformer

适用场景：

- JSON 清洗、CSV 解释、字段映射、结构化提取。

规则：

- 必须包含 `textarea` 或 `json` input。
- 至少一个 `json` output。
- JSON output 建议带 schema。
- Agent 输出触发 `output_json_invalid` 时必须高亮显示；可降级时展示为 parse warning，不可降级时展示为运行失败。

## 18. README 模板要求

发布门禁要求 README 至少包含：

```markdown
# App Name

## What it does

Short description.

## Install

Paste this into Pixie Applications -> Install from GitHub:

owner/repo

## Permissions

- ai:model: why this is needed
- storage: why this is needed

## Inputs

List inputs.

## Outputs

List outputs.

## Actions

List actions.

## Source

GitHub URL, branch, version.
```

README 中声明的 permissions、inputs、outputs、actions 必须和 manifest 一致；不一致时 validator 给 warning。

发布门禁口径：

- README 声明了 manifest 没有的权限、action、input 或 output：发布必须返回 `publish_readme_inconsistent` 并阻断，要求先修复 manifest 或 README。
- README 遗漏 manifest 已声明的权限、action 或 output：发布给 warning，用户必须在确认页显式确认。
- README 与 manifest 对同一字段描述冲突但不改变执行能力：发布给 warning，用户必须确认。
- 安装和运行只以 manifest 为准，README warning 不影响运行时 contract。

## 19. 行业最佳实践映射

- GitHub 分发：MVP 使用本机 `git` 和 `gh`，符合 GitHub CLI 对本地目录创建远端并 push 的官方路径，避免 Pixie 保存 token。
- 桌面安全：应用 UI 不继承 Pixie 主窗口 IPC 权限，符合 Tauri capability 最小授权思路。
- LLM 应用安全：Prompt injection、输出处理、过度代理能力和敏感信息泄露是必须处理的基础风险，因此权限门禁、输出 contract、HTML sanitization 和 secret scan 进入 MVP。
- 产品可治理：应用协议、运行记录、source commit、权限确认记录是团队采用的最低条件，否则无法审计和更新。

## 20. 产品分层与平台边界

为了避免 MVP 过度建设，同时保证未来可以演进成真正的平台，Pixie Applications 按三层定义能力边界：

### 20.1 L0：Local Runnable App

目标：用户在本机创建、安装、运行一个可复用 AI 应用。

必须具备：

- 官方模板创建。
- manifest validator。
- 本地 link/copy install。
- 自动表单渲染。
- `agent` action 运行。
- 结构化 outputs。
- 本地 run history。

不要求：

- GitHub 发布。
- 更新检测。
- 团队治理。
- 应用市场。

### 20.2 L1：GitHub Distributed App

目标：应用可以通过 GitHub 仓库被发布、安装、更新。

必须具备：

- publish plan。
- git/gh 环境检测。
- GitHub 安装源解析。
- install confirmation。
- source commit 固化。
- update/check/rollback。
- README 和 manifest 一致性检查。

不要求：

- Pixie 云端索引。
- Pixie 保存 GitHub token。
- 远程运行。

### 20.3 L2：Governed App Platform

目标：团队可以治理内部 AI 应用。

必须具备：

- 组织应用索引。
- policy allowlist/denylist。
- 权限审批。
- 签名或校验和验证。
- 集中模板库。
- 运行审计导出。
- 私有分发源治理。

L2 不是 MVP，但 L0/L1 的数据模型必须预留字段，避免后续破坏性迁移。

## 21. 端到端用户体验规格

### 21.1 Applications 空态

当没有应用时，页面只提供三个明确入口：

- `Create from template`
- `Install from GitHub`
- `Link local app`

空态不展示市场化推荐，不暗示 Pixie 有云端应用商店。用户第一次进入时应该立即理解：应用是本机安装、可从 GitHub 获取、由 manifest 校验。

### 21.2 创建向导

创建向导必须拆成四步，避免一个大表单暴露过多概念：

1. 选择模板。
2. 填写应用名称、描述和本地路径。
3. 确认初始权限。
4. 进入 Studio。

模板选择页必须显示：

- 适用场景。
- 默认输入/输出。
- 默认权限。
- 不支持的能力。

如果用户自然语言需求超出模板能力，Studio 的首要行为是引导用户选择更合适模板，而不是生成不合规代码。

### 21.3 安装确认页

安装确认页必须用普通用户能理解的语言解释 manifest：

- 来源：GitHub URL、本地路径、commit。
- 这个应用会做什么：description + actions。
- 它需要什么权限：权限名 + 风险级别 + 原因。
- 它会读取什么输入：inputs。
- 它会产生什么输出：outputs。
- Pixie 已经检查了什么：validator summary。

确认按钮文案必须包含动作结果，例如 `Install app`，不能只写 `OK`。

### 21.4 运行页

运行页应该以“完成任务”为中心，而不是以“预览 HTML”为中心：

- 主区域优先展示表单、action、输出。
- 应用自定义 UI 作为辅助视图或高级视图。
- Action 运行中显示流式状态、取消按钮和已用时间。
- 输出区域支持复制、保存到应用数据目录、重新运行；重新运行是新的业务运行，前端必须生成新的 `idempotencyKey`。
- 运行失败时展示结构化错误和下一步。

MVP 不允许应用 UI 自行绕过 Pixie 外层运行按钮触发高风险能力。

### 21.5 更新确认页

更新确认页必须展示 diff summary，而不是只展示“有新版本”：

- 旧 version -> 新 version。
- 旧 commit -> 新 commit。
- permissions 变化。
- actions/inputs/outputs 变化。
- entry/agent 路径变化。
- README 权限说明变化。
- validator 新增 warning/error。

权限升级、entry/agent 替换、shell 新增、workspace write 新增，都必须作为高风险变化突出展示。

## 22. Manifest Schema 最终口径

MVP 需要维护一份机器可消费 JSON Schema，并把它用于 Studio、安装、发布、运行四个链路。文档里的示例不能成为事实来源，事实来源必须是 Rust typed manifest + JSON Schema 测试快照。

### 22.1 顶层字段分级

必填执行字段：

- `schemaVersion`
- `id`
- `name`
- `version`
- `description`
- `template`
- `entry`
- `agent`
- `permissions`
- `inputs`
- `outputs`
- `actions`

可选展示字段：

- `author`
- `homepage`
- `repository`
- `license`
- `keywords`
- `screenshots`

保留字段：

- `minimumPixieVersion`
- `capabilities`
- `dataVersion`
- `migrations`
- `signature`
- `policy`

规则：

- 必填执行字段缺失必须阻断。
- 可选展示字段格式错误给 warning；如果会影响安全或路径读取，则阻断。
- 保留字段可以解析、展示、保留，但 MVP 不执行其行为。

### 22.2 `id` 命名策略

`id` 是本机 registry 的主键，必须稳定。MVP 推荐：

```text
github.user.daily-report
local.user.daily-report
com.example.daily-report
```

冲突处理：

- 同 source URL + 同 id：视为同一个应用的重装或更新。
- 不同 source URL + 同 id：必须阻断并提示用户重命名或安装为 fork id。
- Link install 使用同 id 时必须提示会覆盖 registry 指向。

### 22.3 路径字段规范

所有 manifest 路径必须满足：

- 相对路径。
- 使用 `/` 分隔。
- 不包含 `..`。
- 不以 `/`、`~`、盘符开头。
- canonicalize 后仍在 app root 内。
- symlink resolved path 仍在 app root 内。

路径校验必须在读取文件前执行；失败错误码使用 `path_escape`、`path_absolute`、`path_symlink_escape`。

### 22.4 SemVer 策略

`version` 必须是 SemVer，MVP validator 对非法 SemVer 给 error，而不是 warning。原因是更新、回滚和用户沟通都依赖稳定版本语义。

更新语义：

- patch：bug fix，不应改变权限、inputs、outputs、actions contract。
- minor：可以新增可选 input/output/action，不能删除已有 contract。
- major：可以破坏 contract，必须在更新确认页突出展示。

如果应用从 GitHub 安装，commit 是真实性来源，version 是产品语义来源，两者都必须记录。

## 23. Runtime 架构最优解

### 23.1 核心组件

后端 runtime 建议拆成五个清晰组件：

- `ManifestResolver`：读取、canonicalize、hash、validate manifest。
- `PermissionBroker`：判断安装授权、运行授权、权限升级和记住选择。
- `RunOrchestrator`：创建 run record、启动 Agent、处理取消和超时。
- `OutputContractParser`：解析 JSON fenced block、校验 outputs、降级处理。
- `AuditWriter`：写 run event、run summary、错误和指标。

运行链路中，只有 `PermissionBroker` 可以决定是否允许危险能力；前端不能绕过。

### 23.2 Manifest Snapshot

每次运行必须生成 manifest snapshot：

```json
{
  "manifest": {
    "schemaVersion": 1,
    "id": "daily-report",
    "name": "Daily Report",
    "version": "0.1.0",
    "entry": "ui/index.html",
    "agent": "agent.md",
    "inputs": [
      {
        "id": "rawNotes",
        "label": "Raw notes",
        "type": "text",
        "required": true
      }
    ],
    "outputs": [
      {
        "id": "summary",
        "label": "Summary",
        "type": "text",
        "required": true
      }
    ],
    "actions": [
      {
        "id": "summarize",
        "label": "Summarize",
        "inputs": ["rawNotes"],
        "outputs": ["summary"]
      }
    ],
    "permissions": ["ai:model", "storage"]
  },
  "manifestHash": "sha256:4f8c2d0b7a9e6c1d5b3a2f90123456789abcdef0123456789abcdef012345678",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "resolvedAt": "2026-07-25T10:00:00Z"
}
```

run record 记录 snapshot，而不是运行结束后重新读取当前 manifest。这样可以保证运行可审计，即使用户在运行中修改源码。

### 23.3 Prompt 分区协议

Agent prompt 必须严格分区：

```text
<pixie_system_contract>
Immutable runtime rules, permissions, output protocol.
</pixie_system_contract>

<app_manifest>
Validated manifest snapshot.
</app_manifest>

<app_instructions>
Contents of manifest.agent.
</app_instructions>

<user_inputs>
Typed inputs for selected action.
</user_inputs>

<output_contract>
Declared outputs and required JSON format.
</output_contract>
```

原则：

- 用户输入永远不能和系统约束放在同一块。
- app instructions 不能覆盖 Pixie system contract。
- output contract 必须出现在 prompt 尾部附近，降低格式漂移。
- prompt 中必须明确：如果需求和权限冲突，以权限为准并返回结构化错误。

### 23.4 Tool/Action 边界

MVP 的 `mode=agent` 不等于 Agent 可以执行任意工具。运行时必须把可用工具收敛到权限允许范围：

- 无 `filesystem:*`：不得给 Agent 提供 workspace 文件读取工具。
- 只有 `file:read-selected`：只能读取本次 input 中显式选择的文件。
- 无 `network`：不得鼓励或显式提供网络检索工具；如果底层 engine 无法隔离，必须在 UI 中标注“由当前 Agent 引擎控制，Pixie 无法强制隔离”。
- 无 `shell`：不得调用 shell command tool。
- 有 `shell`：必须每次 action 运行前确认，并记录命令摘要。

### 23.5 Output Parser 细节

解析器必须是确定性的：

- 查找最后一个 fenced block，语言标记为 `json` 或空。
- JSON parse 失败则进入降级路径。
- 顶层只接受 `outputs`、`metadata`、`error`。
- `outputs` value 类型必须匹配 manifest output type。
- `metadata` 必须限制大小，MVP 建议 <= 16 KB。
- 单个 text/markdown output MVP 建议 <= 2 MB，超过则写入 file output 或截断并提示。

输出消毒：

- markdown 渲染前 sanitize HTML。
- 链接默认显示目标域。
- 禁止 `javascript:`、`data:` 这类危险链接。
- html output 默认不执行 script。

## 24. 安全控制平面

### 24.1 Trust Level

应用详情页必须展示 trust level，避免用户把“能安装”误解为“可信”：

```text
Unverified Local
Verified Local
GitHub Source
Trusted Publisher
Policy Approved
```

MVP 只实现前三个：

- `Unverified Local`：本地目录，未通过 validator 或 source 不明。
- `Verified Local`：本地目录，validator 通过。
- `GitHub Source`：从 GitHub commit 安装，validator 通过。

`Trusted Publisher` 和 `Policy Approved` 留给团队版，需要签名、组织策略或索引仓库背书。

### 24.2 Secret Scan 基线

发布前至少扫描：

- `.env`
- `.npmrc`
- `.pypirc`
- `id_rsa`、`id_ed25519`
- GitHub token 模式。
- OpenAI/Anthropic/Google 常见 API key 模式。
- AWS access key 模式。
- 私钥 PEM header。

结果分级：

- error：私钥、token、高置信 API key，默认阻断。
- warning：低置信 secret-like 字符串，需要确认。
- info：被 `.gitignore` 排除或模板示例值。

MVP 可以先实现正则扫描，不引入复杂依赖。后续可接入 gitleaks 类工具或自研规则库。

### 24.3 Supply Chain 控制

MVP 不支持构建链，因此供应链风险主要来自：

- GitHub source 本身。
- HTML/JS 静态资源。
- Agent instructions。
- README 欺骗。

控制策略：

- 安装前不执行代码。
- 禁止远程脚本作为默认模板产物。
- validator warning 未引用的大型 JS 文件。
- README 和 manifest 不一致时提示。
- source commit 固化到 registry。

Platform 1.0 可增加：

- manifest 签名。
- publisher allowlist。
- app index checksum。
- SBOM 或 file inventory。

### 24.4 Policy Engine 预留

团队版需要策略引擎，MVP 数据结构应预留但不执行：

```json
{
  "policy": {
    "allowedPermissions": ["ai:model", "storage", "file:read-selected"],
    "deniedPermissions": ["shell"],
    "allowedSources": ["github.com/acme/*"],
    "requiresApproval": ["network", "filesystem:workspace-write"]
  }
}
```

策略优先级：

```text
Org Policy > User Grant > App Manifest Default
```

如果策略拒绝某权限，用户不能通过本地确认覆盖。

## 25. 隐私、观测与产品指标

### 25.1 Local-first 数据原则

默认不上传：

- manifest 内容。
- user inputs。
- Agent outputs。
- run history。
- source code。
- GitHub private URL。

如果后续加入产品遥测，必须默认脱敏且可关闭。

### 25.2 本地运行指标

本地可记录、用于应用详情和调试：

- install count。
- run count。
- last run status。
- average duration。
- validator error history。
- `output_json_invalid` count，并按 `completed_with_parse_warning` 与 `failed` 分开统计。
- permission confirmation history。

这些指标不需要上传，也不应包含用户输入原文。

### 25.3 可选匿名遥测

如果用户开启遥测，只允许上传聚合事件：

```json
{
  "event": "application_run_completed",
  "schemaVersion": "0.1",
  "templateId": "single-action-form",
  "permissionRisk": "low",
  "durationMsBucket": "10s-30s",
  "status": "completed"
}
```

禁止上传：

- app id 原文。
- GitHub owner/repo。
- inputs/outputs。
- file paths。
- prompts。
- token、secret、environment values。

### 25.4 North Star Metrics

MVP 北极星指标：

- `successful_first_run_rate`：创建或安装后 24 小时内至少成功运行一次的应用占比。

辅助指标：

- `create_to_first_run_p50`。
- `install_to_first_run_p50`。
- `validator_error_resolution_rate`。
- `output_contract_success_rate`。
- `permission_denial_rate`。
- `github_publish_success_rate`。
- `update_blocked_rate`。

指标解释必须结合本地日志和用户反馈，不能只看漏斗数字，因为用户可能故意拒绝高风险权限。

## 26. API 与类型契约

前后端共享类型必须稳定，建议由 Rust 类型生成 TypeScript，或维护快照测试防止破坏。

### 26.1 核心 TypeScript 类型

```ts
type ApplicationStatus =
  | 'draft'
  | 'validated'
  | 'installed'
  | 'runnable'
  | 'running'
  | 'completed'
  | 'invalid'
  | 'published'
  | 'update_available'
  | 'update_blocked'
  | 'uninstalled';

type ValidationSeverity = 'error' | 'warning' | 'info';

type PermissionRisk = 'low' | 'medium' | 'high';

type ApplicationRunStatus =
  | 'running'
  | 'completed'
  | 'completed_with_parse_warning'
  | 'failed'
  | 'output_contract_failed'
  | 'cancelled';
```

`ApplicationRunStatus` 只表示一次可解析运行记录的执行状态，不包含 run history 诊断类型；`corrupted` 只能出现在 `ApplicationRunHistoryItem` 的 `diagnostic` 字段。

所有 Tauri command 必须返回 discriminated union：

```ts
type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PixieApplicationError };
```

前端不应该靠 try/catch 字符串判断业务状态。

### 26.2 幂等性要求

不需要 idempotency key 的只读、导航或可重建计划 command：

- `application_validate`
- `application_list`
- `application_get`
- `application_template_list`
- `application_run_list`
- `application_open`
- `github_env_check`
- `application_publish_plan`
- `git_remote_list`

需要 idempotency key 的 command：

- `application_create`
- `application_install_local`
- `application_install_github`
- `application_run`
- `application_update`
- `application_publish`
- `application_uninstall`
- `git_init`
- `git_add`
- `git_commit`
- `git_push`
- `github_repo_create`

原因：桌面 UI 可能因为重试、窗口刷新或事件重复导致命令重复触发。安装、发布、运行必须能识别重复请求，避免重复 registry 记录、重复 commit 或重复 run。

幂等结果保存：

- 后端应把 idempotency key、command name、request hash、result summary 保存到本地短期记录。
- 同 key + 同 request hash：返回首次执行结果或继续未完成操作。
- 同 key + 不同 request hash：返回 `idempotency_key_conflict`。
- 幂等记录 MVP 至少保留 24 小时，或保留最近 1000 条。
- 失败结果也要记录，除非失败发生在请求校验前。
- request hash 必须基于规范化 JSON：按字段名排序、去除未定义字段、保留 null、路径先 canonicalize、时间字段不参与 hash，避免同一请求因序列化顺序不同产生不同 hash。
- result summary 不保存大型 outputs 或敏感内容；保存 command 状态、资源 id、run id、commit SHA、错误码和必要恢复指针。
- 对运行类命令，同 key 同 hash 重试必须返回同一个 run id；不得创建第二条 run record。
- 对安装和更新类命令，同 key 同 hash 重试必须返回同一个 registry entry snapshot；如果上次停在中间态，必须继续恢复或返回 `idempotency_recovery_failed`。
- 如果后端为兼容旧 Studio 保留内部迁移写操作，它也必须复用 `application_create` 的幂等语义；MVP UI 不得调用任何迁移专用入口。

### 26.3 Command 输入输出契约

MVP 公开 command 的最小契约如下，字段名必须和 TypeScript 类型一致。历史迁移逻辑不属于本节公共契约；如果后端保留，只能在内部迁移路径使用，前端不得调用。

```ts
type PixieApplicationError = {
  code: string;
  message: string;
  severity: ValidationSeverity;
  path?: string;
  field?: string;
  fix?: string;
};

type ValidationReport = {
  ok: boolean;
  errors: PixieApplicationError[];
  warnings: PixieApplicationError[];
  template?: {
    id: string;
    ok: boolean;
  };
};

type PixieApplicationEntry = {
  appId: string;
  name: string;
  version: string;
  status: ApplicationStatus;
  sourceType: 'local-copy' | 'local-link' | 'github';
  sourcePath: string;
  dataPath: string;
  manifestPath: string;
  installedAt: string;
  updatedAt: string;
  sourceCommit: string | null;
};

type ApplicationTemplate = {
  id: string;
  name: string;
  description: string;
  supportedInputs: string[];
  supportedOutputs: string[];
};

type ApplicationListRequest = Record<string, never>;

type ApplicationListResult = {
  applications: PixieApplicationEntry[];
};

type ApplicationValidateRequest = {
  path: string;
};

type ApplicationValidateResult = {
  report: ValidationReport;
};

type ApplicationTemplateListRequest = Record<string, never>;

type ApplicationTemplateListResult = {
  templates: ApplicationTemplate[];
};

type ApplicationCreateRequest = {
  path: string;
  templateId: string;
  metadata: {
    name: string;
    description: string;
    id?: string;
  };
  idempotencyKey: string;
};

type ApplicationCreateResult = {
  application: PixieApplicationEntry;
};

type ApplicationGetRequest = {
  appId: string;
};

type ApplicationGetResult = {
  application: PixieApplicationEntry;
};

type ApplicationInstallLocalRequest = {
  path: string;
  mode: 'copy' | 'link';
  overwrite?: boolean;
  idempotencyKey: string;
};

type ApplicationInstallLocalResult = {
  application: PixieApplicationEntry;
};

type ApplicationInstallGitHubRequest = {
  source: string;
  ref?: string;
  idempotencyKey: string;
};

type ApplicationInstallGitHubResult = {
  application: PixieApplicationEntry;
};

type ApplicationRunRequest = {
  appId: string;
  actionId: string;
  inputs: Record<string, unknown>;
  workspacePath?: string;
  conversationId?: string;
  idempotencyKey: string;
};

type ApplicationRunResult = {
  run: ApplicationRun;
};

type ApplicationRunListRequest = {
  appId: string;
};

type ApplicationRunListResult = {
  // Includes kind: 'run' items and items with diagnostic: 'corrupted'.
  // Records with canonical UUID filenames but unreadable or inconsistent JSON are returned here, not as command errors.
  // Items with diagnostic: 'corrupted' are displayable entries in the runs array, not PixieApplicationError values.
  // Invalid-filename records are omitted and only written to local diagnostic logs.
  runs: ApplicationRunHistoryItem[];
};

type ApplicationPublishTarget =
  | {
      mode: 'installed-app';
      appId: string;
    }
  | {
      mode: 'source-path';
      path: string;
    }
  | {
      mode: 'installed-app-at-path';
      appId: string;
      path: string;
    };

type ApplicationUpdateRequest = {
  appId: string;
  strategy?: 'backup-and-replace' | 'overwrite' | 'convert-to-link';
  idempotencyKey: string;
};

type ApplicationUpdateResult = {
  application: PixieApplicationEntry;
};

type ApplicationPublishPlanRequest = {
  target: ApplicationPublishTarget;
};

type ApplicationPublishPlanResult = {
  plan: PublishPlan;
};

type ApplicationPublishRequest = {
  target: ApplicationPublishTarget;
  planId: string;
  owner: string;
  repo: string;
  visibility: 'private' | 'public';
  commitMessage: string;
  idempotencyKey: string;
};

type ApplicationPublishResult = {
  publish: PublishResult;
};

type ApplicationUninstallRequest = {
  appId: string;
  deleteSource?: boolean;
  deleteData?: boolean;
  idempotencyKey: string;
};

type ApplicationOpenRequest =
  | {
      appId: string;
      target?: 'detail';
    }
  | {
      appId: string;
      target: 'source' | 'entry';
    }
  | {
      appId: string;
      target: 'run-record';
      // Canonical UUID generated by the backend; never a path, recordPath, or JSON-content-derived value.
      runId: string;
    };

type ApplicationOpenResult = {
  opened: boolean;
  target: 'detail' | 'source' | 'entry' | 'run-record';
};

type GitHubEnvironmentCheckRequest = Record<string, never>;

type GitHubEnvironmentCheckResult = {
  ghInstalled: boolean;
  authenticated: boolean;
  viewer?: string;
  availableOwners: string[];
  fix?: string;
};

type GitInitRequest = {
  path: string;
  idempotencyKey: string;
};

type GitInitResult = {
  initialized: boolean;
  branch: string;
};

type GitRemoteListRequest = {
  path: string;
};

type GitRemoteListResult = {
  remotes: Array<{ name: string; url: string }>;
};

type GitAddRequest = {
  path: string;
  files: string[];
  idempotencyKey: string;
};

type GitAddResult = {
  stagedFiles: string[];
};

type GitCommitRequest = {
  path: string;
  message: string;
  idempotencyKey: string;
};

type GitCommitResult = {
  commit: string;
};

type GitPushRequest = {
  path: string;
  remote: string;
  branch: string;
  idempotencyKey: string;
};

type GitPushResult = {
  pushed: boolean;
  commit: string;
};

type GitHubRepoCreateRequest = {
  path: string;
  owner: string;
  name: string;
  visibility: 'private' | 'public';
  idempotencyKey: string;
};

type GitHubRepoCreateResult = {
  repositoryUrl: string;
  remoteName: string;
};

type ApplicationRunHistoryItem =
  | {
      kind: 'run';
      // run.runId is derived from the canonical UUID filename when listing history.
      // run.appId is confirmed from the request or run history directory context.
      run: ApplicationRun;
    }
  | {
      kind: 'diagnostic';
      // Run history diagnostic item, not a command error code.
      diagnostic: 'corrupted';
      // Confirmed from the request or run history directory context, never from corrupted JSON content.
      appId: string;
      // Derived from a canonical UUID filename, never from corrupted JSON content.
      runId: string;
      // Backend-derived display-only text for this diagnostic item, never accepted as command input or path authority.
      recordPath: string;
      message: string;
    };

type ApplicationRun = {
  // Generated by the backend when running; derived from the canonical UUID filename when listing history.
  runId: string;
  // Confirmed from the request or run history directory context when listing history.
  appId: string;
  actionId: string;
  status: ApplicationRunStatus;
  startedAt: string;
  completedAt?: string;
  manifestSnapshot: unknown;
  sourceCommit: string | null;
  outputs?: Record<string, unknown>;
  error?: PixieApplicationError;
};

type PublishPlan = {
  planId: string;
  appId: string;
  target: ApplicationPublishTarget;
  appRoot: string;
  validator: ValidationReport;
  git: {
    isRepo: boolean;
    currentBranch: string | null;
    baseCommit: string | null;
    hasRemote: boolean;
    remoteUrl: string | null;
    changedFiles: string[];
    outsideAppFiles: string[];
    hasUntrackedFiles: boolean;
  };
  github: GitHubEnvironmentCheckResult;
  security: {
    secretScan: { ok: boolean; findings: PixieApplicationError[] };
    largeFiles: Array<{ path: string; sizeBytes: number }>;
  };
  readme: {
    exists: boolean;
    consistency: {
      blocking: PixieApplicationError[];
      warnings: PixieApplicationError[];
    };
  };
  generatedAt: string;
  expiresAt: string;
  fileInventoryHash: string;
  manifestHash: string;
  readmeConsistencyHash: string;
  secretScanHash: string;
};

type PublishResult = {
  appId: string;
  repositoryUrl: string;
  branch: string;
  commit: string;
  pushed: boolean;
  installSource: string;
};

type ApplicationUninstallResult = {
  appId: string;
  removedFromRegistry: boolean;
  sourceDeleted: boolean;
  dataDeleted: boolean;
  warnings: PixieApplicationError[];
};
```

契约规则：

- 所有 path 输入必须在后端 canonicalize，前端传入的 path 不能被信任。
- 只有 `ApplicationPublishPlanRequest` 和 `ApplicationPublishRequest` 支持 `ApplicationPublishTarget`。`installed-app` 用 registry 中的 `appId` 解析 app root；`source-path` 用于 Studio 尚未安装的应用；`installed-app-at-path` 必须把 `appId` 和 `path` 解析到同一个应用 root，否则返回 `manifest_id_conflict` 或 `path_escape`，不得猜测优先级。
- `ApplicationPublishRequest.target` 必须与 `ApplicationPublishPlanRequest.target` 的规范化结果一致，不能用一个 target 生成 plan 后改用另一个 app 或 path 执行发布。
- 所有时间字段使用 ISO 8601 UTC 字符串。
- 所有 hash 字段使用 `sha256:` 加 64 位小写十六进制字符。
- 所有 source commit 字段在存在 git source 时必须使用完整 40 字符 commit SHA；纯本地非 git source 使用 `null`，不得写短 SHA 或伪造值。UI 可截断展示，registry 不截断保存。
- 所有 `appId` 字段必须符合 manifest id 规则，不能包含路径分隔符、空白控制字符或 URL 保留字符。
- 所有 `runId` 字段必须符合后端生成的 canonical UUID 格式，不能包含路径分隔符、空白控制字符或 URL 保留字符。请求字段必须在任何路径拼接或文件访问前校验；`ApplicationOpenRequest.runId` 校验失败返回 `runtime_run_id_invalid`。响应、事件和持久化记录只能写入已校验的后端生成值；run history 列表中的 `kind: 'run'` item 和 `diagnostic: 'corrupted'` item 都只能使用从合法 UUID 文件名派生的 `runId`。JSON 内容中的 run id 只能用于一致性校验，不得覆盖文件名派生值；合法 UUID 文件名对应的 JSON run id 缺失、非法或不一致时必须返回 `diagnostic: 'corrupted'` item，非法文件名只能写本地诊断日志，不能返回伪造或内容派生的 `runId`。
- `application_run_list` 返回的 `appId` 必须来自请求参数或后端确认的 run history 目录上下文；JSON 内容中的 app id 只能用于一致性校验，不得覆盖 `kind: 'run'` item 或 `diagnostic: 'corrupted'` item 的 `appId`。合法 UUID 文件名对应的 JSON app id 缺失、非法或与请求/目录上下文不一致时必须返回 `diagnostic: 'corrupted'` item。
- `application_run_list` 读取历史时发现的单条文件名或 JSON 内容问题不得返回 `runtime_run_id_invalid` 或其他 command error；只有整个 run history 目录不可访问等命令级失败才返回 `CommandResult.ok=false`。
- 所有 `idempotencyKey` 字段由前端生成 UUID v4；后端只接受 36 字符 canonical UUID 字符串。
- `ApplicationOpenRequest.target` 默认为 `detail`。`source` 必须打开 registry 中该 app 的 canonical source root；`entry` 必须打开 manifest `entry` 解析后的 canonical 文件，且不得越过 source root；`run-record` 是唯一接受 `runId` 的 target，后端必须按 Pixie data root 下的 `application-runs/{appId}/{runId}.json` 解析 canonical 记录路径，并确认它位于该 app 的 run history 目录内，记录不存在时返回 `runtime_record_missing`。`run-record` 不得从 run record JSON 内容、`recordPath` 或前端 path 参数取得打开路径。`recordPath` 只能出现在 `diagnostic: 'corrupted'` item 中，任何 target 都不得接受或打开前端提供的 path、recordPath 或 JSON 内容中的路径。

## 27. 实施优先级重排

行业最优解不是先把 GitHub 打通，而是先把本地协议和 runtime 做硬。推荐实际开发顺序：

1. Manifest typed model + validator。
2. 官方 `single-action-form` 模板。
3. Applications 独立页面和创建向导。
4. Link install + copy install。
5. Run page + `application_run` + output parser。
6. Run history + permission broker。
7. Studio Inspector + 自动预览刷新。
8. PublishPlan。
9. GitHub publish。
10. GitHub install。
11. Update/rollback。

这个顺序保证每一步都能交付可验证价值。GitHub 发布如果提前做，会在 runtime 不完整时制造“能分享但不能稳定使用”的错误产品信号。

### 27.1 P0/P1/P2 任务切分

P0 必须先完成，且不依赖 GitHub：

- Rust typed manifest 和 JSON Schema。
- `single-action-form` 模板 fixture。
- validator + P0 错误码。
- path canonicalize + symlink escape 测试。
- Applications 独立页面空态、创建向导、详情页。
- Link install、copy install、registry 原子写。
- `application_run`、output parser、run record、取消。
- PermissionBroker 对高风险权限的运行阻断。

P1 完成 GitHub 分发闭环：

- GitHub source parser。
- install confirmation。
- publish plan + secret scan。
- git/gh env check。
- publish execute + idempotency。
- update check、UpdateBlocked、rollback。

P2 进入平台化增强：

- document-helper 和 data-transformer 作为正式模板。
- GitHub OAuth/GitHub App。
- policy engine 执行。
- trusted publisher/signature。
- UI bridge。

任何 P1/P2 工作不得绕过 P0 的 validator、PermissionBroker、manifest snapshot 和 run record。

### 27.2 Phase Exit Criteria

Phase 0 exit：

- PRD 中的 manifest 示例、JSON Schema、Rust typed model、模板 fixture 一致。
- `application_validate` 可对 fixture 返回稳定 `ValidationReport`。
- P0 错误码已有快照测试。

Phase 1 exit：

- 用户可从模板创建、link install、运行并查看 run history。
- required input、权限未确认、非法 output 都有可见错误。
- 本地应用不需要 GitHub 也能完成完整使用闭环。

Phase 2 exit：

- publish plan 和 publish execute 有一致性校验。
- secret scan 高置信发现阻断发布。
- gh 缺失、未登录、repo 已存在、push 失败都有修复建议。

Phase 3 exit：

- GitHub public repo 可以安装、固化 commit、运行。
- 更新权限升级进入确认，validator 失败进入 `UpdateBlocked`。
- 更新失败可回滚 source 和 registry。

## 28. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| Studio 生成不合规应用 | 高 | 高 | 模板强约束、validator 阻断、Agent prompt 注入 manifest schema |
| Agent 输出不满足 contract | 高 | 中 | JSON 输出协议、降级策略、output parser 测试 |
| 用户误授高风险权限 | 中 | 高 | 分级权限、action 级确认、清晰风险文案 |
| GitHub 发布误提交隐私文件 | 中 | 高 | publish plan、目录边界、secret scan、只 stage plan 文件 |
| iframe 逃逸或 IPC 暴露 | 低 | 高 | sandbox iframe、禁止通用 invoke、后续窄 bridge |
| update 覆盖用户本地修改 | 中 | 高 | manifest hash、source dirty check、UpdateBlocked |
| validator 过严阻塞真实需求 | 中 | 中 | 模板分层、高级模式后置、错误 fix 可操作 |
| 权限声明和底层 Agent 实际能力不一致 | 中 | 高 | UI 明确底层限制、PermissionBroker 收敛可控工具 |
| 文档和实现漂移 | 高 | 中 | schema snapshot、README 模板测试、PRD 决策同步到代码注释/测试 |

## 29. 最终 MVP Definition of Ready

进入实现前必须具备：

- 本 PRD 中 L0 范围已冻结。
- `pixie.application.json` JSON Schema 已落盘。
- `single-action-form` 模板 fixture 已落盘。
- validator error code 列表已落盘。
- Rust/TypeScript 核心类型已定义。
- 安全默认值已确认：无 shell、无 workspace write、iframe sandbox、HTML sanitize。
- i18n key 命名方案已确认。

如果这些条件未满足，不应开始 GitHub 发布功能。

## 30. 最终 MVP Definition of Done

MVP 只有在以下条件全部满足时才能标记完成：

- 非技术用户可以从模板创建、安装、运行一个应用，不编辑 JSON。
- 高级用户可以查看 manifest、validator、run history 和源码。
- GitHub 公开仓库可以安装并固化 commit。
- 发布流程有 publish plan、diff、secret scan、权限说明。
- 每次运行都有 run record 和 manifest snapshot。
- 高风险权限无法静默运行。
- 应用 UI 无法直接调用 Pixie 主窗口 IPC。
- 更新失败不会破坏旧版本 source、dataPath 或 registry。
- 所有核心错误都有稳定 error code 和 fix。
- 测试矩阵中 P0/P1 用例通过。

## 31. 参考资料

- GitHub CLI manual: `gh repo create` 支持 `--source` 和 `--push`，适合 MVP 基于用户本机凭据完成发布。
- GitHub Docs: Adding locally hosted code to GitHub，确认 GitHub CLI 是官方推荐路径之一。
- Tauri v2 Security and Capabilities：能力应按窗口/WebView 收敛，应用 iframe 不应继承主窗口能力。
- Tauri v2 File System plugin security：路径访问必须防止 path traversal。
- OWASP Top 10 for LLM Applications 2025：Prompt Injection、Sensitive Information Disclosure、Improper Output Handling、Excessive Agency 是 Pixie Applications 的基础风险模型。
