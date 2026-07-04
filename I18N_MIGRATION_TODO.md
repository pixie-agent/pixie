# 多语言迁移待办清单
# i18n Migration TODO List
# 多言語移行TODOリスト

**创建日期：** 2024-01-16
**当前状态：** ⚠️ 严重 - 大量硬编码文本需要迁移
**优先级：** 🔴 高

---

## 📊 问题概述

目前只有 **Settings 组件** 部分支持多语言，**App.tsx** 和其他组件包含大量硬编码的中文文本。

Current status: Only **Settings component** partially supports i18n. **App.tsx** and other components contain大量的硬编码中文文本。

現在の状況：**Settings コンポーネント**のみが部分的に i18n をサポートしています。**App.tsx** と他のコンポーネントには大量のハードコードされた中国語のテキストが含まれています。

---

## 🎯 迁移优先级

### P0 - 关键（必须立即迁移）

| 文件 | 硬编码文本数量 | 预计工时 | 状态 |
|------|---------------|---------|------|
| `src/App.tsx` | ~50+ 处 | 2-3小时 | ❌ 未开始 |
| `src/components/Sidebar.tsx` | ~20+ 处 | 1小时 | ❌ 未开始 |
| `src/components/InputBar.tsx` | ~10+ 处 | 30分钟 | ❌ 未开始 |

### P1 - 高优先级

| 文件 | 硬编码文本数量 | 预计工时 | 状态 |
|------|---------------|---------|------|
| `src/components/ChatView.tsx` | ~15+ 处 | 1小时 | ❌ 未开始 |
| `src/components/EngineSetup.tsx` | ~30+ 处 | 1.5小时 | ❌ 未开始（在 App.tsx 中） |
| `src/components/NewAgentModal.tsx` | ~10+ 处 | 30分钟 | ❌ 未开始 |

### P2 - 中优先级

| 文件 | 硬编码文本数量 | 预计工时 | 状态 |
|------|---------------|---------|------|
| `src/components/ScheduledTasksPanel.tsx` | ~20+ 处 | 1小时 | ❌ 未开始 |
| `src/components/LoopTasksPanel.tsx` | ~20+ 处 | 1小时 | ❌ 未开始 |
| `src/components/MarketplacePanel.tsx` | ~15+ 处 | 1小时 | ❌ 未开始 |
| `src/components/SearchPalette.tsx` | ~10+ 处 | 30分钟 | ❌ 未开始 |

### P3 - 低优先级

| 文件 | 硬编码文本数量 | 预计工时 | 状态 |
|------|---------------|---------|------|
| `src/components/Terminal.tsx` | ~5 处 | 15分钟 | ❌ 未开始 |
| `src/components/SkillsDropdown.tsx` | ~5 处 | 15分钟 | ❌ 未开始 |
| `src/components/RightPanel.tsx` | ~10 处 | 30分钟 | ❌ 未开始 |

---

## 🔴 App.tsx 中的硬编码文本清单

### SplashScreen (启动屏幕)

| 行号 | 硬编码文本 | 翻译键 | 状态 |
|------|-----------|--------|------|
| 60 | `BETA` | `app.beta` | ❌ 未迁移 |
| 65 | `Initializing...` | `splash.initializing` | ❌ 未迁移 |

### ENGINE_SETUP_INFO (引擎配置信息)

| 行号 | 硬编码文本 | 翻译键 | 状态 |
|------|-----------|--------|------|
| 80 | `浏览器完成 Anthropic 登录后回来点「重新检测」` | `engineSetup.claude.loginHint` | ❌ 未迁移 |
| 82 | `https://docs.claude.com/en/docs/claude-code` | (保持不变) | - |
| 85 | `会打开浏览器完成 Cursor 登录` | `engineSetup.cursor.loginHint` | ❌ 未迁移 |
| 90 | `选择登录方式，浏览器完成认证` | `engineSetup.codebuddy.loginHint` | ❌ 未迁移 |
| 93 | `在设置页面配置 ANTHROPIC_API_KEY 即可使用` | `engineSetup.builtin.loginHint` | ❌ 未迁移 |
| 97 | `（内置引擎，无需安装）` | `engineSetup.builtin.install` | ❌ 未迁移 |
| 125-135 | 各种状态文本 | `engineSetup.status.*` | ❌ 未迁移 |
| 139 | `安装中...` | `engineSetup.actions.installing` | ❌ 未迁移 |
| 145 | `安装失败，请用下方命令手动安装` | `engineSetup.messages.installFailed` | ❌ 未迁移 |
| 189 | `内置` / `就绪` / `检测中…` / `未就绪` | `engineSetup.status.*` | ❌ 未迁移 |
| 193 | `未安装` | `engineSetup.status.notInstalled` | ❌ 未迁移 |
| 210 | `重新检测` | `engineSetup.actions.reprobe` | ❌ 未迁移 |
| 246 | `正在发送 ping 检测就绪状态…` | `engineSetup.messages.probing` | ❌ 未迁移 |
| 250 | `已就绪，可以使用。` | `engineSetup.messages.readyMessage` | ❌ 未迁移 |
| 254 | `未就绪。点「一键登录」在浏览器登录，完成后点「重新检测」。` | `engineSetup.messages.notReadyHint` | ❌ 未迁移 |
| 260 | `一键登录` | `engineSetup.actions.oneClickLogin` | ❌ 未迁移 |
| 266 | `重新检测` | `engineSetup.actions.reprobe` | ❌ 未迁移 |
| 287 | `重新检测` | `engineSetup.actions.reprobe` | ❌ 未迁移 |
| 330 | `Pixie 不自带模型...` | `engineSetup.description` | ❌ 未迁移 |
| 350 | `已有引擎就绪` / `还没有就绪的引擎` | `engineSetup.anyReady` / `engineSetup.noneReady` | ❌ 未迁移 |

