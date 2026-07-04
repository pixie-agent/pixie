# 多语言快速修复指南
# i18n Quick Fix Guide
# 多言語クイックフィックスガイド

## 🎯 目标

在 30 分钟内完成最关键的多语言迁移。

Complete the most critical i18n migrations in 30 minutes.

30分以内に最も重要なi18n移行を完了します。

---

## 📋 第一步：补充翻译键（5分钟）

### 编辑 `src/i18n/locales/zh.json`

确保包含以下所有键（已存在但可能未使用）：

```json
{
  "app": {
    "name": "Pixie",
    "beta": "BETA"
  },
  "splash": {
    "initializing": "初始化中..."
  },
  "sidebar": {
    "newChat": "新建对话",
    "workspaces": "工作区",
    "addWorkspace": "添加工作区",
    "settings": "设置",
    "tasks": "计划任务",
    "loops": "循环任务",
    "skills": "技能市场",
    "noWorkspaces": "暂无工作区"
  },
  "chat": {
    "newMessage": "输入消息...",
    "send": "发送",
    "stop": "停止生成",
    "addWorkspaceHint": "添加工作区以发送消息",
    "toggleKb": "启用知识库搜索",
    "kbEnabled": "知识库搜索已启用"
  },
  "engineSetup": {
    "title": "配置 Agent 引擎",
    "description": "Pixie 不自带模型，安装并登录一个引擎即可。检测就绪 = 能成功 ping 通该模型。",
    "hint": "提示：检测会向引擎发送一条 ping 消息，可能产生极少量调用费用。",
    "close": "关闭",
    "enterApp": "进入应用",
    "anyReady": "已有引擎就绪",
    "noneReady": "还没有就绪的引擎",
    "status": {
      "builtin": "内置",
      "ready": "就绪",
      "probing": "检测中…",
      "notInstalled": "未安装",
      "notReady": "未就绪"
    },
    "actions": {
      "oneClickInstall": "一键安装",
      "installing": "安装中…",
      "oneClickLogin": "一键登录",
      "reprobe": "重新检测",
      "manualInstall": "手动安装（复制命令到终端运行）",
      "copyLoginCommand": "复制登录命令"
    },
    "messages": {
      "builtinConfigHint": "请在设置页面 → 引擎配置 → Builtin 中配置 ANTHROPIC_API_KEY。",
      "builtinDesc": "内置引擎直接调用 Anthropic Messages API，无需安装 CLI，只需配置 API Key。",
      "notReadyHint": "未就绪。点「一键登录」在浏览器登录，完成后点「重新检测」。",
      "readyMessage": "已就绪，可以使用。",
      "installFailed": "安装失败，请用下方命令手动安装",
      "engineResponse": "引擎返回：",
      "probing": "正在发送 ping 检测就绪状态…"
    },
    "commands": {
      "copy": "复制",
      "copyToClipboard": "复制到剪贴板"
    },
    "claude": {
      "loginHint": "浏览器完成 Anthropic 登录后回来点「重新检测」"
    },
    "cursor": {
      "loginHint": "会打开浏览器完成 Cursor 登录"
    },
    "codebuddy": {
      "loginHint": "选择登录方式，浏览器完成认证"
    },
    "builtin": {
      "install": "（内置引擎，无需安装）",
      "loginHint": "在设置页面配置 ANTHROPIC_API_KEY 即可使用"
    }
  }
}
```

对 `en.json` 和 `ja.json` 也做同样的补充。

---

## 🔧 第二步：迁移 App.tsx（20分钟）

### 2.1 添加导入（第1行附近）

```typescript
import { useTranslation } from "./hooks/useTranslation";
```

### 2.2 修改 SplashScreen 组件

找到 SplashScreen 函数（约第56行），修改为：

```typescript
function SplashScreen() {
  const { t } = useTranslation();
  
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)]">
      <img
        src={iconUrl}
        alt="Pixie"
        className="w-16 h-16 rounded-2xl mb-6"
      />
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">{t('app.name')}</h1>
        <span className="px-2 py-1 text-xs font-semibold bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded">
          {t('app.beta')}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-[var(--text-secondary)]">{t('splash.initializing')}</span>
      </div>
    </div>
  );
}
```

### 2.3 修改 ENGINE_SETUP_INFO

找到 ENGINE_SETUP_INFO 常量（约第67行），修改 loginHint：

