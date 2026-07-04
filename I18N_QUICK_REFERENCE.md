# 多语言快速参考 / i18n Quick Reference / 多言語クイックリファレンス

## 🚀 快速开始 / Quick Start / クイックスタート

```bash
# 1. 安装依赖 / Install / インストール
pnpm install

# 2. 运行项目 / Run / 実行
pnpm dev

# 3. 在设置中切换语言 / Switch language in Settings / 設定で言語を切り替え
```

---

## 📝 常用代码片段 / Common Code Snippets / よく使うコードスニペット

### 基础使用 / Basic Usage / 基本的な使用

```tsx
import { useTranslation } from '../hooks/useTranslation';

function Component() {
  const { t } = useTranslation();
  return <button>{t('common.save')}</button>;
}
```

### 切换语言 / Change Language / 言語を切り替え

```tsx
const { i18n } = useTranslation();
i18n.changeLanguage('en');
```

### 带参数的翻译 / With Parameters / パラメータ付き

```tsx
t('settings.appliesOnly', { name: 'Claude' })
```

### 获取当前语言 / Get Current Language / 現在の言語を取得

```tsx
const { currentLanguage } = useTranslation();
// 'zh' | 'en' | 'ja'
```

---

## 🎯 常用翻译键 / Common Translation Keys / よく使う翻訳キー

| 键 / Key / キー | 中文 (zh) | English | 日本語 (ja) |
|----------------|-----------|---------|-------------|
| `app.name` | Pixie | Pixie | Pixie |
| `common.save` | 保存 | Save | 保存 |
| `common.cancel` | 取消 | Cancel | キャンセル |
| `common.delete` | 删除 | Delete | 削除 |
| `common.edit` | 编辑 | Edit | 編集 |
| `common.settings` | 设置 | Settings | 設定 |
| `common.refresh` | 刷新 | Refresh | 更新 |
| `settings.theme` | 主题 | Theme | テーマ |
| `settings.dark` | 深色 | Dark | ダーク |
| `settings.light` | 浅色 | Light | ライト |

---

## 📂 文件位置 / File Locations / ファイルの場所

```
src/i18n/
├── index.ts              # 配置
├── test.ts              # 测试
└── locales/
    ├── zh.json          # 中文
    ├── en.json          # English
    └── ja.json          # 日本語

src/hooks/
└── useTranslation.ts    # Hook

src/components/
└── LanguageSelector.tsx  # 语言选择器
```

---

## 🔧 添加新翻译的步骤 / Steps to Add New Translation / 新しい翻訳を追加するステップ

### 步骤 1: 添加翻译键到所有语言文件
### Step 1: Add translation key to all language files
### ステップ 1: すべての言語ファイルに翻訳キーを追加

```json
// src/i18n/locales/zh.json
{
  "myNewSection": {
    "myNewKey": "新翻译"
  }
}
```

```json
// src/i18n/locales/en.json
{
  "myNewSection": {
    "myNewKey": "New translation"
  }
}
```

```json
// src/i18n/locales/ja.json
{
  "myNewSection": {
    "myNewKey": "新しい翻訳"
  }
}
```

### 步骤 2: 在组件中使用
### Step 2: Use in component
### ステップ 2: コンポーネントで使用

```tsx
const { t } = useTranslation();
<span>{t('myNewSection.myNewKey')}</span>
```

---

## 🌍 添加新语言的步骤 / Steps to Add New Language / 新しい言語を追加するステップ

### 步骤 1: 创建翻译文件
### Step 1: Create translation file
### ステップ 1: 翻訳ファイルを作成

```bash
# 复制 en.json 作为模板 / Copy en.json as template / en.jsonをテンプレートとしてコピー
cp src/i18n/locales/en.json src/i18n/locales/ko.json
```

### 步骤 2: 翻译内容
### Step 2: Translate content
### ステップ 2: 内容を翻訳

编辑 `ko.json`，将所有英文翻译为韩语。

Edit `ko.json`, translate all English to Korean.

`ko.json` を編集し、すべての英語を韓国語に翻訳します。

### 步骤 3: 注册语言
### Step 3: Register language
### ステップ 3: 言語を登録

```ts
// src/i18n/index.ts
import ko from './locales/ko.json';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },  // 添加
};

export const SUPPORTED_LANGUAGES = [
  { code: 'zh', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },  // 添加
];
```

---

## 📚 相关文档 / Related Docs / 関連ドキュメント

| 文档 / Document / ドキュメント | 描述 / Description / 説明 |
|-------------------------------|-------------------------|--------------------------|
| [I18N_README.md](./I18N_README.md) | 功能概述 / Feature overview / 機能概要 |
| [I18N_MIGRATION_GUIDE.md](./I18N_MIGRATION_GUIDE.md) | 迁移指南 / Migration guide / 移行ガイド |
| [I18N_SUMMARY.md](./I18N_SUMMARY.md) | 实现总结 / Implementation summary / 実装のまとめ |
| [I18N_STRUCTURE.md](./I18N_STRUCTURE.md) | 文件结构 / File structure / ファイル構造 |

---

## 🐛 常见问题 / Common Issues / よくある問題

### Q: 翻译显示为键名而不是翻译文本？
### Q: Translation shows key instead of text?
### Q: 翻訳がキー名で表示される？

**A:** 检查：
1. 翻译文件格式是否正确（有效 JSON）
2. 键的路径是否正确
3. 是否已安装依赖

**A:** Check:
1. Translation file format is valid JSON
2. Key path is correct
3. Dependencies are installed

**A:** 確認事項：
1. 翻訳ファイルの形式が有効な JSON であること
2. キーのパスが正しいこと
3. 依存関係がインストールされていること

---

### Q: 如何调试翻译问题？
### Q: How to debug translation issues?
### Q: 翻訳問題をデバッグするには？

**A:** 在浏览器控制台运行：
```javascript
console.log(window.i18n);  // 查看 i18n 实例 / Check i18n instance / i18nインスタンスを確認
localStorage.getItem('i18nextLng');  // 查看保存的语言 / Check saved language / 保存された言語を確認
```

**A:** Run in browser console:
```javascript
console.log(window.i18n);
localStorage.getItem('i18nextLng');
```

**A:** ブラウザコンソールで実行：
```javascript
console.log(window.i18n);
localStorage.getItem('i18nextLng');
```

---

## ✅ 检查清单 / Checklist / チェックリスト

- [ ] 已安装依赖 / Dependencies installed / 依存関係がインストール済み
- [ ] 三种语言文件格式正确 / All 3 language files valid / 3つの言語ファイルが有効
- [ ] main.tsx 导入了 i18n / main.tsx imports i18n / main.tsxがi18nをインポート
- [ ] Settings 组件可以使用 / Settings component works / Settingsコンポーネントが動作
- [ ] 语言切换功能正常 / Language switching works / 言語切り替えが動作

---

**更新时间 / Updated / 更新日：** 2024-01
**版本 / Version / バージョン：** 1.0.0
