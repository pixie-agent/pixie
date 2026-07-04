# Loop 功能改进测试计划

## 测试场景

### 1. 正常完成场景

#### 测试 1.1: 达到最大迭代次数
**步骤**:
1. 创建一个 Loop，设置退出条件为 "Max iterations: 5"
2. 设置一个不会提前满足的其他条件
3. 启动 Loop
4. 等待 Loop 完成

**预期结果**:
- Loop 状态变为 "Completed"
- 显示: "✓ Loop completed"
- 显示: "Reached maximum iteration count (5 iterations)"
- 如有文件操作，显示 "📝 Changes made" 和统计信息

#### 测试 1.2: 成功模式匹配
**步骤**:
1. 创建 Loop，初始 prompt 为 "打印 'All tests passed'"
2. 添加退出条件 "Success pattern: /passed|success/i"
3. 启动 Loop

**预期结果**:
- Loop 状态变为 "Completed"
- 显示: "Success pattern /passed|success/i matched"

#### 测试 1.3: 无错误模式
**步骤**:
1. 创建修复错误类型的 Loop
2. 设置 "No error pattern: /error|failed/i"
3. 启动 Loop

**预期结果**:
- 当输出不再匹配错误模式时完成
- 显示: "No errors matching pattern /error|failed/i found"

#### 测试 1.4: 输出不变
**步骤**:
1. 创建 Loop，设置 "Output unchanged: 2"
2. 添加其他保证会快速收敛的 prompt
3. 启动 Loop

**预期结果**:
- 当连续 2 次输出相同时完成
- 显示: "Output unchanged for 2 consecutive iteration(s)"

---

### 2. 用户中止场景

#### 测试 2.1: 用户点击 Stop
**步骤**:
1. 创建并启动一个 Loop
2. 在运行中点击 "Stop" 按钮
3. 确认对话框中点击确认

**预期结果**:
- Loop 状态变为 "Aborted"
- 显示: "⚠ Loop stopped"
- 显示: "Stopped by user"
- Loop 保持 enabled 状态，可以重启

#### 测试 2.2: 用户点击 Discard
**步骤**:
1. 创建并启动一个 Loop
2. 点击 "Pause"
3. 点击 "Discard"
4. 确认对话框

**预期结果**:
- Loop 状态变为 "Aborted"
- 显示: "Discarded by user"
- Loop 变为 disabled 状态

---

### 3. 系统中断场景

#### 测试 3.1: 应用关闭时 Loop 正在运行
**步骤**:
1. 创建并启动一个 Loop
2. 不等待完成，关闭应用
3. 重新打开应用

**预期结果**:
- Loop 状态应为 "Aborted"
- 显示: "Loop interrupted by system shutdown"
- Loop 可以重启

---

### 4. 错误场景

#### 测试 4.1: API 错误
**步骤**:
1. 创建 Loop，使用无效的 API 配置
2. 启动 Loop

**预期结果**:
- Loop 状态变为 "Error"
- 显示错误原因，如: "Iteration failed: Failed to connect to API: ..."

#### 测试 4.2: 工作区不存在
**步骤**:
1. 创建 Loop，指向已删除的工作区
2. 启动 Loop

**预期结果**:
- Loop 状态变为 "Error"

---

### 5. 改动摘要测试

#### 测试 5.1: 文件编辑统计
**步骤**:
1. 创建 Loop，prompt 为 "编辑 src/a.ts, src/b.ts, src/c.ts"
2. 确保 Agent 使用 Edit 工具
3. 启动 Loop

**预期结果**:
- 完成/中止时显示: "Edited 3 files"

#### 测试 5.2: 文件创建统计
**步骤**:
1. 创建 Loop，prompt 为 "创建文件 new1.txt 和 new2.txt"
2. 启动 Loop

**预期结果**:
- 显示: "Created 2 files"

#### 测试 5.3: 命令执行统计
**步骤**:
1. 创建 Loop，prompt 为 "运行 npm install, npm test"
2. 启动 Loop

**预期结果**:
- 显示: "Ran 2 command(s)"

#### 测试 5.4: 混合操作
**步骤**:
1. 创建 Loop 执行多种操作
2. 启动 Loop

**预期结果**:
- 显示类似: "Edited 5 files, Created 2 files, Ran 3 command(s)"

---

### 6. UI 显示测试

#### 测试 6.1: 列表显示
**检查项**:
- 任务列表中 completed/aborted 任务显示完成原因
- hover 时显示完整原因
- 文本过长时正确截断

#### 测试 6.2: 详情面板显示
**检查项**:
- Completion reason 使用正确的颜色 (绿色=completed, 橙色=aborted)
- Changes summary 使用蓝色
- 图标正确显示
- 布局合理，不重叠

#### 测试 6.3: 空/缺失字段
**检查项**:
- 没有 completion_reason 的旧 Loop 正常显示
- 没有 changes_summary 时不显示该区块
- 不导致布局错误

---

## 回归测试

确保以下功能不受影响：

- [ ] Loop 创建
- [ ] Loop 编辑
- [ ] Loop 启动/重启
- [ ] Loop 暂停/恢复
- [ ] Loop 删除
- [ ] 定时 Loop 调度
- [ ] Loop 迭代历史查看
- [ ] 多 Loop 并发运行
- [ ] Loop with note 功能

---

## 边界测试

### 数据持久化
- [ ] completion_reason 正确保存到 loop_tasks.json
- [ ] changes_summary 正确保存
- [ ] 应用重启后数据正确加载
- [ ] 新旧数据兼容

### 多语言
- [ ] 英文界面显示正常
- [ ] 中文界面显示正常

### 性能
- [ ] 改动摘要提取不显著影响 Loop 性能
- [ ] 大量迭代 (100+) 时 UI 响应正常
- [ ] 长输出 (50KB+) 正确截断

---

## 自动化测试建议

可以添加以下单元测试：

```rust
#[test]
fn test_format_exit_condition_met_max_iterations() {
    let conditions = vec![LoopExitCondition::MaxIterations { max: 10 }];
    let result = "some output";
    let reason = format_exit_condition_met(&conditions, 10, result, 0);
    assert!(reason.contains("10 iterations"));
}

#[test]
fn test_format_exit_condition_met_success_pattern() {
    let conditions = vec![LoopExitCondition::SuccessPattern {
        pattern: "done".to_string(),
    }];
    let result = "All done!";
    let reason = format_exit_condition_met(&conditions, 1, result, 0);
    assert!(reason.contains("done"));
}

#[test]
fn test_extract_changes_summary_edits() {
    let result = r#"
Edit: src/main.rs
Editing src/lib.rs
Write: new_file.txt
Bash: npm test
"#;
    let summary = extract_changes_summary(result);
    assert!(summary.is_some());
    let s = summary.unwrap();
    assert!(s.contains("Edited"));
}
```

---

## 测试清单

完成所有测试后检查：

- [ ] 所有 6 个主要场景测试通过
- [ ] 所有回归测试通过
- [ ] 所有边界测试通过
- [ ] UI 在不同尺寸窗口下正常显示
- [ ] 深色/浅色主题下显示正常
- [ ] 文档完整且准确
