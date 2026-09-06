# dsh-per 配置参考

当前正式版本：**v0.1.0**。

本文按当前 `src/config/schema.ts` 整理配置项。所有运行示例默认假设插件已经安装到 DSH Web 的 `web` profile：

```bash
dsh plugin --profile web add dsh-per@0.1.0
dsh --profile web
```

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

会话内还可通过 `/per on`、`/per off`、`/per auto` 覆盖。

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

字段含义：

- `passthrough_patterns`：优先透传模式；
- `orchestrate_patterns`：倾向进入编排的模式；
- `modify_intent_verbs`：修改意图词；
- `short_len` / `long_len`：文本长度阈值；
- `default`：无法明确判断时使用 `orchestrate` 或 `passthrough`。

坏正则会被安全跳过并告警。

## 5. `stages`

通用字段：

```yaml
model: vendor/model
provider: optional-provider
reasoning_effort: medium
on_failure: auto_degrade
fallback_chain: []
```

- `model`：模型标识；
- `provider`：可选 provider；
- `reasoning_effort`：`off | low | medium | high | max`；
- `on_failure`：`hard_fail | auto_degrade`；
- `fallback_chain`：失败后的模型候选数组。

### plan

```yaml
stages:
  plan:
    model: vendor/planner
    reasoning_effort: high
    on_failure: hard_fail
```

### execute

```yaml
stages:
  execute:
    model: vendor/executor
    reasoning_effort: low
    on_failure: auto_degrade
```

### review

```yaml
stages:
  review:
    model: vendor/reviewer
    reasoning_effort: high
    dimensions: full
    input_token_budget: 50000
```

`dimensions` 可选：

- `full`
- `defects_only`
- `consistency_only`

### plan audit

最多两个：

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

- `strategy`：`incremental | batch`；
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

当前 schema 中 `compile` / `tests` / `lint` 都是**字符串命令**，不要写成 `{ cmd, cwd }` 对象。

如果 tests 依赖 compile 输出，建议保持 `parallel: false`。

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

用于限制重试、重规划、执行步骤和快照中的日志规模。

## 9. `circuit_breaker`

```yaml
circuit_breaker:
  total_llm_calls_max: 40
  total_tokens_max: 800000
  wall_clock_max_min: 30
  review_dispatch_timeout_ms: 300000
  audit_dispatch_timeout_ms: 180000
```

避免单个任务无限消耗调用、token、时间，或被挂起的 reviewer/auditor 永久阻塞。

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

自定义价格：

```yaml
budget:
  pricing:
    vendor/model-a:
      input: 1.0
      output: 2.0
```

价格单位：人民币 / 百万 token。

未知模型也可以设置兜底价格：

```yaml
budget:
  pricing_unknown:
    input: 1.0
    output: 2.0
```

生产环境建议给自定义模型明确价格，否则预算护栏可能失真。

## 11. `visibility`

```yaml
visibility:
  progress: milestone_push
```

可选：

- `milestone_push`
- `quiet`

## 12. `risk_profile`

```yaml
risk_profile:
  sensitive_paths:
    - '**/auth/**'
    - '**/payment/**'
    - '**/security/**'
  high_diff_lines: 500
```

用于让敏感路径和较大 diff 进入更保守的风险判断。

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

`/orch set` 只覆盖 plan / execute / review 的 model。

具体示例：

```text
/orch set plan=vendor/planner execute=vendor/executor review=vendor/reviewer
```

## 15. 配置建议

- 初次使用先只配 plan / execute / review；
- provider 不支持某个 reasoning effort 时显式调整；
- 生产环境给自定义模型配置价格；
- 机械验证先串行；
- fallback chain 避免依赖模糊的跨 provider 解释；
- 敏感目录写成明确 glob。

## 16. 验证配置是否生效

启动 Web profile：

```bash
dsh --profile web
```

然后在会话中：

```text
/orch status
```

## 17. 相关文档

- [安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [故障排查](TROUBLESHOOTING.md)
