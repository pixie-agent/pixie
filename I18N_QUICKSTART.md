# 🌐 Pixie 多语言快速启动指南
# i18n Quick Start Guide
# 多言語クイックスタートガイド

## ⚡ 5分钟快速上手 / 5-Minute Quick Start / 5分で素早く始める

---

### 步骤 1: 安装依赖 (1分钟) / Step 1: Install Dependencies (1 min)

```bash
pnpm install
```

或使用提供的脚本：

Or use the provided script:

または提供されたスクリプトを使用：

```bash
./install-i18n.sh
```

---

### 步骤 2: 启动项目 (30秒) / Step 2: Start Project (30 sec)

```bash
pnpm dev
```

---

### 步骤 3: 测试功能 (2分钟) / Step 3: Test Feature (2 min)

1. 打开浏览器访问应用
2. 点击左侧边栏的 ⚙️ 设置图标
3. 找到"语言"（Language）部分
4. 切换不同语言，观察界面变化
5. 刷新页面，确认语言偏好被保存

---

### 步骤 4: 在代码中使用 (剩余时间) / Step 4: Use in Code (remaining)

```tsx
import { useTranslation } from '../hooks/useTranslation';

function MyComponent() {
  const { t } = useTranslation();
  return <button>{t('common.save')}</button>;
}
```

---

## ✅ 验证清单 / Verification Checklist / 確認チェックリスト

运行前检查：

Check before running:

実行前に確認：

- [ ] 依赖已安装 (`node_modules` 存在)
- [ ] 语言文件存在 (`src/i18n/locales/*.json`)
- [ ] 没有编译错误
- [ ] 浏览器控制台无错误

---

## 🐛 遇到问题？/ Troubleshooting / 問題が発生？

### 问题 1: 翻译显示为键名

**解决：** 检查浏览器控制台是否有 JSON 解析错误

**Solution:** Check browser console for JSON parse errors

**解決策：** ブラウザコンソールでJSON解析エラーを確認

### 问题 2: 语言切换无效

**解决：** 清除浏览器缓存和 localStorage

**Solution:** Clear browser cache and localStorage

**解決策：** ブラウザキャッシュとlocalStorageをクリア

### 问题 3: 模块找不到

**解决：** 重新安装依赖 `rm -rf node_modules && pnpm install`

**Solution:** Reinstall dependencies

**解決策：** 依存関係を再インストール

---

## 📚 需要更多信息？/ Need More Info? / さらに詳しい情報は？

- [完整文档 / Full Docs / 完全なドキュメント](./I18N_README.md)
- [迁移指南 / Migration Guide / 移行ガイド](./I18N_MIGRATION_GUIDE.md)
- [快速参考 / Quick Ref / クイックリファレンス](./I18N_QUICK_REFERENCE.md)

---

**就这么简单！/ That's it! / たったこれだけ！**

---

🌍 祝你使用愉快！/ Enjoy! / お楽しみください！
