# 发布 GitHub Release 的步骤指南

由于 GitHub Actions 已经创建了草稿 Release，现在需要手动发布。

## 方法一：通过 GitHub 网页界面（推荐）

1. **访问 GitHub Releases 页面**：
   ```
   https://github.com/white1or1black/pixie/releases
   ```

2. **找到 `Pixie v0.8.1` 的草稿 Release**（标记为 "Draft"）

3. **点击 "Edit release"** 按钮

4. **检查 Release 信息**：
   - 版本标签：`app-v0.8.1`
   - Release 标题：`Pixie v0.8.1`
   - 描述信息是否正确

5. **点击绿色的 "Publish release"** 按钮

6. **完成！** Release 现在已经公开发布

## 方法二：使用 GitHub CLI

如果你安装了 GitHub CLI：

```bash
# 安装 GitHub CLI（如果还没有安装）
brew install gh  # macOS
# 或者访问 https://cli.github.com/

# 登录 GitHub
gh auth login

# 查看草稿 Release
gh release list --draft

# 发布 Release
gh release edit app-v0.8.1 --draft=false
```

## 方法三：使用发布脚本

使用我创建的脚本（需要 GitHub token）：

```bash
# 1. 创建 GitHub token: https://github.com/settings/tokens
# 2. 给 token 'repo' 权限
# 3. 运行脚本

./publish-release.sh YOUR_GITHUB_TOKEN_HERE
```

## 发布后的验证步骤

1. **确认 Release 不再显示为草稿**
2. **检查构建产物是否可用**：
   - macOS (Intel & Apple Silicon)
   - Windows (x64)
   - Linux (AppImage)
3. **测试更新功能**（如果有用户已安装旧版本）

## 注意事项

- ⏰ **GitHub Actions 需要时间**：通常需要 10-20 分钟完成所有平台的构建
- 📦 **检查构建状态**：在发布前确认所有平台构建成功
- 🔍 **查看 Actions 运行**：https://github.com/white1or1black/pixie/actions

## 当前 Release 信息

- **标签**：`app-v0.8.1`
- **版本**：`0.8.1`
- **类型**：正式发布（非预发布）
- **状态**：等待发布