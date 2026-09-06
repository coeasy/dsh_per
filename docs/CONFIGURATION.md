# dsh-per 配置参考

本文按当前 `src/config/schema.ts` 整理 dsh-per 的配置项。当前正式版本为 **v0.1.0**。

## 1. 最小配置

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

如果 `stages` 缺失，插件保持 passthrough。

## 2. 顶层配置

当前顶层键：

```text
mode
gate
stages
fix_loop
mechanical_verification
limits
circuit_breaker
budget
visibility
risk_profile
```

## 3. `mode`

```yaml
mode: auto
```

可选：

- `auto`
- `passthrough`
- `gated`

会话内还可以用 `/per on|off|auto` 覆盖行为。

## 4. `gate`

```yaml
gate:
  passthrough_patterns:
    - '^(什么|为什么|怎么|如何)'
  orchestrate_patterns:
    - '(实现|重构|修复|新增|删除|迁移|编写|开发|优化)'
  modify_intent_verbs:
    - 改
    - 加
    - 删
    - 重构
    - 实现
    - 修复
    - 写
  short_len: 40
  long_len: 200
  default: orchestrate
```

说明：

- `passthrough_patterns`：优先透传模式匹配；
- `orchestrate_patterns`：倾向进入编排的模式；
- `modify_intent_verbs`：修改意图词；
- `short_len`：短文本阈值；
- `long_len`：长文本阈值；
- `default`：无法明确判定时使用 `orchestrate` 或 `passthrough`。

坏正则会被安全跳过并告警，不应拖垮插件启动。

## 5. `stages`

### 5.1 通用 stage 字段

```yaml
model: vendor/model
provider: optional-provider
reasoning_effort: medium
on_failure: auto_degrade
fallback_chain: []
```

字段：

- `model`：必填模型标识；
- `provider`：可选 provider；
- `reasoning_effort`：`off | low | medium | high | max`；
- `on_failure`：`hard_fail | auto_degrade`；
- `fallback_chain`：失败后的模型候选数组。

### 5.2 plan

默认：

- `reasoning_effort: high`
- `on_failure: hard_fail`

示例：

```yaml
stages:
  plan:
    model: vendor/planner
    reasoning_effort: high
    on_failure: hard_fail
```

### 5.3 execute

默认 `reasoning_effort: low`。

```yaml
stages:
  execute:
    model: vendor/executor
    reasoning_effort: low
    on_failure: auto_degrade
```

### 5.4 review

```yaml
stages:
  review:
    model: vendor/reviewer
    reasoning_effort: high
    dimensions: full
    input_token_budget: 50000
```

`dimensions`：

- `full`
- `defects_only`
- `consistency_only`

### 5.5 plan audit

可配置 0–2 个：

```yaml
stages:
  plan_audit:
    - model: vendor/auditor-a
      reasoning_effort: high
    - model: vendor/auditor-b
      reasoning_effort: high
```

为空或缺失时不启用计划审计。

## 6. `fix_loop`

```yaml
fix_loop:
  max_cycles: 3
  strategy: incremental
  escalate_after_consecutive_fails: 2
  exhausted_delivery: flagged
  minor_issues: report_only
```

字段：

- `max_cycles`：最大修复轮次；
- `strategy`：`incremental | batch`；
- `escalate_after_consecutive_fails`：连续失败多少次后升级处理；
- `exhausted_delivery`：`flagged | abort`；
- `minor_issues`：`report_only | fix`。

## 7. `mechanical_verification`

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

当前命令字段是字符串：

```text
compile?: string
tests?: string
lint?: string
```

不要写成 `{ cmd, cwd }` 对象。

- `timeout_ms`：单次机械验证超时上限；
- `parallel`：是否并行执行命令，默认 false。

如果 tests 依赖 compile 输出，建议保持串行。

## 8. `limits`

```yaml
limits:
  plan_retry_max: 2
  exec_retry_max: 2
  replan_cycle_max: 3
  planning_steps_max: 12
  executing_steps_max: 60
  execution_log_max: 200
```