```typescript
const ENGINE_SETUP_INFO: Record<
  AgentEngineId,
  { install: string; login: string; loginHint?: string; docs: string }
> = {
  claude: {
    install: "npm install -g @anthropic-ai/claude-code",
    login: "claude auth login",
    loginHint: "browser-complete-anthropic-login-then-click-re-detect", // 临时占位
    docs: "https://docs.claude.com/en/docs/claude-code",
  },
  cursor: {
    install: "curl https://cursor.com/install -fsS | bash",
    login: "cursor-agent login",
    loginHint: "will-open-browser-to-complete-cursor-login", // 临时占位
    docs: "https://cursor.com/cli",
  },
  codebuddy: {
    install: "npm install -g @tencent-ai/codebuddy-code",
    login: "cbc login",
    loginHint: "select-login-method-complete-authentication-in-browser", // 临时占位
    docs: "https://www.codebuddy.ai/docs/cli/quickstart",
  },
  builtin: {
    install: "（内置引擎，无需安装）",
    login: "",
    loginHint: "configure-anthropic-api-key-in-settings-to-use", // 临时占位
    docs: "https://docs.anthropic.com/en/api",
  },
  codex: {
    install: "npm install -g @openai/codex",
    login: "codex login",
    loginHint: "will-open-browser-to-complete-openai-login", // 临时占位
    docs: "https://platform.openai.com/docs/cli",
  },
};
```

**注意：** ENGINE_SETUP_INFO 会在多个地方使用，我们需要在使用时动态获取翻译：

### 2.4 修改 EngineCard 组件

找到 EngineCard 函数（约第158行），在函数开始添加：

```typescript
function EngineCard({
  engineId,
  label,
  status,
  onProbe,
  onLogin,
  onInstall,
}: {
  engineId: AgentEngineId;
  label: string;
  status: EngineStatus | undefined;
  onProbe: (id: AgentEngineId) => void;
  onLogin: (id: AgentEngineId) => void;
  onInstall: (id: AgentEngineId) => Promise<{ success: boolean; output: string }>;
}) {
  const { t } = useTranslation();  // 添加这行
  const isBuiltin = engineId === "builtin";
  const info = ENGINE_SETUP_INFO[engineId];
```

然后替换所有硬编码文本（示例）：

```typescript
// 替换状态文本
{isBuiltin ? t('engineSetup.status.builtin') : ready ? t('engineSetup.status.ready') : probing ? t('engineSetup.status.probing') : t('engineSetup.status.notReady')}

// 替换按钮文本
{t('engineSetup.actions.oneClickInstall')}

// 替换提示文本
{installError && <p className="text-xs text-red-400 break-all whitespace-pre-wrap">{installError}</p>}
```

### 2.5 修改 EngineSetup 组件

找到 EngineSetup 函数（约第305行），添加 useTranslation：

```typescript
function EngineSetup({
  statuses,
  onProbe,
  onLogin,
  onInstall,
  onClose,
}: {
  statuses: EngineStatus[];
  onProbe: (id: AgentEngineId) => void;
  onLogin: (id: AgentEngineId) => void;
  onInstall: (id: AgentEngineId) => Promise<{ success: boolean; output: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();  // 添加这行
  const anyReady = statuses.some((s) => s.available && s.auth_state === "ready");
```

替换硬编码文本：

```typescript
<h2 className="text-base font-semibold text-[var(--text-primary)]">{t('engineSetup.title')}</h2>
{t('engineSetup.description')}
{t('engineSetup.hint')}
{t('engineSetup.enterApp')}
```

---

## ⚠️ 临时方案说明

由于 ENGINE_SETUP_INFO 是一个常量，不能直接使用 `t()` 函数。我们有三个选择：

### 方案 A：使用翻译键作为占位符（快速）

```typescript
const ENGINE_SETUP_INFO: Record<...> = {
  claude: {
    install: "npm install -g @anthropic-ai/claude-code",
    login: "claude auth login",
    loginHint: "engineSetup.claude.loginHint", // 翻译键
    // ...
  },
};

// 使用时
const info = ENGINE_SETUP_INFO[engineId];
const hintText = info.loginHint.startsWith('engineSetup.') ? t(info.loginHint) : info.loginHint;
```

### 方案 B：改为函数（推荐）

```typescript
function getEngineSetupInfo(engineId: AgentEngineId, t: TFunction) {
  const map = {
    claude: {
      install: "npm install -g @anthropic-ai/claude-code",
      login: "claude auth login",
      loginHint: t('engineSetup.claude.loginHint'),
      // ...
    },
  };
  return map[engineId];
}
```

### 方案 C：保持常量，使用时翻译（最简单）

保持 ENGINE_SETUP_INFO 不变，只翻译显示的文本。

---

## 📝 总结

1. ✅ 确保翻译文件完整（5分钟）
2. ✅ 迁移 SplashScreen（2分钟）
3. ✅ 迁移 EngineCard（8分钟）
4. ✅ 迁移 EngineSetup（5分钟）

**总计：20分钟**

---

## 🧪 测试

完成上述修改后：

```bash
pnpm dev
```

然后：
1. 观察启动屏幕（应显示 "初始化中..." 或 "Initializing..."）
2. 打开引擎设置弹窗
3. 切换语言，验证所有文本变化

---

**下一步：** 参考 [I18N_MIGRATION_TODO.md](./I18N_MIGRATION_TODO.md) 继续迁移其他组件。
