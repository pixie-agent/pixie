# 内置引擎快速参考

## 模型配置

### 单一模型模式
内置引擎现在只显示一个 "Default" 模型选项，实际使用的模型 ID 由环境变量控制。

```bash
# 设置要使用的模型
export ANTHROPIC_MODEL="claude-sonnet-4-6"

# 设置 API 地址（可选）
export ANTHROPIC_BASE_URL="https://api.anthropic.com"

# 设置 API Key
export ANTHROPIC_API_KEY="sk-ant-..."
```

## 支持的模型

可以使用任何 Anthropic 模型 ID：

| 模型 ID | 说明 |
|---------|------|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-haiku-4-5` | Claude Haiku 4.5 |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |
| `claude-3-opus-20240229` | Claude 3 Opus |
| 或任何其他 Anthropic 模型 ID | |

## 工作流程

```
1. 配置环境变量
   export ANTHROPIC_MODEL="your-model-id"
   export ANTHROPIC_API_KEY="your-api-key"

2. 启动 Pixie

3. 选择 Builtin 引擎
   Engine: Builtin
   Model: Default

4. 开始对话
   → API 使用 ANTHROPIC_MODEL 指定的模型
```

## 配置优先级

模型 ID 优先级（从高到低）：

1. **会话级覆盖**（如果有）
2. **配置文件** `builtin.ANTHROPIC_MODEL`
3. **环境变量** `ANTHROPIC_MODEL`
4. **默认值** `"builtin"`

## 日志检查

启动时查看日志确认配置：

```bash
# 查看日志
tail -f pixie.log | grep builtin

# 期望看到
[builtin] resolving model: id=<your-model>, base_url=...
[builtin] new session: model=<your-model>, base_url=..., cwd=...
```

## 故障排查

### 问题：使用了错误的模型
**解决**：检查 ANTHROPIC_MODEL 环境变量是否正确设置

### 问题：API 调用失败
**解决**：
1. 检查 ANTHROPIC_API_KEY 是否有效
2. 检查 ANTHROPIC_BASE_URL 是否正确
3. 检查模型 ID 是否有效

### 问题：找不到模型
**解决**：
- 内置引擎现在会直接使用你指定的任何模型 ID
- 如果模型不存在，API 会返回错误（不是内置引擎的限制）

## 常见配置示例

### 使用 Sonnet 4.6
```bash
export ANTHROPIC_MODEL="claude-sonnet-4-6"
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 使用 Opus 4.8
```bash
export ANTHROPIC_MODEL="claude-opus-4-8"
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 使用自定义 API 端点
```bash
export ANTHROPIC_MODEL="custom-model"
export ANTHROPIC_BASE_URL="https://my-proxy.example.com"
export ANTHROPIC_API_KEY="custom-key"
```

### 本地开发（HTTP）
```bash
export ANTHROPIC_MODEL="local-model"
export ANTHROPIC_BASE_URL="http://localhost:8080"
export ANTHROPIC_API_KEY="dev-key"
```

## 与其他引擎对比

| 引擎 | 模型选择 | 配置方式 |
|------|---------|---------|
| **Builtin** | 单一 "Default" | 环境变量 |
| **Claude** | Claude CLI 管理 | CLI 配置 |
| **Cursor** | Cursor 管理 | Cursor 配置 |
| **CodeBuddy** | 自定义 | 配置文件 |

## 迁移指南

如果你之前使用的是多模型选择：

### 之前
```
选择: claude-sonnet-4-6
```

### 现在
```bash
export ANTHROPIC_MODEL="claude-sonnet-4-6"
选择: Default
```

效果完全相同，但现在更灵活了！
