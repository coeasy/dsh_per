# dsh-per

DSH 多模型编排插件：按「规划 → 执行 → 复核」三阶段流水线调度不同模型，内置自动修复回路、预算护栏与降级链（对应设计定稿 v5.0 + v5.1 修订单 + v5.2 计划审计扩展）。

## 安装（第三方）

包声明了 `dsh.bundle.patch`（`cordis.patch.yml`），被 profile 依赖后自动加入层栈。三种安装方式任选：

```powershell
# npm 发布后（推荐）
dsh plugin --profile <name> add dsh-per

# git 仓库
dsh plugin --profile <name> add git+https://github.com/<you>/dsh-per.git

# 本地目录 / tarball（pnpm add 语义）
dsh plugin --profile <name> add D:\path\to\dsh-per
```

然后在 profile 的 `cordis.patch.yml` 覆盖 `per` 行配置启用编排（见下），或在 **Settings → Plugins → 编排卡片** 里直接配置（v5.3 设置界面，配置写入 settings.yaml 的 `dsh-per` 键）。

bundle 默认插入的 `orchestrator` 行配置为空（全部 zod 默认值）——**无 stages 配置即 inert**（ADR #13：mode=auto 且无阶段模型时一律 passthrough）。在 profile 的 `cordis.patch.yml` 覆盖该行启用：

```yaml
- id: per
  config:
    mode: auto
    stages:
      plan:    { model: vendor/strong-model,  reasoning_effort: high }
      execute: { model: vendor/fast-model,    reasoning_effort: off }
      review:  { model: vendor/other-model,   reasoning_effort: high }
      # v5.2 计划审计（可选，0-2 个审计模型；缺省/为空 = 功能关闭，零行为变化）
      plan_audit:
        - { model: vendor/auditor-a, reasoning_effort: high }
        - { model: vendor/auditor-b, reasoning_effort: medium }
    mechanical_verification:
      enabled: true
      commands:
        compile: { cmd: 'npm run build', cwd: '.' }
        tests:   { cmd: 'npm test',      cwd: '.' }
      timeout_ms: 120000
    budget:
      daily_limit_cny: 5
```

注意：补丁行**整体替换**目标行的 `config`，不合并——用户层需写全所需键（schema 默认值兜底）。

**`reasoning_effort` 配置规则**：settings 中未声明 `reasoningEfforts` 档位的模型（如 `zhipu/glm-5.3-flash`、`ali/qwen3.8-flash`、`deepseek/deepseek-v4-flash-vision-exp`）必须显式配置 `reasoning_effort: off`，否则 schema 默认档位会触发 provider 层致命错误。

## 设置界面与配置分层（v5.3）

插件注册 settings 命名空间 `dsh-per`，在 **Settings → Plugins** 提供官方形态的配置卡片（模式 / 三阶段模型 / 计划审计 0–2 / 预算 / 机械校验开关）。配置优先级：

```
会话 /orch set  >  settings 用户段（settings.yaml `dsh-per` 键，UI 保存落在此处）
                >  saved-overrides.json（/orch save）  >  插件补丁 config  >  schema 默认
```

- 设置卡片的策划子集之外（gate/limits/circuit_breaker/risk_profile 等）仍走补丁层。
- 设置变更（UI 保存或直接编辑 settings.yaml）热生效，只影响**新回合/新任务**（与 /orch set 语义一致）。
- 补丁未配置 stages 时，settings 用户段给全 plan/execute/review 三组模型即可直接启用编排；settings 服务缺席或用户段非法时自动降级仅补丁（不崩溃）。

## /per 快捷命令（v5.3）

| 形态 | 行为 |
|---|---|
| `/per <任务文本>` | 一键强制进编排（等价 /orch task） |
| `/per on` | 本会话全部进编排（跳过门禁） |
| `/per off` | 本会话全部透传当前模型 |
| `/per auto` | 恢复门禁自动判定 |
| `/per`（裸） | 显示用法与当前会话模式 |

会话模式在任务结束后仍存续；`/orch` 家族管理命令不变。命令需从对话 UI 触发（headless 一次性模式无命令适配器）。

## 计划审计（v5.2，可选）

配置 `stages.plan_audit`（≤2 个审计模型）后，每个计划版本（规划与重规划均生效）在进入执行前先过审计门：

