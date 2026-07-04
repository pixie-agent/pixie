# Loop 功能改进说明

## 功能概述

本次改进为 Loop 功能添加了以下两个重要特性：

1. **Aborted 时显示原因** - 当 Loop 被中止时，用户可以知道具体原因
2. **Completed 时显示改动摘要** - 当 Loop 正常完成时，用户可以看到改了哪些内容

## 实现细节

### 后端改动 (Rust)

#### 1. 数据结构更新

在 `LoopTask` 结构体中添加了两个新字段：

```rust
pub struct LoopTask {
    // ... 现有字段 ...

    /// Human-readable reason explaining why the loop was aborted or completed.
    /// For aborted: describes who stopped it (user/system) and why.
    /// For completed: describes which exit condition was satisfied.
    #[serde(default)]
    pub completion_reason: Option<String>,

    /// Summary of changes made during the loop (extracted from tool use events).
    /// Populated when the loop completes successfully.
    #[serde(default)]
    pub changes_summary: Option<String>,
}
```

#### 2. 新增辅助函数

**`format_exit_condition_met`**: 格式化退出条件被满足的原因

```rust
fn format_exit_condition_met(
    conditions: &[LoopExitCondition],
    iteration: u32,
    result: &str,
    unchanged_streak: u32,
) -> String
```

- 返回满足的具体退出条件描述
- 例如：
  - "Reached maximum iteration count (50 iterations)"
  - "No errors matching pattern /error|failed/ found"
  - "Success pattern /All tests passed/ matched"
  - "Output unchanged for 2 consecutive iteration(s)"

**`extract_changes_summary`**: 从 Agent 输出中提取改动摘要

```rust
fn extract_changes_summary(result: &str) -> Option<String>
```

- 分析 Agent 输出中的文件操作和命令执行
- 统计编辑的文件数、创建的文件数、运行的命令数
- 返回格式如："Edited 3 files, Created 1 file, Ran 5 command(s)"

**`extract_file_path`** 和 **`extract_command`**: 辅助解析函数

#### 3. 在 Loop 生命周期中设置原因

**完成时 (Completed)**:
```rust
if outcome.exit_met {
    let exit_reason = format_exit_condition_met(&fresh_task.exit_conditions, ...);
    t.status = LoopTaskStatus::Completed;
    t.completion_reason = Some(exit_reason.clone());
    t.changes_summary = extract_changes_summary(&outcome.result);
    ...
}
```

**用户中止时 (Aborted by user)**:
```rust
async fn stop_loop_task(app: AppHandle, task_id: String) -> Result<(), String> {
    t.status = LoopTaskStatus::Aborted;
    t.completion_reason = Some("Stopped by user".to_string());
    ...
}
```

**用户丢弃时 (Discarded by user)**:
```rust
async fn discard_loop_task(app: AppHandle, task_id: String) -> Result<(), String> {
    t.status = LoopTaskStatus::Aborted;
    t.completion_reason = Some("Discarded by user".to_string());
    ...
}
```

**系统中断时 (System shutdown)**:
```rust
if matches!(t.status, LoopTaskStatus::Running) {
    t.status = LoopTaskStatus::Aborted;
    t.completion_reason = Some("Loop interrupted by system shutdown".to_string());
}
```

**出错时 (Error)**:
```rust
if outcome.status != "ok" {
    let error_reason = format!("Iteration failed: {}", outcome.result.chars().take(200).collect::<String>());
    t.status = LoopTaskStatus::Error;
    t.completion_reason = Some(error_reason.clone());
    ...
}
```

### 前端改动 (TypeScript/React)

#### 1. 类型更新

在 `types.ts` 中更新 `LoopTask` 接口：

```typescript
export interface LoopTask {
    // ... 现有字段 ...
    /** Human-readable reason explaining why the loop was aborted or completed. */
    completion_reason: string | null;
    /** Summary of changes made during the loop. */
    changes_summary: string | null;
}
```

#### 2. UI 更新 (LoopTasksPanel.tsx)

**在任务详情面板中显示完成信息**:

```tsx
{/* Completion reason */}
{selectedTask.completion_reason && (
  <div className={selectedTask.status === "completed"
    ? "bg-green-500/5 border border-green-500/20"
    : "bg-orange-500/5 border border-orange-500/20"}>
    <div className="flex items-center gap-2">
      {statusIcon}
      <span>Loop completed / stopped</span>
    </div>
    <p>{selectedTask.completion_reason}</p>
  </div>
)}

{/* Changes summary */}
{selectedTask.changes_summary && (
  <div className="bg-blue-500/5 border border-blue-500/20">
    <div className="flex items-center gap-2">
      <Icon>Changes made</Icon>
    </div>
    <p>{selectedTask.changes_summary}</p>
  </div>
)}
```

**在任务列表中显示完成原因**:
```tsx
{t.completion_reason && (t.status === "completed" || t.status === "aborted") && (
  <div className="text-[10px] text-[var(--text-secondary)] truncate">
    {t.completion_reason}
  </div>
)}
```

## 使用示例

### 场景 1: Loop 正常完成

用户创建一个 Loop 来修复代码错误：

```
Exit Conditions:
- No errors matching: /error|failed|warning/
- Max iterations: 10
```

当 Loop 完成时，用户会看到：

```
✓ Loop completed
No errors matching pattern /error|failed|warning/ found

📝 Changes made
Edited 5 files, Ran 2 command(s)
```

### 场景 2: Loop 被用户中止

用户点击 "Stop" 按钮：

```
⚠ Loop stopped
Stopped by user
```

### 场景 3: Loop 被系统中断

应用关闭或系统重启：

```
⚠ Loop stopped
Loop interrupted by system shutdown
```

### 场景 4: Loop 达到最大迭代次数

```
✓ Loop completed
Reached maximum iteration count (50 iterations)

📝 Changes made
Edited 8 files, Created 2 files, Ran 12 command(s)
```

### 场景 5: Loop 出错

```
⚠ Loop stopped
Iteration failed: Failed to connect to Anthropic API: timeout
```

## 设计考虑

1. **向后兼容**: 新字段使用 `Option<String>` 和默认值，不会破坏现有数据
2. **信息分层**: 
   - 在列表中显示简要原因（一行）
   - 在详情面板中显示完整信息和改动摘要
3. **视觉区分**:
   - 完成: 绿色边框和图标
   - 中止: 橙色边框和警告图标
   - 改动摘要: 蓝色边框和文档图标
4. **用户友好**: 使用自然语言描述，避免技术术语

## 扩展性

未来可以基于这些基础功能进行扩展：

1. 更详细的改动清单（具体修改了哪些文件）
2. 错误分类（网络错误、配置错误、权限错误等）
3. 改动预览（显示 diff 摘要）
4. 通知系统集成（Loop 完成时发送带原因的通知）
