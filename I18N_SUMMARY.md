# 多语言实现总结 / i18n Implementation Summary / 多言語実装のまとめ

## 概述 / Overview / 概要

已为 Pixie 项目添加了多语言支持，支持简体中文、英语和日语。

Added multi-language support to Pixie project, supporting Simplified Chinese, English, and Japanese.

Pixie プロジェクトに多言語サポートを追加し、簡体字中国語、英語、日本語をサポートしました。

---

## 支持的语言 / Supported Languages / サポート言語

- 🇨🇳 **简体中文** (zh) - 默认语言
- 🇺🇸 **英语** (en)
- 🇯🇵 **日语** (ja)

---

## 文件变更 / File Changes / ファイル変更

### 新创建的文件 / New Files / 新規作成ファイル

```
src/i18n/
├── index.ts                    # i18n 配置和初始化
└── locales/
    ├── zh.json                # 简体中文翻译
    ├── en.json                # 英语翻译
    └── ja.json                # 日语翻译

src/components/
└── LanguageSelector.tsx       # 语言选择器组件

src/hooks/
└── useTranslation.ts          # 翻译 Hook

I18N_README.md                 # 多语言功能说明
I18N_MIGRATION_GUIDE.md        # 组件迁移指南
install-i18n.sh               # 依赖安装脚本
```

### 修改的文件 / Modified Files / 変更ファイル

```
package.json                   # 添加 i18next 依赖
src/main.tsx                   # 导入 i18n 初始化
src/components/Settings.tsx   # 添加语言选择器和翻译
```

---

## 安装的依赖 / Installed Dependencies / インストールされた依存関係

```json
{
  "i18next": "^24.2.0",
  "react-i18next": "^15.4.0",
  "i18next-browser-languagedetector": "^8.0.2"
}
```

---

## 如何使用 / How to Use / 使い方

### 1. 安装依赖 / Install Dependencies / 依存関係をインストール

```bash
# 使用 pnpm（推荐）
pnpm install

# 或使用 npm
npm install

# 或使用 yarn
yarn install
```

或运行脚本：

Or run the script:

またはスクリプトを実行：

```bash
./install-i18n.sh
```

### 2. 运行项目 / Run Project / プロジェクトを実行

```bash
pnpm dev
```

### 3. 切换语言 / Switch Language / 言語を切り替える

1. 打开应用
2. 点击左侧边栏的设置图标
3. 找到"语言"（Language）部分
4. 选择想要的语言

---

## 代码示例 / Code Examples / コード例

### 在组件中使用翻译 / Using Translations in Components / コ��ポーネントで翻訳を使用

```tsx
import { useTranslation } from '../hooks/useTranslation';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.settings')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 使用语言选择器 / Using Language Selector / 言語セレクターを使用

```tsx
import LanguageSelector from '../components/LanguageSelector';

function Settings() {
  return (
    <div>
      <LanguageSelector className="w-full" />
    </div>
  );
}
```

---

## 翻译覆盖率 / Translation Coverage / 翻訳カバレッジ

当前已翻译的主要区域：

Currently translated main areas:

現在翻訳された主な領域：

- ✅ App 基础界面（标题、BETA 标签等）
- ✅ 引擎设置界面
- ✅ 设置页面（主题、语言选择等）
- ✅ 侧边栏导航
- ✅ 通用按钮和操作

**待迁移组件 / Pending Components / 移行待ちコンポーネント：**

- ⏳ ChatView.tsx
- ⏳ InputBar.tsx
- ⏳ ScheduledTasksPanel.tsx
- ⏳ LoopTasksPanel.tsx
- ⏳ MarketplacePanel.tsx
- ⏳ 其他面板组件

---

## 下一步行动 / Next Steps / 次のステップ

### 开发者 / Developer / 開発者

1. 安装依赖：`pnpm install`
2. 测试当前实现
3. 按照 `I18N_MIGRATION_GUIDE.md` 迁移其他组件
4. 完善翻译文本

### 贡献者 / Contributors / 貢献者

1. 审查翻译质量
2. 添加更多语言支持
3. 改进翻译准确性
4. 提交 Pull Request

---

## 相关文档 / Related Documentation / 関連ドキュメント

- **[I18N_README.md](./I18N_README.md)** - 多语言功能概述和使用说明
- **[I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md)** - 详细的组件迁移指南
- **[i18next 官方文档](https://www.i18next.com/)** - 国际化框架文档
- **[react-i18next 文档](https://react.i18next.com/)** - React 集成文档

---

## 技术细节 / Technical Details / 技術詳細

### 翻译文件结构 / Translation File Structure / 翻訳ファイル構造

```json
{
  "app": { "name": "Pixie", "beta": "BETA" },
  "common": {
    "save": "保存",
    "cancel": "取消",
    ...
  },
  "settings": {
    "title": "设置",
    "theme": "主题",
    ...
  }
}
```

### 语言检测 / Language Detection / 言語検出

- 优先使用 localStorage 中保存的语言偏好
- 其次使用浏览器语言
- 默认使用中文（zh）

### 持久化 / Persistence / 永続化

语言选择保存在浏览器的 localStorage 中，下次访问时自动应用。

Language selection is saved in browser localStorage and automatically applied on next visit.

言語選択はブラウザの localStorage に保存され、次回アクセス時に自動的に適用されます。

---

## 已知问题 / Known Issues / 既知の問題

1. 部分组件仍使用硬编码文本，需要逐步迁移
2. 某些长文本在日语/英语中可能显示不全，需要调整布局
3. 复数形式处理需要完善

---

## 许可证 / License / ライセンス

遵循 Pixie 项目的许可证。

Follows the Pixie project license.

Pixie プロジェクトのライセンスに従います。

---

## 贡献 / Contributing / コントリビューション

欢迎贡献！请查看相关文档了解如何添加新语言或改进翻译。

Contributions welcome! Please check the documentation for how to add new languages or improve translations.

コントリビューションを歓迎します！新しい言語の追加や翻訳の改善方法については、ドキュメントを確認してください。

---

**创建日期 / Created / 作成日：** 2024-01
**版本 / Version / バージョン：** 1.0.0
