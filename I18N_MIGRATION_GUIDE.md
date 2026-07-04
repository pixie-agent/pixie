# 多语言迁移指南 / i18n Migration Guide / 多言語移行ガイド

本文档说明如何将现有组件迁移到使用多语言翻译。

This document explains how to migrate existing components to use translations.

このドキュメントでは、既存のコンポーネントを翻訳を使用するように移行する方法を説明します。

---

## 快速开始 / Quick Start / クイックスタート

### 1. 导入 Hook / Import Hook / フックをインポート

```tsx
import { useTranslation } from '../hooks/useTranslation';
```

### 2. 在组件中使用 / Use in Component / コンポーネントで使用

```tsx
function MyComponent() {
  const { t } = useTranslation();

  return (
    <button>{t('common.save')}</button>  // "保存" / "Save" / "保存"
}
```

---

## 完整示例 / Complete Example / 完全な例

### 迁移前 / Before / 移行前

```tsx
function Settings() {
  return (
    <div>
      <h2>Settings</h2>
      <button>Save</button>
      <button>Cancel</button>
    </div>
  );
}
```

### 迁移后 / After / 移行後

```tsx
import { useTranslation } from '../hooks/useTranslation';

function Settings() {
  const { t } = useTranslation();

  return (
    <div>
      <h2>{t('settings.title')}</h2>
      <button>{t('common.save')}</button>
      <button>{t('common.cancel')}</button>
    </div>
  );
}
```

---

## 常用翻译键 / Common Translation Keys / 一般的な翻訳キー

```tsx
// 通用 / Common / 一般
t('app.name')              // "Pixie"
t('common.save')           // "保存" / "Save" / "保存"
t('common.cancel')         // "取消" / "Cancel" / "キャンセル"
t('common.delete')         // "删除" / "Delete" / "削除"
t('common.edit')           // "编辑" / "Edit" / "編集"
t('common.close')          // "关闭" / "Close" / "閉じる"
t('common.settings')       // "设置" / "Settings" / "設定"
t('common.refresh')        // "刷新" / "Refresh" / "更新"

// 引擎设置 / Engine Setup / エンジン設定
t('engineSetup.title')                     // "配置 Agent 引擎"
t('engineSetup.status.ready')              // "就绪" / "Ready" / "準備完了"
t('engineSetup.actions.oneClickInstall')   // "一键安装"

// 设置 / Settings / 設定
t('settings.theme')            // "主题" / "Theme" / "テーマ"
t('settings.dark')             // "深色" / "Dark" / "ダーク"
t('settings.light')            // "浅色" / "Light" / "ライト"
t('settings.about')            // "关于" / "About" / "について"
```

---

## 带参数的翻译 / Translations with Parameters / パラメータ付き翻訳

### 定义翻译键 / Define Translation Key / 翻訳キーの定義

```json
{
  "settings": {
    "appliesOnly": "仅适用于 {{name}} 会话。",
    "overrides": "个覆盖"
  }
}
```

### 在组件中使用 / Use in Component / コンポーネントで使用

```tsx
// 基本参数
t('settings.appliesOnly', { name: 'Claude' })
// "仅适用于 Claude 会话。" / "Applies only to Claude sessions." / "Claude セッションにのみ適用されます。"

// 复数形式（需要配置 i18next）
t('settings.overrides', { count: 2 })
// "2个覆盖" / "2 overrides" / "2つのオーバーライド"
```

---

## 组件迁移检查清单 / Migration Checklist / 移行チェックリスト

迁移一个组件时，请确保：

When migrating a component, make sure to:

コンポーネントを移行する際は、以下を確認してください：

- [ ] 导入 `useTranslation` hook
- [ ] 替换所有硬编码文本为 `t()` 调用
- [ ] 检查所有三个语言文件中是否有对应的翻译
- [ ] 测试组件在不同语言下的显示效果
- [ ] 处理动态内容（使用参数或条件渲染）
- [ ] 检查长文本在不同语言下的布局

---

## 处理动态内容 / Handling Dynamic Content / 動的コンテンツの処理

### 条件翻译 / Conditional Translation / 条件付き翻訳

```tsx
function StatusBadge({ status }: { status: 'ready' | 'pending' }) {
  const { t } = useTranslation();

  return (
    <span>
      {status === 'ready'
        ? t('engineSetup.status.ready')
        : t('engineSetup.status.probing')
      }
    </span>
  );
}
```

### 带变量的翻译 / Translation with Variables / 変数付き翻訳

```tsx
function Welcome({ userName }: { userName: string }) {
  const { t } = useTranslation();

  return (
    <div>
      {t('welcome.message', { name: userName })}
    </div>
  );
}
```

---

## 逐步迁移现有组件 / Step-by-step Migration / 既存コンポーネントの段階的移行

### 优先级 / Priority / 優先順位

建议按以下顺序迁移组件：

Recommended migration order for components:

コンポーネントの移行は以下の順序で行うことを推奨します：

1. **高优先级 / High Priority / 高優先度**
   - App.tsx - 应用标题、启动屏幕
   - Settings.tsx - 设置页面（已部分完成）
   - Sidebar.tsx - 侧边栏导航

2. **中优先级 / Medium Priority / 中優先度**
   - EngineSetup 相关组件
   - InputBar.tsx - 输入框
   - ChatView.tsx - 聊天视图

3. **低优先级 / Low Priority / 低優先度**
   - 各种面板组件
   - 工具类组件

### 每个组件的迁移步骤 / Migration Steps per Component / コンポーネントごとの移行ステップ

1. 打开组件文件
2. 在顶部添加 `import { useTranslation } from '../hooks/useTranslation'`
3. 在组件内部添加 `const { t } = useTranslation()`
4. 找到所有硬编码的文本字符串
5. 在翻译文件中查找或添加对应的键
6. 替换硬编码文本为 `t('key.path')`
7. 测试三种语言下的显示

---

## 常见问题 / Common Issues / よくある問題

### Q: 翻译没有生效？

**A:** 确保：
1. 已安装依赖：`pnpm install`
2. 语言文件格式正确（有效的 JSON）
3. 键的路径正确
4. 浏览器缓存已清除

### Q: 如何添加新的翻译键？

**A:** 在所有三个语言文件中添加相同的键结构：

```json
// zh.json, en.json, ja.json
{
  "newSection": {
    "newKey": "翻译文本"
  }
}
```

### Q: 翻译文本太长导致布局问题？

**A:** 使用 CSS 处理：
- `overflow: hidden`
- `text-overflow: ellipsis`
- `white-space: nowrap`
- 或使用响应式布局

---

## 下一步 / Next Steps / 次のステップ

1. 开始迁移优先级高的组件
2. 定期审查翻译的准确性
3. 收集用户反馈改进翻译
4. 考虑添加更多语言

Start migrating high-priority components and improve translations based on user feedback!

優先度の高いコンポーネントの移行を開始し、ユーザーフィードバックに基づいて翻訳を改善してください！

---

## 相关资源 / Related Resources / 関連リソース

- [i18next 官方文档](https://www.i18next.com/)
- [react-i18next 文档](https://react.i18next.com/)
- [I18N_README.md](./I18N_README.md) - 多语言功能概述
