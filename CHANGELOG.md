# Changelog

## 0.3.0（2026-09-06）

重构批（依据 `docs/重构方案-v2.md` / `docs/重构方案-v3.md`）：

### 结构

- **engine.ts 模块拆分**：1683 行胶水层拆为 `src/engine/`（ctx / hooks / prompts / review / audit / accounting / commands / child-run / system-prompt / util / notify / events / request / recovery），`engine.ts` 最终降至 **698 行**（v3 目标 ≤700 达成）；所有 `transition()` 发射仍集中于 engine.ts，模块经 `fire` 回调驱动 FSM。
- **宿主契约类型化**：`TaskEventName` 接线到 `transition()`（E2）；`AnyAgent` 用途收敛；`SettingsService.effect` 死字段删除（E4）；`probe.ts` 移出 src/ 至 `scripts/`（E8）。

### 正确性

- **敏感路径 glob 边界修复**（A1）：`**/auth/**` 现在匹配顶层 `auth/login.ts`（旧正则 `.*\/` 强制前置斜杠导致顶层文件漏判 → 走 quick channel 绕过复核）；星号翻译改为单趟替换（`**`→`.*` 与 `*`→`[^/]*` 不再互相污染）。
- **`review/deadlock` 补 fallback**（E5）：retry 与 fix_cycle 双耗尽时保守交付 flagged 而非 `guard_rejected` 强制中止。
- **`withTimeoutDispose`**（A4）：dispose 恰好一次；子代理异常不再被静默吞成 deadlock（日志留痕）。
- **异步监听器统一 guard**（A3）：`agent/request` / `agent/request-error` / `agent/turn-stopping` 的 rejection 不再能杀死长驻宿主。
- **墙钟熔断脱离 usage 上报**（E9）：`turn/start` 独立检查 `wall_clock_max_min`，不记账的调用不再豁免。
- **task 级预算预检**（E10/D4）：剩余预算不足任务限额 50% 时启动前拒绝。
- **快照节流落盘**（P1-13）：中间态合并写（每 tick 一次），终态/abandoned 同步落盘，exit 兜底 flush。
- **机械验证**（P1-14）：AbortSignal 即时 SIGKILL；`summarizeTests` 仅用于 tests；lint 实装并计入结果与 quick channel。
- **`estimateTokens` CJK 感知**（P2-09）：CJK ≈1.6 chars/token，混合文本不再低估 2–3×。
- **空壳 hook 清理**（E11）：`lockBudgetSnapshot` / `supplementReview` / `redispatchReviewer` 移除，副作用由内联路径承担。

### 功能/配置语义（死配置全部接线）

- `review.input_token_budget`：复核 prompt 三级裁剪（全文 → 骨架计划 → 纯产物统计）（P1-10）。
- **分片复核**（P1-10）：>12 文件或 >800 diff 行按文件分片并行派发（≤4 片），`mergeShardedVerdicts` 保守合并。
- `fix_loop.strategy: incremental|batch`（C1）、`fix_loop.exhausted_delivery: flagged|abort`（C2）、`fix_loop.minor_issues: report_only|fix`（C3）、`stages.review.dimensions: full|defects_only|consistency_only`（C4）、`budget.on_exhausted: abort|flagged`（C5）、`visibility.progress: milestone_push|quiet`（C6）——默认值即旧行为。
- `circuit_breaker.audit_dispatch_timeout_ms`（默认 180s，与复核超时拆分，P2-04）。
- `limits.execution_log_max`（裁剪阈值配置化，P2-07）、`mechanical_verification.parallel`（P2-10）。

### 清理

- 删除死配置 `plan_protocol`、`concurrency.max_parallel_tasks`（P1-06/P1-11）；删除死 API `SnapshotStore.archive` / `TaskRegistry.create/activeTasks/snapshotOf` / `OrchestratorTask.seq` / `STEP_GUARDS`（P2-16/17）。
- `package.json`：`./probe` 导出移除、`dsh-llm` 重复声明移除、`pretest`/`prepublishOnly` 拆分（P2-01/02/03）。

### 工程化

- `.github/workflows/ci.yml`（tsc + vitest + ci:checks）；`ci-checks` 迁移表门禁 6 项不变量（新增变体行可达性 + 构建新鲜度），并改为直接校验 `src/` 源码（B1/B2）。
- 测试 110 → **142** 用例（fsm 28 / units 63 / web-bundle 10 / engine-gate 10 / engine-turn 10 / refactor-v2 18 / refactor-v3 10... 实际计数以 `pnpm test` 输出为准）。

## 0.2.0（2026-09-06）

- P0 全清：ADR #18 修复升级接通（fixEscalated 写回 + fixer 降级链）；价格表可配置（`budget.pricing` / `budget.pricing_unknown`）+ 未计价模型一次性告警；`transition()` 整体入队串行化；引擎依赖注入（`host-contract.ts` + fs/clock/subagents/spawner 四件套）与引擎单测骨架。
- P1 大部分：replan 耗尽可达性、子会话内存泄漏清理、Gate 坏正则容错、排队启动文案、中止原因映射细分、复核/审计超时与 prompt 预算、`plan_protocol` 之外死配置的第一轮清理。
- 测试 72 → 110 用例。

## 0.1.0（2026-09-05）

- 首个功能完整版本（设计定稿 v5.3）：三阶段流水线 FSM、fenced 计划协议、v5.2 计划审计协商、预算/熔断/降级链、机械验证、快照持久化与恢复、`/orch` 与 `/per` 命令、设置界面卡片。
- E2E：5 业务场景 + 5 审计场景 + 配置隔离回归（见 `docs/E2E测试报告-v0.1.0.md`）。
