#!/bin/bash
# 多语言依赖安装脚本 / i18n Dependencies Installation Script
# 多言語依存関係インストールスクリプト

echo "正在安装多语言相关依赖..."
echo "Installing i18n dependencies..."
echo "i18n関連の依存関係をインストールしています..."

# 检查包管理器 / Check package manager / パッケージマネージャーの確認
if command -v pnpm &> /dev/null; then
    echo "使用 pnpm 安装..."
    pnpm install
elif command -v npm &> /dev/null; then
    echo "使用 npm 安装..."
    npm install
elif command -v yarn &> /dev/null; then
    echo "使用 yarn 安装..."
    yarn install
else
    echo "错误：未找到 pnpm、npm 或 yarn"
    echo "Error: Neither pnpm, npm, nor yarn found"
    echo "エラー：pnpm、npm、yarn が見つかりませんでした"
    exit 1
fi

echo ""
echo "✅ 依赖安装完成！"
echo "✅ Dependencies installed!"
echo "✅ 依存関係のインストールが完了しました！"
echo ""
echo "现在可以运行项目了："
echo "You can now run the project:"
echo "プロジェクトを実行できます："
echo ""
echo "  pnpm dev   # 或 npm run dev / yarn dev"
echo ""
