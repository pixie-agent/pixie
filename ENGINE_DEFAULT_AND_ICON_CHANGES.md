# 默认引擎和图标修改总结

## 修改目标
1. 将所有使用 engine 的地方默认使用内置引擎（builtin）
2. 引擎图标使用 Pixie 自己的图标

## 修改文件清单

### 1. 前端配置修改

#### src/lib/storage.ts
- **默认引擎**: `defaultEngine` 从 `"claude"` 改为 `"builtin"`
- **已知就绪引擎**: `knownReadyEngines` 默认值从 `[]` 改为 `["builtin"]`
- **Fallback 逻辑**: 在配置读取和迁移的多个地方，将引擎 ID 的 fallback 值从 `"claude"` 改为 `"builtin"`
  - `wireToConfig()` 函数
  - `migrateFromLocalStorage()` 函数
  - 历史记录迁移逻辑

#### src/components/EngineBadge.tsx
- **新增常量**: `BUILTIN_ICON` 指向新��建的 Pixie 图标
- **缩写映射**: `engineAbbr()` 函数添加 `"builtin" → "Px"`
- **颜色样式**: `engineColorClasses()` 函数为 builtin 添加紫色系样式（与 Pixie 品牌一致）
- **图标映射**: `engineIconHref()` 函数添加 builtin → BUILTIN_ICON

#### src/hooks/useChat.ts
- **对话规范化**: `normalizeConversation()` 函数将引擎 fallback 从 `"claude"` 改为 `"builtin"`
- **计划任务**: `addScheduledRun()` 函数将任务对话的引擎设为 `"builtin"`
- **运行任务**: `addRunningTask()` 函数将运行任务对话的引擎设为 `"builtin"`

#### src/components/LoopTasksPanel.tsx
- **默认循环任务**: `emptyDraft()` 函数将新循环任务的默认引擎从 `"claude"` 改为 `"builtin"`

### 2. 新建文件

#### src/assets/engine-icons/builtin.svg
- 创建了专用的 Pixie 风格图标
- 使用与主应用一致的紫色渐变（#6c63ff）
- 包含 Pixie 的核心元素：发光的精灵球、翅膀和星尘
- 在小尺寸徽章中清晰可辨

### 3. 后端代码（已有修改）

#### src-tauri/Cargo.lock
- 版本升级到 `0.8.0-beta.4`
- 新增 native-tls 相关依赖以支持 HTTP 协议

#### src-tauri/src/engine/builtin/mod.rs
- 从多模型注册表简化为单一通用模型
- 移除了 `display_name_for()` 函数
- `resolve_builtin_model()` 重构为直接使用用户提供的模型 ID
- `list_models()` 只返回一个 "Default" 选项

## 影响范围

### 新用户
- 首次启动应用时，默认引擎为 **Builtin**（内置引擎）
- 看到的引擎徽章显示 **Pixie 的精灵图标**
- 引擎缩写为 **"Px"**，颜色为紫色系

### 现有用户
- 已配置的对话保持原有的引擎设置
- 新创建的对话默认使用 Builtin 引擎
- UI 中的 Builtin 引擎现在显示 Pixie 图标

### 系统行为
- 所有新建对话、计划任务、循环任务都默认使用 Builtin 引擎
- 配置迁移时的 fallback 引擎改为 Builtin
- 已知就绪引擎列表默认包含 Builtin

## 设计考虑

### 为什么要将默认引擎改为 Builtin？
1. **独立性**: Builtin 引擎是 Pixie 自己的引擎，不依赖外部 CLI 工具
2. **简化配置**: 用户只需配置 ANTHROPIC_API_KEY 即可使用
3. **统一体验**: 所有用户使用相同的后端接口和配置方式
4. **品牌一致性**: 强调 Pixie 自己的解决方案

### 为什么保留其他引擎？
1. **灵活性**: 高级用户仍可选择使用其他引擎
2. **兼容性**: 不破坏现有用户的配置和习惯
3. **渐进式迁移**: 用户可以逐步切换到 Builtin 引擎

### 图标设计
- 使用 Pixie 的标志性紫色（#6c63ff）
- 保持与主应用图标的视觉一致性
- 在小尺寸（2.5×2.5px）下依然清晰可辨
- 包含发光、翅膀、星尘等 Pixie 特征元素

## 验证清单

- [x] 默认引擎配置修改
- [x] 引擎图标创建和引用
- [x] 徽章颜色和缩写配置
- [x] 所有 fallback 逻辑统一
- [x] 对话创建默认引擎
- [x] 计划任务默认引擎
- [x] 循环任务默认引擎
- [x] 配置迁移兼容性

## 预期效果

1. **新用户体验**: 开箱即用，默认使用 Pixie 的内置引擎
2. **品牌一致性**: 所有地方看到的都是 Pixie 的图标和品牌色
3. **简化配置**: 减少用户需要理解和配置的项目
4. **向后兼容**: 不影响现有用户的使用习惯
