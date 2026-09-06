# dsh-per 使用指南

当前正式版本：**v0.1.0**。

本文所有 DSH 命令默认使用 `web` profile。

## 1. 先确认插件已安装

```bash
dsh plugin --profile web list --depth 0
```

应能看到：

```text
dsh-per 0.1.0
```

然后启动同一个 Web profile：

```bash
dsh --profile web
```

## 2. dsh-per 如何工作

dsh-per 不会把所有消息都无条件接管。它先经过 Gate，再决定透传还是进入编排。

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

## 3. 第一次启用

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

在 DSH Web 会话中执行：

```text
/orch status
```

你应该能看到当前模式、plan / execute / review 模型、预算和活动任务。

## 4. `/per`：最简单的入口

强制编排一个具体任务：

```text
/per 重构当前模块，保持外部 API 不变，并在完成后执行测试
```

本会话全部进入编排：

```text
/per on
```

本会话全部透传：

```text
/per off
```

恢复 Gate 自动判断：

```text
/per auto
```

查看当前会话模式：

```text
/per
```

## 5. `/orch`：编排控制面

查看状态：

```text
/orch status
```

强制启动任务：

```text
/orch task 修复当前项目 CI，并验证所有测试
```

下一条消息临时透传：

```text
/orch passthrough
```

查看预算：

```text
/orch budget
```

终止当前任务：

```text
/orch abort
```

## 6. 会话级临时切换模型

具体示例：

```text
/orch set plan=vendor/planner execute=vendor/executor review=vendor/reviewer
```

只切换 reviewer：

```text
/orch set review=vendor/reviewer-v2
```

清除当前会话覆盖：

```text
/orch reset
```

保存当前 stage model 覆盖：

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

## 7. 典型使用场景

### 代码重构

```text
/per 梳理当前模块职责，提出最小风险重构方案，完成代码改造并执行类型检查和测试
```

### 复杂 Bug 修复

```text
/per 根据真实日志定位根因，修复后检查同类路径，并运行相关测试
```

### 发布前检查

```text
/per 检查当前版本是否达到发布条件，修复阻塞问题，并执行 build 和 test
```

### 高风险目录

通过 `risk_profile.sensitive_paths` 标记 auth / payment / security 等区域，让风险判断更保守。

### 临时普通问答

```text
/per off
```

或者只透传下一条：

```text
/orch passthrough
```

## 8. Plan Audit

最多可配置两个审计模型：

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

主要检查：

- feasibility；
- granularity；
- risk coverage；
- file consistency。

审计服务失败时按 fail-open 规则继续主任务，并记录跳过信息。

## 9. Mechanical Verification

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

当前 schema 中 `compile` / `tests` / `lint` 都是**命令字符串**。

reviewer 判断通过但真实命令失败时，任务仍进入修复路径，不会伪装成成功。

## 10. 预算

```yaml
budget:
  daily_limit_cny: 50
  task_limit_cny: 5
  count_passthrough: false
```

自定义模型建议配置价格：

```yaml
budget:
  pricing:
    vendor/model-a:
      input: 1.0
      output: 2.0
```

价格单位：人民币 / 百万 token。

## 11. 推荐起步流程

1. 安装：`dsh plugin --profile web add dsh-per@0.1.0`；
2. 启动：`dsh --profile web`；
3. 配置 plan / execute / review；
4. 执行 `/orch status`；
5. 执行一个具体 `/per ...` 任务；
6. 再逐步开启机械验证、plan audit、fallback 和更严格预算。

## 12. 任务结果

常见终态：

- `Done`：通过当前规则完成；
- `Flagged`：仍有未完全解决问题，但按配置允许带风险报告交付；
- `Abort`：预算、循环、用户取消或其他安全条件触发终止。

原则：**无法验证时宁可明确 Flagged / Abort，也不隐式伪造成功。**

## 13. 自定义 profile

如果你实际使用 `my-team` profile，请保证安装和启动都一致：

```bash
dsh plugin --profile my-team add dsh-per@0.1.0
dsh --profile my-team
```

其余命令逻辑完全相同。

## 14. 相关文档

- [安装指南](INSTALLATION.md)
- [配置参考](CONFIGURATION.md)
- [故障排查](TROUBLESHOOTING.md)
