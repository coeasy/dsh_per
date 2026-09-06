# dsh-per 项目功能梳理与重构计划

> 当前正式版本：`v0.1.0`  
> 日期：2026-09-06  
> 原则：所有改造默认继续归档在 `v0.1.0`，除非用户明确决定改变版本策略。

## 1. 项目定位

`dsh-per` 是 DSH 的多模型任务编排插件。它不是简单的模型切换器，而是把一个复杂任务组织成可验证、可修复、可降级、可记账的执行流水线。

核心目标：

1. 复杂任务先规划，再执行，再独立复核；
2. 对计划与结果建立结构化协议；
3. 对模型失败、超时、预算耗尽和机械验证失败提供确定性处理；
4. 插件故障不能拖垮宿主；
5. 默认配置保持 inert，不主动接管普通会话；
6. 运行时与发布版本都必须可审计。

## 2. 主体功能链

```text
User Input
   │
   ▼
Gate / Session Mode
   │
   ├─ passthrough ───────────────┐
   │                             │
   ▼                             │
Task Scheduler                   │
   │                             │
   ▼                             │
FSM                              │
   │                             │
   ▼                             │
Plan ──► Plan Audit(optional)    │
   │                             │
   ▼                             │
Execute                          │
   │                             │
   ▼                             │
Review                           │
   │                             │
   ▼                             │
Mechanical Verify               │
   │                             │
   ├─ fail → Fix / Replan ───────┤
   │                             │
   ▼                             │
Done / Flagged / Abort           │
   │                             │
   ▼                             │
Accounting + Snapshot + Settle ◄─┘
```

## 3. 模块职责

### 3.1 `src/engine.ts`

职责：

- createEngine；
- 宿主 listener 注册；
- Global runtime mutable state；
- settings/saved/session 配置层组合；
- task 生命周期；
- 所有 FSM transition 的统一发射；
- settle 与恢复入口。

约束：

- 子模块不能自己绕过 engine 发射状态迁移；
- engine 不应重新膨胀成业务细节集合。

### 3.2 `src/engine/*`

主要子模块：

- `accounting.ts`：用量、价格、预算事件；
- `audit.ts`：计划审计调度；
- `review.ts`：复核与分片复核；
- `request.ts`：请求中间件、重试与错误；
- `commands.ts`：`/orch` 命令；
- `hooks.ts`：迁移动作；
- `prompts.ts`：结构化 prompt；
- `recovery.ts`：启动恢复；
- `events.ts`：session/turn 事件；
- `system-prompt.ts`：宿主系统提示注入。

原则：模块尽量无共享闭包状态，通过 `EngineCtx` 和显式参数工作。

### 3.3 `src/task/*`

- `transition-table.ts`：状态迁移 SSOT；
- `fsm.ts`：任务状态、计数器、transition 执行；
- `registry.ts`：任务注册与 scheduler。

任何新增状态、事件、fallback、guard 都必须先修改 transition table，并通过结构门禁。

### 3.4 `src/protocols/*`

- plan：计划 schema 与解析；
- plan-audit：审计 schema、协商与合并；
- review：复核 verdict；
- mechanical：compile/lint/tests 外部命令验证。

### 3.5 `src/gate/*`

负责：

- forced；
- passthrough flag；
- passthrough pattern；
- orchestrate pattern；
- 短句策略；
- 长文本策略；
- 保守默认。

Gate 是进入 FSM 前的第一层控制，不承担任务状态职责。

### 3.6 `src/router/*`

负责：

- stage → model binding；
- model health；
- circuit breaker；
- fallback chain。

### 3.7 `src/budget/*`

负责：

- daily / task 金额；
- passthrough 观测与可选计入；
- token/call/wall-clock 相关数据；
- 价格解析和台账持久化。

### 3.8 `src/persistence/*`

当前负责任务快照。后续需要进一步补 snapshot schema 版本、字段级校验与事件流。

### 3.9 `src/settings/*` + `web/*`

负责 Settings → Plugins 的常用参数配置，并保持与 patch 配置分层一致。

## 4. 当前已经完成的收敛

### 正确性

- Gate 坏正则 fail-safe；
- 敏感路径 glob 边界修复；
- FSM transition 串行化；
- deadlock 保守 fallback；
- plan/review/audit 派发超时；
- request error retry 有界；
- 机械验证取消和超时；
- reviewer 通过但机械失败不会伪造成功；
- task budget 启动预检；
- wall-clock breaker 脱离 usage 上报；
- passthrough 计费配置真实接线。

### 可维护性

- engine 大文件已拆分为模块；
- transition table 保持单一权威；
- 配置声明必须被源码消费的结构门禁已存在；
- 已删除多批死配置、死 API 和误导性空 hook；
- 依赖注入 seam 支持 clock/fs/subagent/spawner 测试替身。

### 测试

已有：

- FSM tests；
- units；
- engine gate；
- engine turn；
- Web bundle；
- 多轮重构 regression；
- E2E 基线报告。

## 5. 当前主要风险

### P0：发布工程

1. CI 的无 lockfile 策略与 frozen install/cache 之前互相矛盾；
2. CI summary shell 引号曾导致 job 额外失败；
3. 没有自动 GitHub Release / npm 发布链；
4. 缺少版本 SSOT，导致内部重构编号被误当成发布版本。

本轮全部修复。

### P1：恢复健壮性

当前快照恢复主要依赖 JSON 可解析和字段默认值，缺少显式 snapshot schema version 与完整 normalize。

