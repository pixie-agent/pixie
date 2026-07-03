# 模型解析流程图

## 流程概览

```
用户设置模型 ID
    │
    ├─→ ANTHROPIC_MODEL="sonnet"
    ├─→ ANTHROPIC_MODEL="custom-model-x"
    └─→ ANTHROPIC_MODEL="claude-opus-4-8"
            │
            ▼
    ┌───────────────────────┐
    │ resolve_builtin_model()│
    └───────────────────────┘
            │
            ├─ 1. 获取注册表 ─→ builtin_models()
            │                  └─→ [Sonnet 4.6, Opus 4.8, Haiku 4.5]
            │
            ├─ 2. 尝试匹配 ─→ resolve_model(&registry, pattern)
            │                  │
            │                  ├─ 精确匹配？
            │                  ├─ 后缀匹配？ (ends_with)
            │                  └─ 包含匹配？ (contains)
            │
            └─ 3. 处理结果
                    │
                    ├─→ 匹配成功？→ 使用注册表模型
                    │
                    └─→ 匹配失败？
                        │
                        ├─ 之前: fallback 到 registry[0]
                        │          (claude-sonnet-4-6) ❌
                        │
                        └─ 现在: 创建自定义模型 ✅
                                  id = pattern
```

## 具体示例

### 示例 1: 已知模型 (匹配成功)

```
输入: "sonnet"
  │
  ▼
获取注册表
  │
  ├─→ Model { id: "claude-sonnet-4-6", ... }
  ├─→ Model { id: "claude-opus-4-8", ... }
  └─→ Model { id: "claude-haiku-4-5", ... }
  │
  ▼
匹配: "sonnet"
  │
  ├─ 精确匹配? ❌ (没有模型 ID 等于 "sonnet")
  ├─ 后缀匹配? ✅ ("claude-sonnet-4-6".ends_with("-sonnet"))
  │
  ▼
返回: Model { id: "claude-sonnet-4-6", ... }
```

### 示例 2: 未知模型 (匹配失败 - 修复前)

```
输入: "my-custom-model"
  │
  ▼
匹配: "my-custom-model"
  │
  ├─ 精确匹配? ❌
  ├─ 后缀匹配? ❌
  └─ 包含匹配? ❌
  │
  ▼
返回: None
  │
  ▼
unwrap_or_else(|| registry[0].clone())
  │
  ▼
结果: Model { id: "claude-sonnet-4-6", ... }  ❌ 错误！
```

### 示例 3: 未知模型 (匹配失败 - 修复后)

```
输入: "my-custom-model"
  │
  ▼
匹配: "my-custom-model"
  │
  ├─ 精确匹配? ❌
  ├─ 后缀匹配? ❌
  └─ 包含匹配? ❌
  │
  ▼
返回: None
  │
  ▼
if let Some(matched) = ... { } else {
    // 创建自定义模型
    Model {
        id: "my-custom-model".to_string(),  ✅
        provider: "anthropic",
        api: AnthropicMessages,
        // ... 默认配置
    }
}
```

## 代码对比

### 修复前
```rust
fn resolve_builtin_model(model: Option<&str>, base_url: Option<&str>) -> Model {
    let registry = pixie_pi::ai::builtin_models();
    let mut resolved = match model {
        Some(pattern) => {
            // ❌ 匹配失败时强制使用第一个注册表模型
            pixie_pi::ai::resolve_model(&registry, pattern)
                .unwrap_or_else(|| registry[0].clone())
        }
        None => registry[0].clone(),
    };
    // ... base_url 处理
}
```

### 修复后
```rust
fn resolve_builtin_model(model: Option<&str>, base_url: Option<&str>) -> Model {
    let registry = pixie_pi::ai::builtin_models();
    let resolved = match model {
        Some(pattern) => {
            // ✅ 先尝试匹配
            if let Some(matched) = pixie_pi::ai::resolve_model(&registry, pattern) {
                matched
            } else {
                // ✅ 匹配失败时创建自定义模型
                log::info!("pattern '{}' not found, using as custom ID", pattern);
                Model {
                    id: pattern.to_string(),  // 使用用户的 pattern
                    // ... 合理的默认值
                }
            }
        }
        None => registry[0].clone(),
    };
    // ... base_url 处理
}
```

## 数据流图

```
┌─────────────────────────────────────────────────────┐
│                     用户配置                          │
│  ANTHROPIC_MODEL = "custom-model-123"               │
│  ANTHROPIC_BASE_URL = "https://my-api.example.com" │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            BuiltinSession::new()                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ resolve_builtin_model(Some("custom-model-123"),│ │
│  │                      Some("https://..."))     │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              模型解析流程                              │
│                                                      │
│  1. 获取注册表:                                      │
│     ┌─── Model { id: "claude-sonnet-4-6" }          │
│     ├─── Model { id: "claude-opus-4-8" }            │
│     └─── Model { id: "claude-haiku-4-5" }           │
│                                                      │
│  2. 尝试匹配 "custom-model-123":                     │
│     └──→ None (无匹配)                               │
│                                                      │
│  3. 创建自定义模型: ✅                                │
│     ┌─────────────────────────────────────────┐    │
│     │ id: "custom-model-123"                  │    │
│     │ provider: "anthropic"                    │    │
│     │ api: AnthropicMessages                  │    │
│     │ base_url: "https://my-api.example.com"  │    │
│     │ context_window: 200_000                  │    │
│     │ max_tokens: 64_000                       │    │
│     │ ... (其他默认配置)                       │    │
│     └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              AgentSession 创建                         │
│  ┌──────────────────────────────────────────────┐  │
│  │ session.model.id = "custom-model-123"        │  │
│  │ session.model.base_url = "https://..."        │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              API 请求                                  │
│  POST https://my-api.example.com/v1/messages         │
│  {                                                   │
│    "model": "custom-model-123",  ✅ 正确的模型 ID    │
│    "messages": [...]                                │
│  }                                                   │
└─────────────────────────────────────────────────────┘
```

## 总结

注册表是一个**预定义的已知模型列表**，提供：
- ✅ 智能匹配功能（别名、模糊匹配）
- ✅ 完整的模型配置（价格、参数等）
- ✅ 类型安全的配置管理

修复后的代码：
- ✅ 优先使用注册表匹配（保留便利性）
- ✅ 匹配失败时使用用户指定的 ID（增加灵活性）
- ✅ 为自定义模型提供合理的默认配置

这样既**向后兼容**（现有配置继续工作），又**支持自定义**（可以注册表外的模型）。
