# 多语言文件结构 / i18n File Structure / 多言語ファイル構造

```
pixie/
├── src/
│   ├── i18n/                          # 国际化模块 🌐
│   │   ├── index.ts                   # i18n 配置
│   │   └── locales/                   # 翻译文件目录
│   │       ├── zh.json                # 🇨🇳 简体中文
│   │       ├── en.json                # 🇺🇸 英语
│   │       └── ja.json                # 🇯🇵 日语
│   │
│   ├── components/
│   │   ├─�� Settings.tsx               # ✅ 已添加语言选择器
│   │   ├── LanguageSelector.tsx      # 🆕 语言选择器组件
│   │   ├── App.tsx                    # ⏳ 待迁移
│   │   ├── Sidebar.tsx                # ⏳ 待迁移
│   │   ├── ChatView.tsx               # ⏳ 待迁移
│   │   ├── InputBar.tsx               # ⏳ 待迁移
│   │   └── ...                        # ⏳ 其他组件待迁移
│   │
│   ├── hooks/
│   │   ├── useTranslation.ts          # 🆕 翻译 Hook
│   │   └── ...                        # 其他 Hooks
│   │
│   ├── main.tsx                       # ✅ 已导入 i18n
│   └── ...
│
├── docs/                               # 文档目录 📚
│   ├── I18N_README.md                 # 多语言功能说明
│   ├── I18N_MIGRATION_GUIDE.md        # 组件迁移指南
│   └── I18N_SUMMARY.md                # 实现总结
│
├── package.json                       # ✅ 已添加 i18next 依赖
├── install-i18n.sh                     # 🆕 依赖安装脚本
└── ...
```

---

## 图例 / Legend / 凡例

| 符号 / Symbol | 説明 / Description / 説明 |
|--------------|-------------------------|------------------|
| 🌐 | 国际化模块 / i18n module / i18nモジュール |
| 🆕 | 新创建的文件 / New file / 新規ファイル |
| ✅ | 已完成修改 / Completed modification / 変更完了 |
| ⏳ | 待迁移 / Pending migration / 移行待ち |
| 📚 | 文档 / Documentation / ドキュメント |
| 🇨🇳 | 中文 / Chinese / 中国語 |
| 🇺🇸 | 英语 / English / 英語 |
| 🇯🇵 | 日语 / Japanese / 日本語 |

---

## 翻译键结构示例 / Translation Key Structure Example / 翻訳キー構造例

```
locales/
├── zh.json (简体中文)
│   ├─ app.name → "Pixie"
│   ├─ common.save → "保存"
│   ├─ settings.theme → "主题"
│   └─ ...
│
├── en.json (English)
│   ├─ app.name → "Pixie"
│   ├─ common.save → "Save"
│   ├─ settings.theme → "Theme"
│   └─ ...
│
└── ja.json (日本語)
    ├─ app.name → "Pixie"
    ├─ common.save → "保存"
    ├─ settings.theme → "テーマ"
    └─ ...
```

---

## 使用流程 / Usage Flow / 使用フロー

```
用户打开应用
    ↓
main.tsx 初始化 i18n
    ↓
读取 localStorage 中的语言偏好
    ↓
加载对应语言的翻译文件 (locales/*.json)
    ↓
应用渲染，显示 UI
    ↓
用户在设置中切换语言
    ↓
i18n.changeLanguage() 更新���言
    ↓
保存到 localStorage
    ↓
所有使用 t() 的组件自动更新
```

---

## 数据流 / Data Flow / データフロー

```
┌─────────────────────┐
│   LanguageSelector  │
│   (用户选择语言)      │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│   i18next instance  │
│   (改变语言)         │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│   localStorage      │
│   (保存偏好)         │
└─────────────────────┘
           ↑
           │
    下次启动时读取
           │
           ↓
┌─────────────────────┐
│   各组件 t() 函数    │
│   (获取翻译)         │
└─────────────────────┘
```

---

## 快速定位指南 / Quick Navigation Guide / クイックナビゲーション

### 我想...

I want to...

私は...

| 需求 / Need / ニーズ | 查看文件 / See File / ファイルを参照 |
|--------------------|-----------------------------------|--------------------------------|
| 了解多语言功能 | [I18N_README.md](../I18N_README.md) |
| 迁移组件到多语言 | [I18N_MIGRATION_GUIDE.md](../I18N_MIGRATION_GUIDE.md) |
| 查看实现总结 | [I18N_SUMMARY.md](../I18N_SUMMARY.md) |
| 添加新翻译键 | 编辑 `src/i18n/locales/*.json` |
| 使用翻译 Hook | 查看 `src/hooks/useTranslation.ts` |
| 添加语言选择器 | 参考 `src/components/LanguageSelector.tsx` |

---

## 依赖关系图 / Dependency Graph / 依存関係グラフ

```
┌─────────────────┐
│  main.tsx       │
│  (导入 i18n)     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐      ┌──────────────────┐
│  i18n/index.ts  │─────││  locales/*.json   │
│  (初始化配置)    │     │  (翻译数据)        │
└────────┬────────┘      └──────────────────┘
         │
         ↓
┌─────────────────┐
│ Settings.tsx    │◄────┐
│ (使用翻译)       │     │
└─────────────────┘     │
         │               │
         ↓               │
┌─────────────────┐     │
│ Language        │     │
│ Selector.tsx    │─────┘
│ (切换语言)       │
└─────────────────┘
         │
         ↓
┌─────────────────┐
│ useTranslation  │
│ Hook            │
└─────────────────┘
         │
         ↓
┌─────────────────┐
│ 其他组件 (待迁移)  │
└─────────────────┘
```

---

## 组件迁移状态 / Component Migration Status / コンポーネント移行ステータス

| 组件 / Component / コンポーネント | 状态 / Status / ステータス | 优先级 / Priority / 優先度 |
|--------------------------------|---------------------------|-------------------------|
| Settings.tsx | ✅ 已完成 | 高 |
| LanguageSelector.tsx | ✅ 已完成 | 高 |
| App.tsx | ⏳ 待迁移 | 高 |
| Sidebar.tsx | ⏳ 待迁移 | 高 |
| EngineSetup 相关 | ⏳ 待迁移 | 中 |
| InputBar.tsx | ⏳ 待迁移 | 中 |
| ChatView.tsx | ⏳ 待迁移 | 中 |
| ScheduledTasksPanel.tsx | ⏳ 待迁移 | 低 |
| LoopTasksPanel.tsx | ⏳ 待迁移 | 低 |
| MarketplacePanel.tsx | ⏳ 待迁移 | 低 |

---

**最后更新 / Last Updated / 最終更新：** 2024-01
