# 多语言支持 / Internationalization / 多言語サポート

Pixie 现在支持三种语言：简体中文、英语和日语。

Pixie now supports three languages: Simplified Chinese, English, and Japanese.

Pixie は現在3つの言語をサポートしています：簡体字中国語、英語、日本語。

---

## 支持的语言 / Supported Languages / サポート言語

- 🇨🇳 **简体中文** (Simplified Chinese) - `zh`
- 🇺🇸 **English** - `en`
- 🇯🇵 **日本語** (Japanese) - `ja`

---

## 如何切换语言 / How to Switch Language / 言語の切り替え方

1. 打开 Pixie 应用
2. 点击左侧边栏的 **Settings** (设置) 图标
3. 在设置页面中找到 **Language** (语言) 部分
4. 从下拉菜单中选择你想要的语言
5. 语言设置会自动保存并在下次启动时生效

---

## 添加新翻译 / Adding New Translations / 新しい翻訳の追加

如果你想为 Pixie 添加新的语言支持：

If you want to add a new language to Pixie:

Pixie に新しい言語を追加したい場合：

1. 在 `src/i18n/locales/` 目录下创建新的 JSON 文件（例如 `ko.json` 用于韩语）
2. 复制 `en.json` 的结构并翻译所有值
3. 在 `src/i18n/index.ts` 中导入并注册新语言
4. 在 `SUPPORTED_LANGUAGES` 数组中添加语言信息

示例：

```typescript
// src/i18n/index.ts
import ko from './locales/ko.json';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },  // 添加新语言
};

export const SUPPORTED_LANGUAGES = [
  { code: 'zh', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },  // 添加新语言
];
```

---

## 在代码中使用翻译 / Using Translations in Code / コードでの翻訳の使用

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.settings')}</h1>  // 显示"设置" / "Settings" / "設定"
      <p>{t('app.name')}</p>           // 显示"Pixie"
    </div>
  );
}
```

---

## 翻译文件结构 / Translation File Structure / 翻訳ファイル構造

翻译文件使用嵌套的 JSON 结构��

```json
{
  "section": {
    "key": "翻译文本",
    "nested": {
      "key": "嵌套翻译"
    },
    "withParams": "带有 {{param}} 参数的翻译"
  }
}
```

使用带参数的翻译：

```tsx
t('section.withParams', { param: 'value' })
```

---

## 安装依赖 / Installing Dependencies / 依存関係のインストール

在运行项目之前，确保安装了 i18next 相关依赖：

Before running the project, make sure to install i18next dependencies:

プロジェクトを実行する前に、i18next 関連の依存関係をインストールしてください：

```bash
pnpm install
```

或者使用 npm / yarn：

Or using npm / yarn:

または npm / yarn を使用：

```bash
npm install
# 或
yarn install
```

---

## 技术栈 / Tech Stack / 技術スタック

- **i18next** - 国际化核心框架
- **react-i18next** - React 集成
- **i18next-browser-languagedetector** - 自动检测用户语言

---

## 贡献 / Contributing / コントリビューション

欢迎贡献翻译改进或添加新语言！

Contributions for translation improvements or new languages are welcome!

翻訳の改善や新しい言語の追加を歓迎します！

---

## 许可证 / License / ライセンス

遵循 Pixie 项目的许可证。

Follows the Pixie project license.

Pixie プロジェクトのライセンスに従います。
