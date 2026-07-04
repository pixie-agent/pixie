# 🌐 Pixie 多语言项目总览 / i18n Project Overview
# 多言語プロジェクト概要

---

## 📖 文档导航 / Documentation Navigation / ドキュメントナビゲーション

### 🚀 快速开始 / Quick Start / クイックスタート

| 文档 | 描述 | 适合人群 |
|------|------|----------|
| [I18N_QUICKSTART.md](./I18N_QUICKSTART.md) | 5分钟快速启动指南 | 所有人 |

### 📚 核心文档 / Core Docs / コアドキュメント

| 文档 | 描述 | 适合人群 |
|------|------|----------|
| [I18N_README.md](./I18N_README.md) | 多语言功能概述和使用说明 | 所有人 |
| [I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md) | 组件迁移详细指南 | 开发者 |
| [I18N_QUICK_REFERENCE.md](./I18N_QUICK_REFERENCE.md) | 快速参考卡片 | 开发者 |

### 📊 总结文档 / Summary Docs / サマリードキュメント

| 文档 | 描述 | 适合人群 |
|------|------|----------|
| [I18N_SUMMARY.md](./I18N_SUMMARY.md) | 实现总结和概述 | 管理者、开发者 |
| [I18N_STRUCTURE.md](./I18N_STRUCTURE.md) | 文件结构和关系图 | 开发者 |
| [I18N_FILE_MANIFEST.md](./I18N_FILE_MANIFEST.md) | 完整文件清单 | 开发者、维护者 |
| [I18N_COMPLETE.md](./I18N_COMPLETE.md) | 完成报告和导航 | 所有人 |

---

## 🎯 按需求查找文档 / Find Docs by Need / 必要に応じたドキュメント検索

### 我想要...

#### 快速开始使用
👉 [I18N_QUICKSTART.md](./I18N_QUICKSTART.md)

#### 了解多语言功能
👉 [I18N_README.md](./I18N_README.md)

#### 迁移组件到多语言
👉 [I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md)

#### 查看代码示例
👉 [I18N_QUICK_REFERENCE.md](./I18N_QUICK_REFERENCE.md)

#### 了解项目结构
👉 [I18N_STRUCTURE.md](./I18N_STRUCTURE.md)

#### 查看所有文件
👉 [I18N_FILE_MANIFEST.md](./I18N_FILE_MANIFEST.md)

#### 查看实现总结
👉 [I18N_SUMMARY.md](./I18N_SUMMARY.md) 或 [I18N_COMPLETE.md](./I18N_COMPLETE.md)

---

## 📂 项目结构 / Project Structure / プロジェクト構造

```
pixie/
├── src/
│   ├── i18n/                    # 多语言核心
│   │   ├── index.ts             # 配置
│   │   ├── test.ts              # 测试
│   │   └── locales/             # 翻译文件
│   │       ├── zh.json          # 🇨🇳 中文
│   │       ├── en.json          # 🇺🇸 English
│   │       └── ja.json          # 🇯🇵 日本語
│   ├── components/
│   │   └── LanguageSelector.tsx # 语言选择器
│   ├── hooks/
│   │   └── useTranslation.ts    # 翻译 Hook
│   └── main.tsx                 # 入口（已修改）
│
├── docs/                        # 本目录
���   ├── PROJECT_I18N_INDEX.md    # 本文件
│   ├── I18N_QUICKSTART.md
│   ├── I18N_README.md
│   ├── I18N_MIGRATION_GUIDE.md
│   ├── I18N_QUICK_REFERENCE.md
│   ├── I18N_SUMMARY.md
│   ├── I18N_STRUCTURE.md
│   ├── I18N_FILE_MANIFEST.md
│   └── I18N_COMPLETE.md
│
├── package.json                 # 已添加依赖
└── install-i18n.sh              # 安装脚本
```

---

## 🔑 关键信息 / Key Info / キー情報

### 支持的语言 / Supported Languages / サポート言語

- 🇨🇳 **简体中文** (Simplified Chinese) - 默认
- 🇺🇸 **English**
- 🇯🇵 **日本語** (Japanese)

### 技术栈 / Tech Stack / 技術スタック

```json
{
  "i18next": "^24.2.0",
  "react-i18next": "^15.4.0", 
  "i18next-browser-languagedetector": "^8.0.2"
}
```

### 翻译覆盖 / Translation Coverage / 翻訳カバレッジ

