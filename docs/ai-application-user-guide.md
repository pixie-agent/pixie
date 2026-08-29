# Pixie AI 应用使用指南

Pixie AI 应用是一种由 manifest 声明、本地文件承载、AI Agent 驱动的轻量应用。你可以用一句自然语言描述需求，让 Agent 替你把应用搭出来，然后在 Pixie 里直接运行；也可以把别人发布在 GitHub 上的应用一键装进来使用。

一个 AI 应用由四部分组成：

| 组成 | 说明 | 文件 |
| --- | --- | --- |
| UI | 用户可见界面，静态 HTML/CSS/JS | `ui/index.html` |
| Agent | 应用背后的 AI 行为说明 | `agent/instructions.md` |
| Contract | inputs / outputs / actions / permissions 声明 | `pixie.application.json` |
| Source | 本地目录或 GitHub 仓库 | 应用根目录 |

其中 `pixie.application.json` 是唯一事实来源：界面上渲染哪些输入框、能执行哪些动作、输出什么格式，全部由它声明。普通用户全程不需要手动编辑这个文件——Agent 会帮你维护。

> 完整的产品需求与协议规格见 [ai-application-platform-prd.md](./ai-application-platform-prd.md)。本指南描述的是当前版本已上线的功能。

---

## 目录

1. [前置条件](#前置条件)
2. [创建你的第一个 AI 应用](#创建你的第一个-ai-应用)
3. [在 Studio 里开发和预览](#在-studio-里开发和预览)
4. [安装到 Applications 列表](#安装到-applications-列表)
5. [使用应用：填输入、运行、看输出](#使用应用填输入运行看输出)
6. [从 GitHub 安装应用](#从-github-安装应用)
7. [应用与 UI 之间如何通信(开发者向)](#应用与-ui-之间如何通信开发者向)
8. [管理已安装的应用](#管理已安装的应用)
9. [数据存放在哪里](#数据存放在哪里)
10. [常见问题排查](#常见问题排查)

---

## 前置条件

- 已安装 Pixie 并完成至少一个 Agent 引擎(Claude Code / Cursor Agent / CodeBuddy)的配置。应用运行时会使用你当前选择的默认引擎。
- 创建应用需要一个本地空目录(或已有应用目录)作为应用根目录。
- 从 GitHub 安装应用需要网络；私有仓库依赖本机 git 凭据。

---

## 创建你的第一个 AI 应用

1. 打开侧边栏 **Applications**(应用)标签页。
2. 点击右上角 **构建 AI 应用**(Start Studio)按钮。
3. 在弹窗中用一两句话描述你想要什么，例如：

   > 创建一个合同审查助手：用户粘贴合同文本后，标出风险条款并给出修改建议。

   描述建议覆盖三点：目标用户是谁、输入什么数据、期望得到什么结果。
4. 点击 **选择保存位置**，在目录选择器中新建或选择一个文件夹作为应用根目录。
5. Pixie 会自动：
   - 生成应用骨架(`pixie.application.json`、`ui/index.html`、`agent/instructions.md`);
   - 把该目录加入 workspace;
   - 创建一个 Application Studio 会话，并把你的需求连同开发规则一起注入给 Agent。

接下来 Agent 会开始搭建应用，你只需要在聊天里继续提需求。

## 在 Studio 里开发和预览

Application Studio 会话的界面分三块：

- **左侧聊天区**：用自然语言驱动 Agent 修改应用，例如"加一个语气选择下拉框"、"输出改为表格"。
- **右侧 App 标签页**：实时预览 `pixie.application.json` 中 `entry` 指向的页面。Agent 每次修改后会自动刷新，无需手动操作。
- **右侧文件 / Git 标签页**：查看 Agent 改了哪些文件、diff 是什么。

App 标签页顶部有校验状态灯：

- ✅ **应用校验通过，可以安装** —— manifest 和入口文件完好，随时可以安装；
- ⚠️ **应用尚未就绪** —— manifest 有问题(如 `entry` 指向的文件不存在)，悬停可查看具体问题；
- 校验通过后，点击 **安装并使用** 即可把应用装进 Applications 列表(安装的是当前目录的引用，继续开发后重新运行即用最新版本)。

两个习惯可以少踩坑：

- 所有界面改动都让 Agent 落在 manifest 的 `entry` 文件里，App 预览只认这个入口；
- "完成"的标志是校验通过 + 预览符合预期，而不是 Agent 回复"已完成"。

## 安装到 Applications 列表

除了在 Studio 内安装，Applications 页面还提供两种本地安装方式：

- **安装本地目录**：把一个已有应用目录复制进 Pixie 数据目录，适合稳定使用。
- **链接本地应用**：直接引用外部目录，不复制文件，适合边开发边用。卸载时只移除注册记录，不会动你的源目录。

安装时 Pixie 会校验 `pixie.application.json`(JSON 合法、`entry`/`agent` 文件存在、路径不越界等)，校验不通过会拒绝安装并给出原因。

## 使用应用：填输入、运行、看输出

1. 在 Applications 列表点击 **使用**(Use)展开应用。
2. Pixie 根据 manifest 的 `inputs` 自动渲染输入表单(文本框、下拉框、文件选择等)，带必填校验和默认值。
3. 填好后点击应用声明的动作按钮(如 **Run**),或直接在应用界面内操作(见下一节)。
4. Agent 按 `agent/instructions.md` 的说明执行，完成后：
   - 输出按 manifest 的 `outputs` 类型渲染(markdown / json / text 等),支持复制；
   - 每次运行都会写入运行记录，列表中可查看"上次结果"与状态。

运行状态说明：

| 状态 | 含义 |
| --- | --- |
| 已完成 | 正常结束，输出符合契约 |
| 解析警告 | 结束但输出格式未完全符合契约，已降级展示 |
| 输出契约失败 | 缺少必填输出 |
| 失败 | 运行出错，可查看错误信息 |

## 从 GitHub 安装应用

1. 在 Applications 页面 **安装已有 App** 区域输入 GitHub 来源，支持以下格式：
   - `owner/repo`
   - `https://github.com/owner/repo`
   - `https://github.com/owner/repo.git`
   - SSH git URL
2. 如需指定分支，在旁边填入分支名(留空则用默认分支)。
3. 点击 **从 GitHub 安装**。Pixie 会 clone 仓库、读取并校验 manifest,通过后应用出现在列表中并自动展开。

公开仓库无需登录；私有仓库使用你本机的 git 凭据。

## 应用与 UI 之间如何通信(开发者向)

应用的 HTML 界面可以通过 `postMessage` 触发已声明的 action,由 Pixie 代为运行 Agent 并回传结果。这是应用内"聊天框"或按钮背后调用的通道：

```js
const requestId = crypto.randomUUID();

window.parent.postMessage(
  {
    type: "pixie-application-run",
    requestId,
    actionId: "chat",          // manifest 中声明的 action id
    inputs: {
      chatMessage: "帮我总结这段数据",
    },
  },
  "*"
);

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type !== "pixie-application-run-result") return;
  if (msg.requestId !== requestId) return;
  if (msg.error) { /* 展示错误 */ }
  else { /* msg.record.outputs 即 manifest 声明的输出 */ }
});
```

约束：

- 只能调用 manifest 里声明的 `actionId`,且 inputs 必须匹配声明;
- 应用 UI 不直接访问 Pixie 其他能力,所有 Agent 调用都经 Pixie 外层转发。

## 管理已安装的应用

- **打开**：展开应用进入运行视图。
- **卸载**：列表中卸载会弹出确认;链接安装的源目录和应用数据不会被删除。
- **上次结果**：展开后直接查看最近一次运行的输出。

## 数据存放在哪里

所有数据都在本机(以 macOS 为例,位于 `~/Library/Application Support/com.pixie.Pixie/`):

| 内容 | 位置 |
| --- | --- |
| 已安装应用注册表 | `applications.json` |
| 复制安装的应用源码 | `applications/{appId}/` |
| 应用私有数据 | `application-data/{appId}/` |
| 运行记录 | `application_runs.json` |

## 常见问题排查

**App 预览提示应用尚未就绪**
最常见原因是 `entry` 指向的文件不存在或被改名。让 Agent 检查 `pixie.application.json` 的 `entry` 与 `agent` 字段是否指向真实文件。

**从 GitHub 安装失败**
确认仓库根目录包含 `pixie.application.json`;私有仓库先在本机执行 `git pull` 验证凭据可用;指定分支时确认分支名拼写。

**运行结果为"解析警告"**
Agent 的最终输出没有按输出契约返回合法 JSON,系统已把原始回复降级写入第一个可用输出。可以让 Agent 检查 `agent/instructions.md` 中的输出格式要求。

**表单里没有出现我想要的输入项**
输入表单完全由 manifest 的 `inputs` 生成。在 Studio 会话里告诉 Agent "增加一个 xxx 输入项"即可。

---

*本指南对应 Pixie 当前版本;发布应用到 GitHub、应用更新检测、权限确认等能力正在开发中,详见 PRD 路线图。*