用于限制重试、重规划、步骤数和快照中的执行日志规模。

## 9. `circuit_breaker`

```yaml
circuit_breaker:
  total_llm_calls_max: 40
  total_tokens_max: 800000
  wall_clock_max_min: 30
  review_dispatch_timeout_ms: 300000
  audit_dispatch_timeout_ms: 180000
```

目的：避免一个任务无限消耗调用、token、时间或被挂起的 reviewer/auditor 永久阻塞。

## 10. `budget`

```yaml
budget:
  daily_limit_cny: 50
  task_limit_cny: 5
  on_exhausted: abort
  count_passthrough: false
  pricing: {}
  pricing_unknown: null
```

### 自定义价格

```yaml
budget:
  pricing:
    vendor/model-a:
      input: 1.0
      output: 2.0
```

价格单位：人民币 / 百万 token。

### 未知模型价格

默认：

```yaml
pricing_unknown: null
```

也可以设置兜底价格：

```yaml
pricing_unknown:
  input: 1.0
  output: 2.0
```

如果模型既不在内置表也不在 `pricing` 中，而 `pricing_unknown` 为 null，该模型会以估算 ¥0 记账；这会降低预算护栏效果，因此生产环境建议给自定义模型明确价格。

## 11. `visibility`

```yaml
visibility:
  progress: milestone_push
```

可选：

- `milestone_push`：推送任务里程碑；
- `quiet`：中间过程尽量静默，只在关键终态发声。

## 12. `risk_profile`

```yaml
risk_profile:
  sensitive_paths:
    - '**/auth/**'
    - '**/payment/**'
    - '**/security/**'
  high_diff_lines: 500
```

用于标记敏感路径和较大 diff 阈值，帮助风险判断更保守。

## 13. 完整示例

```yaml
- id: per
  config:
    mode: auto

    gate:
      default: orchestrate
      short_len: 40
      long_len: 200

    stages:
      plan:
        model: vendor/planner
        reasoning_effort: high
      execute:
        model: vendor/executor
        reasoning_effort: low
      review:
        model: vendor/reviewer
        reasoning_effort: high
        dimensions: full
        input_token_budget: 50000
      plan_audit:
        - model: vendor/auditor
          reasoning_effort: high

    fix_loop:
      max_cycles: 3
      strategy: incremental
      exhausted_delivery: flagged
      minor_issues: report_only

    mechanical_verification:
      enabled: true
      commands:
        compile: pnpm run build
        tests: pnpm test
      timeout_ms: 120000
      parallel: false

    limits:
      plan_retry_max: 2
      exec_retry_max: 2
      replan_cycle_max: 3
      planning_steps_max: 12
      executing_steps_max: 60
      execution_log_max: 200

    circuit_breaker:
      total_llm_calls_max: 40
      total_tokens_max: 800000
      wall_clock_max_min: 30
      review_dispatch_timeout_ms: 300000
      audit_dispatch_timeout_ms: 180000

    budget:
      daily_limit_cny: 50
      task_limit_cny: 5
      count_passthrough: false

    visibility:
      progress: milestone_push

    risk_profile:
      sensitive_paths:
        - '**/auth/**'
        - '**/payment/**'
        - '**/security/**'
      high_diff_lines: 500
```

## 14. 配置优先级

```text
会话 /orch set
  > Settings 用户配置
  > saved-overrides.json
  > profile patch
  > schema 默认值
```

`/orch set` 当前只覆盖 plan / execute / review 的 model。

## 15. 配置建议

- 初次使用先只配 plan / execute / review；
- provider 不支持某个 reasoning effort 时显式调整，不要假设所有 provider 都支持同一档位；
- 生产环境给自定义模型配置价格；
- 机械验证先串行，确认任务互不依赖后再考虑 parallel；
- fallback chain 当前仍应避免依赖模糊的跨 provider 解释；
- 敏感目录尽量写成明确 glob。

## 16. 相关文档

- [安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [故障排查](TROUBLESHOOTING.md)