### EngineSetup 组件

| 行号 | 硬编码文本 | 翻译键 | 状态 |
|------|-----------|--------|------|
| 315 | `配置 Agent 引擎` | `engineSetup.title` | ❌ 未迁移 |
| 320 | `关闭` | `common.close` | ❌ 未迁移 |
| 330 | Pixie 不自带模型... | `engineSetup.description` | ❌ 未迁移 |
| 333 | 提示：检测会向引擎... | `engineSetup.hint` | ❌ 未迁移 |
| 350 | `进入应用` | `engineSetup.enterApp` | ❌ 未迁移 |
| 351 | `已有引擎就绪` / `还没有就绪的引擎` | `engineSetup.anyReady` / `engineSetup.noneReady` | ❌ 未迁移 |

### AppShell 组件

| 行号 | 硬编码文本 | 翻译键 | 状态 |
|------|-----------|--------|------|
| 871 | `BETA` | `app.beta` | ❌ 未迁移 |
| 多处 | 各种状态文本 | 各种键 | ❌ 未迁移 |

---

## 📝 需要添加到翻译文件的键

基于上述清单，需要在 `src/i18n/locales/*.json` 中添加以下键（部分已存在，但未使用）：

```json
{
  "app": {
    "name": "Pixie",
    "beta": "BETA"
  },
  "splash": {
    "initializing": "Initializing..."
  },
  "engineSetup": {
    "title": "Configure Agent Engine",
    "description": "Pixie doesn't include its own models...",
    "hint": "Note: Detection sends a ping message...",
    "close": "Close",
    "enterApp": "Enter App",
    "anyReady": "Has ready engine",
    "noneReady": "No ready engines yet",
    "claude": {
      "install": "npm install -g @anthropic-ai/claude-code",
      "login": "claude auth login",
      "loginHint": "Complete Anthropic login in browser then click 'Re-detect'"
    },
    "cursor": {
      "install": "curl https://cursor.com/install -fsS | bash",
      "login": "cursor-agent login",
      "loginHint": "Will open browser to complete Cursor login"
    },
    "codebuddy": {
      "install": "npm install -g @tencent-ai/codebuddy-code",
      "login": "cbc login",
      "loginHint": "Select login method, complete authentication in browser"
    },
    "builtin": {
      "install": "(Built-in engine, no installation needed)",
      "login": "",
      "loginHint": "Configure ANTHROPIC_API_KEY in Settings to use"
    }
  }
}
```

---

## 🛠️ 迁移步骤

### 步骤 1: 更新翻译文件

1. 在 `src/i18n/locales/zh.json`、`en.json`、`ja.json` 中添加所有缺失的键
2. 确保所有三种语言的翻译完整

### 步骤 2: 迁移 App.tsx

1. 导入 `useTranslation` hook
2. 替换所有硬编码文本为 `t()` 调用
3. 测试三种语言显示

### 步骤 3: 迁移其他组件

按优先级顺序迁移其他组件

---

## ✅ 完成标准

- [ ] 所有 P0 组件完成迁移
- [ ] 所有 P1 组件完成迁移
- [ ] 所有 P2 组件完成迁移
- [ ] 三种语言测试通过
- [ ] 无遗漏的硬编码文本

---

## 📞 注意事项

1. **不要破坏现有功能** - 迁移时确保不影响现有逻辑
2. **保持翻译一致性** - 使用相同的翻译键
3. **测试所有语言** - 每迁移一个组件后测试三种语言
4. **检查占位符和提示文本** - 这些容易被忽略

---

**预计总工时：** 10-15 小时
**建议完成时间：** 1-2 天

---

## 🔗 相关文档

- [I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md) - 详细迁移指南
- [I18N_QUICK_REFERENCE.md](./I18N_QUICK_REFERENCE.md) - 快速参考
- [PROJECT_I18N_INDEX.md](./PROJECT_I18N_INDEX.md) - 项目总览