- **协商协议**：审计员给出结构化问题清单（稳定 id `IA1…`、四维 feasibility/granularity/risk_coverage/file_consistency、必附修改建议）；规划者重写时通过计划 JSON 的 `audit_response` 字段声明采纳/反驳；下一轮审计员逐条核验采纳是否修复、反驳是否成立。同一问题 id 冲突时取更严 severity；反驳任一审计员不接受即视为驳回。
- **仲裁（保守并集）**：任一审计员 blocker/major 且 confidence ≥ 0.7 → 不通过；passed 需要全体通过且最低 confidence ≥ 0.7。
- **预算复用**：审计不通过消耗 `plan_retry`（与 schema 校验失败同轨），耗尽走既有 model/hard-fail 终止链。
- **fail-open**：审计员派发失败/超时/无结构化结论时放行本版计划并计 `auditSkipped`（审计是增强不是阻塞）；审计员模型熔断时按其 fallback_chain 降级，全不可用同样放行。
- **记账**：审计员 token 计入 `subTokens.auditor`，费用记在 plan 阶段；审计 step 只进 executionLog（`sub:auditor` 前缀），不占规划步数预算。

## 能力总览

- **门禁**（A9 七步，固定顺序）：forced（/orch task、/per）→ passthrough flag → passthrough_patterns → orchestrate_patterns → 短句且无修改动词直通 → 长文进编排 → 保守默认；坏正则自动跳过并告警
- **FSM**：9 状态（3 终态）20 事件迁移表，守卫变体行（`${event}:${variant}`）+ 回退链（深度 ≤2，A7）；`plan/retry` 返回记忆的规划子状态（A2）；执行错误触发 `exec/fail` 重试，耗尽自动转入重规划链
- **修复回路**：fix_cycle ≤ max_cycles，耗尽后 `DONE_FLAGGED` 交付旗标报告；issue 稳定 id 跨轮追踪 + 通过即清零（M5）
- **复核**：独立子代理（`subagents.start('spawn', …)`）+ `outputSchema` 结构化强制 + 派发超时（`circuit_breaker.review_dispatch_timeout_ms`，默认 5min，超时自动取消并转死锁）；每轮一次重派预算（成功或通过即重置），死锁重派一次后保守合成（SYN-REVIEW-DEADLOCK）；大产物分片复核（>12 文件或 >800 diff 行按文件分片并行派发，≤4 片，保守合并：最严 defect + 最低 confidence + id 去重）；复核 prompt 受 review.input_token_budget 约束，超限逐级裁剪为骨架计划/纯产物统计
- **机械验证**：compile/lint/tests 命令（每轮重跑，结果反映当前产物；可配 parallel 并行）+ 超时按 unavailable + 任务取消即时 SIGKILL；quick channel 要求全部已配置命令通过；复核通过但机械失败走 `review/pass:MISS`（不耗修复轮次）
- **预算**（A14/A12）：任务级快照 + 每日限额 + 任务限额 + token/调用数/墙钟熔断；passthrough 只观测不限制（ADR #27）
- **模型健康**（A6）：5min/3fail 窗口 + 10min 半开（探测失败自动重关）；降级链 review→execute→plan 互换，fixer 角色执行者优先（ADR #28）；请求成功即恢复健康计数
- **恢复**：boot 时非终态陈旧快照标记 `abandoned` 并中止落盘（不阻塞调度器、不重复回收）
- **内存有界**：任务 settle 时统一清理 childSessions/pendingSteer/noticedOnce/lastBinding/requestRetries/agents；终态任务 24h 保留窗后离开内存（快照文件保留）；预算 tasks 记录仅保留活跃任务；透传观测上限 5000 会话
- **命令**：`/orch status|set|reset|save|budget|task|passthrough|abort`（`save` 写全局默认，重启加载）

## 已知限制

- **严格串行**（ADR #19）：单宿主同一时刻只运行一个编排任务，其余排队；会话级并行未实现
- **估价模式**：内置价表仅覆盖 deepseek 家族；其他模型请配置 `budget.pricing`（按模型）或 `budget.pricing_unknown`（兜底），否则按 ¥0 记账、金额限额不生效（会推送一次性告警）
- **全中文文案**：里程碑/指令/审计提示为中文硬编码，暂无 i18n
- **设置界面可配子集**：gate/limits/circuit_breaker/risk_profile/fix_loop/visibility 仍走补丁层配置
- **v1 恢复策略**：宿主重启后非终态任务一律放弃（aborted 落盘），不恢复会话

## 开发

```powershell
pnpm install
pnpm run build      # tsc + web 客户端 bundle（scripts/build-web.mjs）
pnpm run test       # vitest
pnpm run ci:checks  # 迁移表结构门禁：事件闭合/终态可达/零耗环/回退 DAG
```

E2E（mock 网关 + 隔离 DSH_HOME）：见 `docs/E2E测试报告-v0.1.0.md`。
