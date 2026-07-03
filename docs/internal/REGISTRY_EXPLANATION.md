# 模型注册表（Registry）详解

## 什么是注册表？

**注册表**是一个预定义的模型列表，包含了系统支持的已知模型及其配置信息。在 Pixie 项目中，这个注册表由 `pixie-pi` 库提供。

## 注册表从哪来的？

注册表来自 **`pixie-pi`** 这个外部依赖库：

### 1. 依赖声明
在 `src-tauri/Cargo.toml` 中：
```toml
[dependencies]
pixie-pi = { git = "https://github.com/white1or1black/pixie-pi", tag = "v0.1.0" }
```

### 2. 注册表定义
注册表在 `pixie-pi` 库的 `src/ai/mod.rs` 中定义：

```rust
pub fn builtin_models() -> Vec<Model> {
    let base = std::env::var("ANTHROPIC_BASE_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com".to_string());

    vec![
        Model {
            id: "claude-sonnet-4-6".into(),
            provider: "anthropic".into(),
            api: Api::AnthropicMessages,
            max_tokens: 64_000,
            context_window: 1_000_000,
            base_url: base.clone(),
            reasoning: true,
            force_adaptive_thinking: true,
            supports_temperature: false,
            input_cost_per_mtok: 3.0,
            output_cost_per_mtok: 15.0,
            cache_read_cost_per_mtok: 0.30,
            cache_write_cost_per_mtok: 3.75,
        },
        Model {
            id: "claude-opus-4-8".into(),
            // ... 其他配置
        },
        Model {
            id: "claude-haiku-4-5".into(),
            // ... 其他配置
        },
    ]
}
```

### 3. 本地缓存
Pixie-pi 的源码会被下载到：
```
~/.cargo/git/checkouts/pixie-pi-83923a8adfb68195/a005b3e/
```

## 注册表包含什么信息？

每个 `Model` 结构体包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | 模型唯一标识符 | `"claude-sonnet-4-6"` |
| `provider` | 提供商 | `"anthropic"` |
| `api` | API 协议 | `Api::AnthropicMessages` |
| `max_tokens` | 最大输出 token 数 | `64_000` |
| `context_window` | 上下文窗口大小 | `1_000_000` |
| `base_url` | API 基础 URL | `"https://api.anthropic.com"` |
| `reasoning` | 是否支持推理 | `true` |
| `force_adaptive_thinking` | 强制自适应思考 | `true` |
| `supports_temperature` | 是否支持温度参数 | `false` |
| `input_cost_per_mtok` | 输入价格（每百万 token） | `3.0` |
| `output_cost_per_mtok` | 输出价格（每百万 token） | `15.0` |
| `cache_read_cost_per_mtok` | 缓存读取价格 | `0.30` |
| `cache_write_cost_per_mtok` | 缓存写入价格 | `3.75` |

## 如何使用注册表？

### 在代码中调用
```rust
use pixie_pi::ai;

// 获取注册表
let registry = pixie_pi::ai::builtin_models();

// 解析模型模式
let model = pixie_pi::ai::resolve_model(&registry, "sonnet");
// 返回: Some(Model { id: "claude-sonnet-4-6", ... })
```

### 匹配规则
`resolve_model()` 函数使用智能匹配：

```rust
pub fn resolve_model(registry: &[Model], pattern: &str) -> Option<Model> {
    // 1. 提取 provider 和 id (支持 "anthropic/sonnet" 格式)
    let (provider, id) = match pattern.split_once('/') {
        Some((p, id)) => (Some(p), id),
        None => (None, pattern),
    };

    // 2. 去除 thinking 后缀 (如 "sonnet:high" -> "sonnet")
    let needle = id.split(':').next().unwrap_or(id).to_ascii_lowercase();

    // 3. 匹配逻辑（不区分大小写）:
    //    - 精确匹配: "claude-sonnet-4-6" == "claude-sonnet-4-6"
    //    - 后缀匹配: "claude-sonnet-4-6".ends_with("-sonnet")
    //    - 包含匹配: "claude-sonnet-4-6".contains("sonnet")
    registry.iter()
        .filter(|m| provider.as_deref().is_none_or(|p| m.provider == p))
        .find(|m| {
            let id = m.id.to_ascii_lowercase();
            id == needle || id.ends_with(&format!("-{needle}")) || id.contains(&needle)
        })
        .cloned()
}
```

## 匹配示例

| 用户输入 | 匹配结果 | 说明 |
|---------|---------|------|
| `"sonnet"` | ✅ `claude-sonnet-4-6` | 后缀匹配 |
| `"opus"` | ✅ `claude-opus-4-8` | 后缀匹配 |
| `"haiku"` | ✅ `claude-haiku-4-5` | 后缀匹配 |
| `"claude-sonnet-4-6"` | ✅ `claude-sonnet-4-6` | 精确匹配 |
| `"anthropic/sonnet"` | ✅ `claude-sonnet-4-6` | provider + 后缀 |
| `"sonnet:high"` | ✅ `claude-sonnet-4-6` | 忽略 thinking 后缀 |
| `"custom-model"` | ❌ `None` | 不匹配任何模型 |

## 我们的修复做了什么？

### 之前的行为
当用户设置 `ANTHROPIC_MODEL="custom-model"` 时：
```rust
// 匹配失败，返回 None
resolve_model(&registry, "custom-model")  // None

// fallback 到注册表第一个模型
.unwrap_or_else(|| registry[0].clone())
// 结果: claude-sonnet-4-6 (错误！)
```

### 修复后的行为
```rust
if let Some(matched) = resolve_model(&registry, "custom-model") {
    matched  // 匹配成功，使用注册表模型
} else {
    // 创建自定义模型
    Model {
        id: "custom-model".to_string(),  // ✅ 使用用户指定的 ID
        // ... 其他默认配置
    }
}
```

## 为什么需要注册表？

### 优点
1. **统一的配置管理** - 所有已知模型在一个地方配置
2. **类型安全** - 编译时检查模型配置
3. **智能匹配** - 支持多种输入格式（别名、后缀等）
4. **价格计算** - 自动计算 token 成本
5. **参数验证** - 知道模型支持哪些功能

### 缺点
1. **需要更新** - 新模型需要更新代码
2. **不灵活** - 无法轻松使用自定义模型
3. **版本依赖** - 依赖 `pixie-pi` 库的更新

## 总结

- **注册表**是 `pixie-pi` 库中预定义的模型列表
- 包含 3 个 Anthropic 模型：Sonnet 4.6、Opus 4.8、Haiku 4.5
- 提供**智能匹配**功能，支持别名和模糊匹配
- 我们的修复允许在匹配失败时使用**自定义模型 ID**
- 这样既保持了注册表的便利性，又增加了灵活性

## 相关文件

- `~/.cargo/git/checkouts/pixie-pi-*/src/ai/mod.rs` - 注册表定义
- `src-tauri/src/engine/builtin/mod.rs` - 使用注册表的代码
- `src-tauri/Cargo.toml` - pixie-pi 依赖声明
