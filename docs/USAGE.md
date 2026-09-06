# dsh-per 使用指南

本文面向已经安装 dsh-per 的用户，目标是从“插件已安装”走到“能稳定使用多模型编排”。

## 1. dsh-per 如何工作

dsh-per 不会把所有消息都无条件接管。它先经过 Gate 判断，再决定透传还是进入编排。

进入编排后的主链：

```text
Plan
  → Plan Audit（可选）
  → Execute
  → Review
  → Mechanical Verify
  → Fix / Replan / Done
```

如果未配置 `stages`，插件保持 inert / passthrough。

## 2. 第一次启用

推荐先配置三个核心阶段：

```yaml
- id: per
  config:
    mode: auto
    stages:
      plan:
        model: vendor/planner-model
        reasoning_effort: high
      execute:
        model: vendor/executor-model
        reasoning_effort: low
      review:
        model: vendor/reviewer-model
        reasoning_effort: high
```

然后进入 DSH 会话执行：

```text
/orch status
```

你应该能看到当前模式、plan / execute / review 模型、预算和活动任务。

## 3. `/per`：最简单的入口

### 强制编排一个任务

```text
/per 重构这个模块，保持外部 API 不变，并在完成后执行测试
```

这会绕过 Gate，直接进入编排。

### 本会话全部编排

```text
/per on
```

之后本会话的普通输入都会进入编排。

### 本会话全部透传

```text
/per off
```

适合临时回到普通模型对话。

### 恢复自动判断

```text
/per auto
```

恢复 Gate 自动分流。

### 查看 `/per` 当前状态

```text
/per
```

不带参数时会显示用法和当前会话模式。

## 4. `/orch`：编排控制面

### 查看状态

```text
/orch status
```

显示：

- 当前模式；
- plan / execute / review 模型；
- plan audit 模型（如配置）；
- 今日预算使用情况；
- 活动任务、状态、修复轮次与审计跳过次数。

### 强制启动任务

```text
/orch task 修复当前项目的 CI，并验证所有测试
```

与 `/per <任务>` 类似，直接进入编排。

### 下一条消息临时透传

```text
/orch passthrough
```

只影响下一条消息，之后恢复原有模式。

### 终止当前任务

```text
/orch abort
```

会请求取消当前 session 的活动编排任务，并走统一取消/settle 流程。

### 查看预算

```text
/orch budget
```

显示今日编排估算消耗和透传观测消耗。

## 5. 会话级临时切换模型

不修改全局配置，临时覆盖当前 session：

```text
/orch set plan=vendor/model-a execute=vendor/model-b review=vendor/model-c
```

可以只修改其中一部分：

```text
/orch set review=vendor/model-c
```

清除当前会话覆盖：

```text
/orch reset
```

把当前会话的 stage model 覆盖保存为后续默认：

```text
/orch save
```

配置优先级：

```text
当前会话 /orch set
  > Settings 用户配置
  > saved-overrides.json
  > profile patch
  > schema 默认值
```

## 6. 典型使用场景

### 场景 A：代码重构

```text
/per 梳理当前模块职责，提出最小风险重构方案，完成代码改造并执行类型检查和测试
```

适合：

- 大文件拆分；
- 架构边界调整；
- 热路径优化；
- API 保持兼容的内部改造。

建议同时配置 `mechanical_verification`。

### 场景 B：复杂 Bug 修复

```text
/per 根据真实日志定位根因，修复后检查同类路径，并运行相关测试
```

dsh-per 会让 planner 先形成路径，再由 executor 修改，reviewer 独立复核。

### 场景 C：发布前检查

```text
/per 检查当前版本是否达到发布条件，修复阻塞问题，并执行 build 和 test
```

建议开启：

- plan audit；
- review；
- compile/tests/lint；
- 任务预算上限。

### 场景 D：高风险目录

通过 `risk_profile.sensitive_paths` 标记 auth / payment / security 等区域，让风险判断更保守。

### 场景 E：只想普通问答

直接：

```text
/per off
```

或者：

```text
/orch passthrough
```

## 7. Plan Audit 怎么用

最多可以配置两个审计模型：

```yaml
stages:
  plan:
    model: vendor/planner
  execute:
    model: vendor/executor
  review:
    model: vendor/reviewer
  plan_audit:
    - model: vendor/auditor-a
      reasoning_effort: high
    - model: vendor/auditor-b
      reasoning_effort: high
```

计划审计主要检查：

- feasibility；
- granularity；
- risk coverage；
- file consistency。

审计增强能力失败时采用 fail-open，不让审计服务永久阻塞主任务；相关跳过会被记录。

## 8. Mechanical Verification 怎么用

示例：

```yaml
mechanical_verification:
  enabled: true
  commands:
    compile: pnpm run build
    tests: pnpm test
    lint: pnpm run lint
  timeout_ms: 120000
  parallel: false
```

注意：当前 schema 中 `compile` / `tests` / `lint` 是**命令字符串**，不是 `{ cmd, cwd }` 对象。

reviewer 判断通过，但机械验证失败时，任务不会被伪装成成功，而是进入对应修复路径。

## 9. 预算怎么配

```yaml
budget:
  daily_limit_cny: 50
  task_limit_cny: 5
  count_passthrough: false
```

对自定义模型建议提供价格：

```yaml
budget:
  pricing:
    vendor/model-a:
      input: 1.0
      output: 2.0
```

价格单位为每百万 token 的人民币价格。

## 10. 推荐的起步策略

第一次使用不要一开始就把所有功能都拉满。推荐：

1. 先配置 plan / execute / review；
2. 用 `/per <任务>` 做手动强制编排；
3. 确认 `/orch status` 与预算正常；
4. 再开启机械验证；
5. 最后按需要增加 plan audit、fallback、敏感路径和更严格预算。

## 11. 任务结果如何理解

常见终态：

- `Done`：通过当前规则完成；
- `Flagged`：仍有未完全解决问题，但按配置允许带风险报告交付；
- `Abort`：预算、循环、用户取消或其他安全条件触发终止。

原则是：**无法验证时宁可明确 flagged / abort，也不隐式伪造成功。**

## 12. 下一步

- 完整配置：[CONFIGURATION.md](CONFIGURATION.md)
- 安装/升级/卸载：[INSTALLATION.md](INSTALLATION.md)
- 问题排查：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