- **翻译键数量：** 135+
- **已迁移组件：** Settings, LanguageSelector
- **待迁移组件：** App, Sidebar, ChatView, InputBar 等

---

## 🚀 快速命令 / Quick Commands / クイックコマンド

```bash
# 安装 / Install / インストール
pnpm install

# 运行 / Run / 実行
pnpm dev

# 构建 / Build / ビルド
pnpm build

# 检查翻译文件格式 / Check translation files / 翻訳ファイル形式を確認
cat src/i18n/locales/*.json | jq .
```

---

## 📊 组件迁移状态 / Component Migration Status / コンポーネント移行状態

| 组件 | 状态 | 优先级 |
|------|------|--------|
| Settings.tsx | ✅ 已完成 | 高 |
| LanguageSelector.tsx | ✅ 已完成 | 高 |
| App.tsx | ⏳ 待迁移 | 高 |
| Sidebar.tsx | ⏳ 待迁移 | 高 |
| EngineSetup | ⏳ 待迁移 | 中 |
| InputBar.tsx | ⏳ 待迁移 | 中 |
| ChatView.tsx | ⏳ 待迁移 | 中 |
| ScheduledTasksPanel.tsx | ⏳ 待迁移 | 低 |
| LoopTasksPanel.tsx | ⏳ 待迁移 | 低 |
| MarketplacePanel.tsx | ⏳ 待迁移 | 低 |

---

## 💡 常用代码片段 / Common Code Snippets / よく使うコードスニペット

### 基础使用 / Basic Usage / 基本的な使用

```tsx
import { useTranslation } from '../hooks/useTranslation';

function Component() {
  const { t } = useTranslation();
  return <button>{t('common.save')}</button>;
}
```

### 切换语言 / Change Language / 言語切り替え

```tsx
const { i18n } = useTranslation();
i18n.changeLanguage('en');
```

### 带参数的翻译 / With Parameters / パラメータ付き

```tsx
t('settings.appliesOnly', { name: 'Claude' })
```

---

## 🎓 学习路径 / Learning Path / 学習パス

### 初学者 / Beginner / 初心者

1. [I18N_QUICKSTART.md](./I18N_QUICKSTART.md) - 快速开始
2. [I18N_README.md](./I18N_README.md) - 了解功能
3. [I18N_QUICK_REFERENCE.md](./I18N_QUICK_REFERENCE.md) - 查看示例

### 开发者 / Developer / 開発者

1. [I18N_README.md](./I18N_README.md) - 了解功能
2. [I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md) - 学习迁移
3. [I18N_STRUCTURE.md](./I18N_STRUCTURE.md) - 理解结构
4. [I18N_FILE_MANIFEST.md](./I18N_FILE_MANIFEST.md) - 查看文件

### 管理者 / Manager / マネージャー

1. [I18N_SUMMARY.md](./I18N_SUMMARY.md) - 查看总结
2. [I18N_COMPLETE.md](./I18N_COMPLETE.md) - 了解全貌
3. [I18N_FILE_MANIFEST.md](./I18N_FILE_MANIFEST.md) - 查看清单

---

## 🆘 获取帮助 / Get Help / ヘルプを取得

### 文档 / Documentation / ドキュメント

- 查看 [I18N_README.md](./I18N_README.md) 的 FAQ 部分
- 参考 [I18N_QUICK_REFERENCE.md](./I18N_QUICK_REFERENCE.md) 的常见问题

### 社区 / Community / コミュニティ

- 提交 Issue: https://github.com/white1or1black/pixie/issues
- 查看 i18next 官方文档: https://www.i18next.com/

---

## 📈 项目状态 / Project Status / プロジェクト状態

| 指标 | 状态 |
|------|------|
| 基础架构 | ✅ 完成 |
| 翻译文件 | ✅ 完成 |
| 核心组件 | ✅ 完成 |
| 文档 | ✅ 完成 |
| 组件迁移 | 🔄 进行中 |
| 质量检查 | ⏳ 待完成 |

---

**最后更新 / Last Updated / 最終更新：** 2024-01  
**文档版本 / Doc Version / ドキュメントバージョン：** 1.0.0

---

<div align="center">

### 🌍 🌐 🌏

**欢迎使用 Pixie 多语言版本！**

**Welcome to Pixie multilingual version!**

**Pixie 多言語バージョンへようこそ！**

</div>
