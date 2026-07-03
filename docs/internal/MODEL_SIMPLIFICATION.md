# 模型简化改动说明

## 改动概述

将内置引擎（builtin）从**多模型注册表**简化为**单一通用模型**。

## 之前的设计

### 多模型注册表
```
用户看到的选项：
├─ claude-sonnet-4-6 (Sonnet 4.6)
├─ claude-opus-4-8 (Opus 4.8)
└─ claude-haiku-4-5 (Haiku 4.5)

内部实现：
- 使用 pixie_pi::ai::builtin_models() 获取注册表
- 支持智能匹配（"sonnet" → "claude-sonnet-4-6"）
- 匹配失败时 fallback 到第一个模型
```

### 问题
1. **混淆**：用户不知道该选哪个模型
2. **复杂**：维护 3 个模型的配置
3. **僵化**：匹配失败强制 fallback 到 Sonnet
4. **冗余**：大多数用户只用一个模型

## 现在的设计

### 单一通用模型
```
用户看到的选项：
└─ Default (configured via ANTHROPIC_MODEL)

内部实现：
- 直接使用用户配置的模型 ID
- 不再使用注册表匹配
- 完全由 ANTHROPIC_MODEL 环境变量控制
```

### 优点
1. **简单**：用户只看到一个选项
2. **灵活**：可以配置任意模型 ID
3. **清晰**：通过环境变量明确指定模型
4. **通用**：支持任何 Anthropic 模型（包括未来的）

## 代码改动

### 1. DEFAULT_MODEL 常量

```rust
// 之前
pub const DEFAULT_MODEL: &str = "claude-sonnet-4-6";

// 现在
pub const DEFAULT_MODEL: &str = "builtin";
```

### 2. list_models() 函数

```rust
// 之前
pub async fn list_models() -> Vec<(String, String)> {
    pixie_pi::ai::builtin_models()
        .iter()
        .map(|m| (m.id.clone(), display_name_for(&m.id)))
        .collect()
}
// 返回: [("claude-sonnet-4-6", "Claude Sonnet 4.6"), ...]

// 现在
pub async fn list_models() -> Vec<(String, String)> {
    vec![
        ("builtin".to_string(), "Default (configured via ANTHROPIC_MODEL)".to_string()),
    ]
}
// 返回: [("builtin", "Default (configured via ANTHROPIC_MODEL)")]
```

### 3. resolve_builtin_model() 函数

```rust
// 之前
fn resolve_builtin_model(model: Option<&str>, base_url: Option<&str>) -> Model {
    let registry = pixie_pi::ai::builtin_models();  // 获取注册表
    let resolved = match model {
        Some(pattern) => {
            if let Some(matched) = pixie_pi::ai::resolve_model(&registry, pattern) {
                matched  // 匹配成功，使用注册表模型
            } else {
                Model { id: pattern.to_string(), ... }  // fallback
            }
        }
        None => registry[0].clone(),  // 使用第一个模型
    };
    // ... base_url 处理
}

// 现在
fn resolve_builtin_model(model: Option<&str>, base_url: Option<&str>) -> Model {
    let model_id = model.unwrap_or("builtin");  // 直接使用传入的 ID

    let base_url = base_url.map(|u| u.to_string()).unwrap_or_else(|| {
        std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string())
    });

    Model {
        id: model_id.to_string(),  // 直接使用用户指定的 ID
        base_url,
        // ... 通用配置
    }
}
```

### 4. 移除的代码

- 删除 `display_name_for()` 函数（不再需要显示名称映射）

## 使用方式

### 配置模型 ID

用户通过环境变量或配置文件指定实际使用的模型：

```bash
# 方式 1: 环境变量
export ANTHROPIC_MODEL="claude-sonnet-4-6"

# 方式 2: 配置文件
# 在配置中设置 builtin.ANTHROPIC_MODEL

# 方式 3: 使用任意模型 ID
export ANTHROPIC_MODEL="claude-3-5-sonnet-20241022"
export ANTHROPIC_MODEL="claude-opus-4-20250514"
export ANTHROPIC_MODEL="my-custom-model"
```

### UI 交互

```
用户界面：
┌─────────────────────────────┐
│  Engine: Builtin            │
│  Model: Default             │  ← 只有一个选项
│  ┌─────────────────────┐    │
│  │ Configure via:       │    │
│  │ ANTHROPIC_MODEL env  │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

## 工作流程

```
1. 用户启动 Pixie
   ↓
2. 内置引擎加载配置
   ├─ 读取 ANTHROPIC_MODEL 环境变量
   │  └─→ 未设置？使用 "builtin" 作为占位符
   │
   └─ 读取 ANTHROPIC_BASE_URL 环境变量
      └─→ 未设置？使用 "https://api.anthropic.com"
   ↓
3. 用户选择 "Default" 模型
   ↓
4. 创建会话时：
   resolve_builtin_model(
       model: Some("builtin"),
       base_url: Some("https://api.anthropic.com")
   )
   ↓
5. 实际 API 调用使用：
   {
     "model": "claude-sonnet-4-6",  // 从环境变量读取
     "messages": [...]
   }
```

## 兼容性

### 向后兼容
- ✅ 现有配置继续工作
- ✅ 用户可以继续使用 ANTHROPIC_MODEL 指定模型
- ✅ 不影响其他引擎���claude、cursor、codebuddy）

### 新行为
- ✅ 不再强制 fallback 到特定模型
- ✅ 完全由用户控制模型 ID
- ✅ 支持任何模型 ID（包括未来的模型）

## 日志输出

### 启动日志
```
[builtin] resolving model: id=builtin, base_url=Some("https://api.anthropic.com")
```

### 运行时日志
```
[builtin] new session: model=claude-sonnet-4-6, base_url=https://api.anthropic.com, cwd=/path/to/project
```

## 总结

这次简化实现了：

1. **用户体验改进** - 只看到一个 "Default" 模型选项
2. **配置清晰** - 通过 ANTHROPIC_MODEL 明确指定模型
3. **灵活性提升** - 支持任何模型 ID
4. **代码简化** - 移除注册表依赖，减少复杂度
5. **完全兼容** - 现有配置继续工作

用户现在可以通过简单的环境变量配置使用任何 Anthropic 模型，而不需要在 UI 中在多个模型选项之间选择。