风险：旧格式、部分写入或人工破坏的快照可能进入未定义状态。

### P1：可观测性

目前快照能看到最终状态，但缺乏独立 task event stream；排查一个任务经历了哪些 transition、fallback、审计跳过与修复轮次仍不够直接。

### P1：配置诊断

schema 对未知键宽容时，用户拼错配置可能被静默丢弃。需要启动阶段 unknown-key warning。

### P2：并发模型

scheduler 当前严格单任务串行，安全但吞吐有限。后续若增加并发，必须先把 runtime state 明确拆为 Global / Session / Task 三种生命周期，不能直接放开 scheduler。

### P2：provider 绑定

fallback chain 仍依赖默认 provider 语义，不适合隐式跨 provider 降级。

### P2：i18n

部分提示、里程碑与审计文案为中文硬编码。

## 6. 重构计划

## Phase A — 发布与版本治理（本轮）

目标：先建立可信交付链，不改变核心运行时语义。

### A1 版本 SSOT

- 根目录 `VERSION = 0.1.0`；
- `package.json.version = 0.1.0`；
- `scripts/check-version.mjs`；
- CI / prepublish 执行 version contract；
- Release workflow 只能创建 `v0.1.0`。

### A2 CI 修复

- 保持当前无 lockfile 仓库策略；
- 因此关闭 setup-node 的 pnpm cache；
- 安装使用 `pnpm install --no-frozen-lockfile`；
- typecheck / tests / build / ci:checks 全部为硬门禁；
- 修复 summary shell。

### A3 Release workflow

顺序：

```text
version check
→ install
→ typecheck
→ tests
→ build
→ ci:checks
→ npm pack
→ npm publish（已配置 token 且 registry 尚无该版本时）
→ GitHub Release + tarball
```

要求重复运行安全：已有 npm 包或已有 GitHub Release 时不能造成重复发布失败。

## Phase B — 持久化与恢复

### B1 Snapshot schema version

为 `TaskSnapshot` 增加固定 schema version，而不是把它与插件发布版本绑定。

### B2 normalize / quarantine

新增 `normalizeSnapshot(raw)`：

- 校验 id/session/state/counters/arrays；
- 缺省字段按兼容规则补齐；
- 非法快照隔离为 `.corrupt`；
- 恢复失败只影响对应任务，不能阻塞插件启动。

### B3 原子写与恢复测试

补：

- 半写 JSON；
- 字段缺失；
- 非法状态；
- 旧 schema；
- 多快照混合恢复。

## Phase C — 可观测性

### C1 Task event stream

建立追加式 JSONL：

- taskId；
- timestamp；
- event；
- from/to；
- counters；
- fallback/degraded metadata。

做有界滚动，不无限增长。

### C2 `/orch diag`

输出：

- 活动任务；
- 最近 transition；
- 模型健康/熔断；
- 预算；
- degraded stages；
- last review error；
- audit skipped；
- 最近 event stream 摘要。

### C3 日志 taskId

所有任务级 warn/error/info 统一携带 taskId，便于长驻宿主过滤。

## Phase D — 质量门禁

### D1 Coverage

引入 coverage 统计，先建立当前真实基线，再逐步提高，不为了阈值编写无意义测试。

### D2 Lint / format

引入单一静态工具，避免多个 formatter/linter 冲突。

### D3 TypeScript 收紧

逐步打开更严格的 optional property 语义，单独提交、只修类型，不混合运行时改造。

### D4 Package content gate

发布前验证 tarball 必须包含：

- `lib/`；
- `cordis.patch.yml`；
- `web/dist/client.js`；
- package metadata。

## Phase E — 配置治理

### E1 全配置参考

新增统一配置参考，覆盖 schema 叶子键：

- 类型；
- 默认值；
- 语义；
- 适用层；
- 示例；
- 是否在 Settings UI 暴露。

### E2 文档一致性门禁

schema 新增配置键时，配置参考必须同步，否则 CI 失败。

### E3 Unknown-key warning

启动时对用户 raw config 做已知键 diff；拼错键只告警，不让插件崩溃。

## Phase F — 核心演进

只有前五个 Phase 稳定后再做。

### F1 Runtime state 分层

明确：

- GlobalState；
- SessionState；
- TaskState。

先分生命周期，再考虑并发。

### F2 会话级并发

从固定单任务 scheduler 演进为可配置并发；默认值仍保持 1，兼容当前安全行为。

### F3 Provider-aware fallback

fallback binding 显式携带 provider + model，不依赖隐式默认 provider。

### F4 可选 checkpoint resume

默认继续安全放弃旧任务；只有在 snapshot schema、幂等性和外部副作用回放规则完成后，才允许可选 resume。

### F5 i18n/resource layer

将用户可见固定文本与执行逻辑分离。

## 7. 每轮改造的硬门禁

每个批次必须满足：

1. `pnpm run version:check`；
2. TypeScript clean；
3. 全量 tests green；
4. build green；
5. `ci:checks` green；
6. Git 安装仍能直接加载预编译 `lib` + Web client；
7. 不改变 `v0.1.0`，除非用户明确要求；
8. 不以“重构”为理由改变默认运行时语义。

## 8. 本轮合并范围

本轮只合并：

- 版本统一；
- CI 修复；
- 发布 workflow；
- README / CHANGELOG / 版本策略；
- 当前项目梳理与重构计划。

不修改 FSM、Gate、review、audit、budget 等核心运行时行为，降低发布回归风险。
