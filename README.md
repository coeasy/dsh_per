# dsh-per

> 当前正式版本：**v0.1.0**  
> 仓库：`coeasy/dsh_per`

DSH 多模型编排插件。把复杂任务组织成“**规划 → 执行 → 复核**”流水线，并在外围提供计划审计、自动修复、机械验证、预算护栏、模型健康/降级、持久化恢复、会话命令与 Settings 配置。

仓库中的 `v1/v2/v3/v4/v5` 等字样只表示设计文档或内部重构轮次，**不是插件发布版本**。插件对外版本统一由根目录 `VERSION` 与 `package.json` 管理，当前固定为 `v0.1.0`。

## 主要功能

### 1. Gate 门禁与会话控制

- forced / passthrough / pattern / 短句 / 长文等固定顺序判定。
- `/per <任务>`：强制当前任务进入编排。
- `/per on|off|auto`：切换本会话编排模式。
- `/orch status|set|reset|save|budget|task|passthrough|abort`：管理编排与预算。
- 坏正则自动跳过并告警，不让错误配置拖垮插件启动。

### 2. Plan → Execute → Review 三阶段流水线

核心链路：

```text
用户输入
  → Gate
  → TaskScheduler
  → FSM
  → Plan
  → Plan Audit（可选）
  → Execute
  → Review
  → Mechanical Verify
  → Fix / Replan / Done
  → Accounting
  → Snapshot / settle
```

`src/task/transition-table.ts` 是状态迁移的唯一权威；`src/engine.ts` 保持所有 transition 的统一发射出口，子模块通过明确回调参与流程，不能直接绕过 FSM 修改状态。

### 3. 计划协议与计划审计

- 规划结果使用结构化协议并支持校验失败重试。
- 可配置 0–2 个计划审计模型。
- 审计问题使用稳定 issue id，覆盖 feasibility / granularity / risk coverage / file consistency。
- planner 可声明采纳或反驳，下一轮审计继续核验。
- 审计服务失败、超时或无结构化结论时 fail-open，主任务不会被增强能力永久阻塞。

### 4. 独立复核与自动修复

- reviewer 使用独立子代理和结构化输出。
- 大产物可按文件分片并行复核，再按最严缺陷、最低置信度保守合并。
- fix cycle、重规划、deadlock 都有明确预算和终态。
- 修复耗尽时按策略 flagged 交付或 abort，避免伪造成功。

### 5. 机械验证

支持：

- compile
- lint
- tests

能力包括：

- 每轮重新执行；
- 可并行；
- 超时按 unavailable；
- 任务取消时终止子进程；
- reviewer 通过但机械验证失败时仍进入机械修复路径。

### 6. 预算与模型健康

- 每日金额限制、任务金额限制。
- token / 调用数 / 墙钟熔断。
- 模型单价表与未知价格告警。
- 可选择将 passthrough 消耗计入每日限额。
- 模型健康窗口、熔断、半开与 fallback chain。

### 7. 持久化与生命周期

- 中间态快照合并写入，终态同步落盘。
- 启动时识别遗留非终态任务并安全标记为 abandoned/aborted，不重复执行旧任务。
- settle 时统一清理 child sessions、pending steer、request retries、agent 引用等运行态对象。
- 预算与会话观测记录均有有界清理策略。

### 8. Settings 与 Web 客户端

插件注册 `dsh-per` settings namespace，在 **Settings → Plugins** 提供常用配置：

- 模式；
- plan / execute / review 模型；
- 计划审计模型；
- 预算；
- 模型单价；
- 机械验证开关。

高级 gate / limits / circuit breaker / risk / fix-loop / visibility 参数继续由 patch 层管理，避免把所有内部策略暴露进 UI。

## 安装

### npm

发布到 npm 后：

```powershell
dsh plugin --profile <name> add dsh-per
```

### GitHub tag

```powershell
dsh plugin --profile <name> add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

### 本地目录

```powershell
dsh plugin --profile <name> add D:\path\to\dsh_per
```

## 基础配置

插件通过 `cordis.patch.yml` 插入 `per` 行。默认配置为空，因此没有 stages 时保持 inert / passthrough。

```yaml
- id: per
  config:
    mode: auto
    stages:
      plan:
        model: vendor/strong-model
        reasoning_effort: high
      execute:
        model: vendor/fast-model
        reasoning_effort: off
      review:
        model: vendor/reviewer-model
        reasoning_effort: high
      plan_audit:
        - model: vendor/auditor-model
          reasoning_effort: high
    mechanical_verification:
      enabled: true
      commands:
        compile:
          cmd: pnpm run build
          cwd: .
        tests:
          cmd: pnpm test
          cwd: .
      timeout_ms: 120000
    budget:
      daily_limit_cny: 5
```

配置优先级：

```text
会话 /orch set
  > settings 用户段
  > saved-overrides.json
  > 插件 patch config
  > schema 默认值
```

注意：settings 中未声明 reasoning effort 档位的模型，应显式配置 `reasoning_effort: off`，避免 provider 层拒绝未知档位。

## 代码结构

```text
src/
├── engine.ts                 # 宿主接线、共享状态、transition 唯一出口
├── engine/                   # review/audit/accounting/commands/request/... 子模块
├── task/                     # FSM、registry、transition table
├── protocols/                # plan / plan-audit / review / mechanical
├── gate/                     # 输入门禁
├── router/                   # 模型选择、健康与降级
├── budget/                   # 预算台账
├── persistence/              # 快照
├── settings/                 # Settings namespace / overlay
├── visibility/               # 里程碑与用户可见信息
└── config/                   # schema
```

架构原则：

1. FSM 是任务状态唯一权威。
2. `engine.ts` 持有宿主生命周期与 transition 发射权。
3. 配置只有一条解析链：schema → global layers → session override。
4. 外部副作用必须可超时、可取消、可降级。
5. 不可验证时 flagged/abort，不能隐式伪造成功。
6. 发布版本由 `VERSION` 唯一约束，当前固定 `v0.1.0`。

## 开发与门禁

```powershell
pnpm install --no-frozen-lockfile
pnpm run version:check
pnpm exec tsc --noEmit -p tsconfig.json
pnpm test
pnpm run build
pnpm run ci:checks
```

`version:check` 会阻止公共发布面再次出现未经批准的版本漂移。

## 已知限制

- 当前 scheduler 仍是单宿主严格串行，同一时间只运行一个编排任务。
- fallback chain 当前按部署默认 provider 解释，不提供跨 provider 显式绑定语法。
- 非终态任务在宿主重启后采用安全放弃策略，不做 checkpoint resume。
- 部分里程碑、提示与审计文案仍为中文硬编码。
- Settings UI 只覆盖常用配置，高级策略继续使用 patch。

## 当前重构计划

项目功能与后续重构计划见：`docs/PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md`。

版本策略见：`docs/VERSIONING.md`。

E2E 基线见：`docs/E2E测试报告-v0.1.0.md`。

## License

MIT
