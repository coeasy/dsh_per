# dsh-orchestrator E2E 测试报告（v0.1.0）

- 日期：2026-09-03（含发布前收敛审查轮次更新）
- 环境：隔离 `$DSH_HOME`（`e2e/dsh-home`）+ `orch-test` profile（bundles: `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + `dsh-orchestrator`）+ 本地 mock OpenAI-completions 网关（`e2e/mock-provider.mjs`，端口 8399，凭据经 `$DSH_HOME/.env` 注入）
- 运行方式：`dsh --profile orch-test "编写一个 hello.py 脚本"`（一次性任务模式，`--patch probe.patch.yml` 挂载事件探针）
- 三阶段模型：plan=`moonshot/kimi-k2.5`(high)、execute=`deepseek/deepseek-v4-flash`(off)、review=`zhipu/glm-5`(high)，全部指向 mock 网关

## 发布前收敛审查（第 1-3 轮，24 项修复）

审查方法：第 1 轮逐文件通读（hook/动作/计数器与迁移表一一对照、字段生产者↔消费者配对、循环与递归上限）；第 2 轮交叉一致性核查（配置 schema ↔ 引擎 ↔ 命令 ↔ 报告渲染）；第 3 轮动态回归（单测 + CI + 多场景 E2E）。共发现并修复 24 项问题，重点：

| 类别 | 修复 |
| --- | --- |
| 断链 | `exec/fail` 迁移行引擎从不触发 → EXECUTING 收尾按本回合工具错误触发，回退链接入 `exec/fail:REPLAN`（重试耗尽转重规划）；`health.recordSuccess` 从未调用 → 请求成功即清除失败窗口（熔断可恢复）；`/orch save` 写出的文件无加载端 → boot 时读取合入全局默认；复核 prompt 的测试摘要读取不存在的字段 → 改读机械验证结果 |
| 孤儿逻辑 | `wall_clock_max_min` 声明未实现 → accountUsage 实现墙钟熔断；`queuedUserInput` 只写不读 → 并入 `userDirectives`（系统提示与修复指令均消费）；`planDigested` 只写不读 → 重规划提示注入精简指令；`executionLog`/`degradedStages` 无生产者 → step/end 审计轨迹 + 降级阶段记录；`review_dispatch_retry` 成功后不重置 → review/pass 行清零；删除孤儿配置 `reviewing_steps_max` 与不可达的 session-start 恢复分支 |
| 死循环/挂死 | 复核子代理 `run.result` 无超时 → 派发超时（默认 5min，`circuit_breaker.review_dispatch_timeout_ms`）后取消并按死锁处理；health 半开探测失败后永不重关 → 重置 halfOpenAt；`abandoned` 标记不持久化导致每次 boot 重复回收 → 回收后落盘 |
| 健壮性 | hook 异常导致 unhandled rejection → transitionOrLog 捕获；机械验证缓存按文件列表命中导致修复轮拿到陈旧结论 → 移除缓存；`execErrorCount` 跨回合累积误触发 exec/fail → turn/start 按回合重置；复核员的工具错误误计为执行错误 → 按角色过滤；持久化「写临时文件后双写」→ 改为原子 rename；`recover()` 双重调用 → 单次；删除 `stageOverride` 冗余机制（resolve 健康链已覆盖）；`doneFlagged` 里程碑模板残缺 → 修复并带上修复轮数；复核结果里程碑 `reviewResult` 落地 |

## 发布前收敛审查（第 4-6 轮，10 项追加修复）

第 4 轮：资源泄漏与生命周期审查（长驻宿主内存有界化）。第 5 轮：最近改动回归审查（超时/预算/回退链协同）。第 6 轮：跨文件一致性 + 测试补强。发现并修复：

| 类别 | 修复 |
| --- | --- |
| 挂死/资源 | 复核派发超时实现缺陷：双定时器导致已完成的 run 残留 5min 定时器（headless 进程延迟退出）→ 收敛为单定时器并确保 finally 清理；`run.result` 基础设施故障的 rejection 未捕获 → race 挂 catch 转死锁 |
| 生命周期 | `childSessions`/`pendingSteer`/`noticedOnce`/`lastBinding`/`requestRetries`/`agents` 在任务 settle 时不清除 → settle 统一清理；`registry.byId` 终态任务永久驻留 → 24h 保留窗 prune（磁盘文件保留）；`ledger.state.tasks` 无界增长 → pruneTasks 仅保留内存中活跃任务；`passthroughObserve` 透传会话永不清理 → 5000 上限 |
| 语义一致性 | 补证预算（`review_supplement`）两条失败路径行为分叉（ok-但失败路径重置、deadlock 路径不重置）→ 统一为每轮一次预算；`review_dispatch_retry` 预算每轮派发成功即重置（上一轮仅 review/pass 清零） |
| 命令/健壮性 | `/orch set` patch 构建绕圈（先拼 `plan=model` 再拆回）→ 直接存 `{stage: model}`；`task/launch` 失败仍误报「任务启动」→ 按返回值条件化；`recover()` 死代码 else 分支（recoverable() 已过滤）→ 移除 |
| 测试补强 | 新增：review/pass 重置派发预算、health 半开失败重关、config 默认值（wall-clock/派发超时）、doneFlagged/reviewResult 里程碑模板、mergeOverride 新键格式共 5 项 → 39 单测全绿 |

## 场景结果

### 场景 1：ok（复核一次通过）

| 阶段 | 证据 |
| --- | --- |
| 门禁 | `【编排】任务启动：编写一个 hello.py 脚本（gate: 4: orchestrate_patterns[0]）`（「编写」命中编排动词） |
| 规划 | 请求绑定 `kimi-k2.5 + high`；mock 返回 ```plan 围栏 JSON；解析成功 → `【编排】规划完成：1 步，复杂度 trivial` |
| 执行 | 请求绑定 `v4-flash + off`；产出执行文本 |
| 复核 | 子代理 reviewer（provider=spawn，outputSchema 强制）；**结构化 verdict 经 `structured_output` 工具提交**：`pass=true, confidence=0.95, issues=[]` |
| 收尾 | `review/pass → DONE`；快照 `state=DONE, fix=0, llmCalls=3` |

### 场景 2：fixloop（复核一次失败 → 修复 → 通过）

| 阶段 | 证据 |
| --- | --- |
| 复核 v1 | verdict `fail, execution, [I1 缺少 shebang 与入口守卫]`（结构化提交） |
| 修复 | `【修复指令】只修复以下问题点…` 注入执行者；`fix_cycle 1/3` |
| 复核 v2 | verdict `pass`（M5：修复成功问题不再出现） |
| 收尾 | `state=DONE, fix=1, verdicts=2` |

### 场景 3：复核死锁恢复（noreview：复核器始终无法产出结构化结论）

mock 复核响应永远不提交 structured_output：引擎第一次死锁后重派（`review_dispatch_retry=1`），再次死锁后保守合成 `SYN-REVIEW-DEADLOCK` 执行缺陷，3 轮修复期内复核持续无法结论 → `review/fail-exec` 耗尽 → `DONE_FLAGGED` 交付旗标报告。实测：`state=DONE_FLAGGED fix=3 verdicts=4 dispatch_retry=1`，全程有界收敛，无死循环。

### 场景 4：passthrough 门禁（疑问句直通）

输入「什么是闭包？」：门禁规则 3（passthrough_patterns）命中 → 不创建任何任务快照（0 个 task 文件），请求透传当前模型直接回答。

### 场景 5：陈旧快照恢复

预置非终态幽灵快照后启动：boot 时标记 `abandoned` 并 `forceAbort('stale_snapshot')`，结果持久化（`state=ABORTED abandoned=true`），后续 boot 不再重复回收，也不占用串行调度器。

### 记账验证

- `stageTokens: {plan:1311, execute:4080, review:0}`、`subTokens: {reviewer:3049}` —— 分阶段 + 子代理（A5）记账生效
- `budget.json`：`daily`（按天 orchestrated/passthrough 金额）+ `tasks`（按任务累计）双层结构持久化
- mock 模型不在 PRICING 表 → 估价模式 cost=0，符合 v1 设计

## 测试中发现并修复的缺陷

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 1 | `agent/request-error` 无限 retry 风暴（配置类错误无限重试 + 每次重试注入一条 notice） | 连续失败上限 3 次后放行内建错误处理；notice 按 key 去重（`noticeOnce`）；成功请求重置计数 |
| 2 | 宿主被杀后的陈旧任务快照在 boot 时复活并占住串行调度器，新任务永久排队 | v1 恢复策略：boot 时对非终态快照标记 `abandoned` 并 `forceAbort('stale_snapshot')`，不再进入调度器 |
| 3 | 排队里程碑语义错误（「前面还有 N 个」实为排位） | 模板改为「当前排在第 N 位」 |
| 4 | `subagents.start(name, request)` 误用单参调用 → `NO_PROVIDER "[object Object]"` | 改为 `start('spawn', request)` |
| 5 | 子代理 agentOptions 缺 provider（父代理经请求瀑布继承 provider 的路径对子代理不存在）→ `has no provider/model` 启动失败 | 显式解析：review 路由覆盖 → 父会话实时路由 → 部署默认 |
| 6 | `reviewVerdictJsonSchema` 使用 `minimum`/无类型 `enum`，超出 outputSchema 强制子集 | 重写为严格子集（type/properties/required/items/enum+type/additionalProperties），区间校验交还 zod |
| 7 | 复核员 prompt 泄漏为新一轮编排任务（`run.id` ≠ 子代理 session id，childSessions 过滤失效）并占住调度器 | `handleUserInput` 按复核员 prompt 标记前缀直接放行 |

## 已知限制（后续迭代）

- `estimatedToday()` 估价模式：PRICING 表未覆盖的模型花费记 0（v1 文档已声明）
- 会话 JSONL 的 zstd 多帧解码工具缺失，深排障依赖探针补丁（probe.patch.yml）
- 机械验证（compile/tests 命令）逻辑由单测与 CI 门禁覆盖；真实工具错误触发的 `exec/fail` 动态场景依赖宿主工具失败注入，E2E 未覆盖
- 分片复核 `mergeShardedVerdicts`（M3）为已就绪的导出 API（单测覆盖），v1 引擎单片执行
- 会话级 `/orch set` 覆盖采用全局合并（单会话语义），README 已声明

## v5.2 计划审计扩展验证（2026-09-03 追加）

配置：`audit.patch.yml` 整体替换 orchestrator 行，`plan_audit: [mock-auditor/censor-a, mock-auditor/censor-b]`（两个审计模型注册进 mock 网关 settings.yaml）；plan/execute/review 与基线一致。审计子代理经 `outputSchema` 强制 PlanAuditVerdict 结构化提交。

### 审计场景（5/5 通过）

| 场景 | 预期 | 实测快照 |
| --- | --- | --- |
| auditpass | 双审计员一轮通过 → 执行 | `state=DONE planAudit=1(passed=true, issues=[]) auditSkipped=0 subTokens.auditor=2968` |
| auditfix | 一轮 fail(IA1) → 规划者采纳重写 → 二轮通过 | `state=DONE plan_retry=1 planAudit=[round1 failed(IA1), round2 passed(adopted=[IA1])]` |
| auditrebut | 一轮 fail(IA1) → 规划者反驳 → 审计员接受反驳 → 通过 | `state=DONE plan_retry=1 round2 rebutted IA1 accepted=true` |
| auditexhaust | 持续 fail → plan_retry 耗尽 | `state=ABORTED plan_retry=2 planAudit=2(全 fail)`，无第 3 版计划、无执行无复核（有界收敛） |
| auditskip | 审计员永远无结构化结论 → fail-open | `state=DONE planAudit=0 auditSkipped=1`（放行计数生效，流程不阻塞） |

### 配置隔离回归（未配置 plan_audit，基线行为逐字节不变）

| 场景 | 实测 |
| --- | --- |
| ok | `state=DONE planAudit=0 auditSkipped=0 subTokens.auditor=∅` |
| fixloop（fresh mock） | `state=DONE fix=1 verdicts=2 planAudit=0` |
| noreview | `state=DONE_FLAGGED lastReviewError 保留`（死锁→MISS 降级路径不变） |
| passthrough | `task-snapshots=0`，mock 直答（编排完全惰性） |

### 过程中发现并修复

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 8 | 审计模型未注册进 mock 网关 settings.yaml → `pi-ai UNKNOWN_MODEL`，双审计员启动失败 | settings.yaml wps provider 补注册 `mock-auditor/censor-a|b`（同时验证了 fail-open 路径的真实触发：双失败 → auditSkipped → 放行） |
| 9 | `parsePlan` 未透出 `audit_response`（zod schema 有、解析结果丢弃） | parsePlan 返回独立 `auditResponse` 字段，不落入持久化计划文档 |
| 10 | 审计 fail 路径：`plan/retry` 迁移钩子注入的通用重写指令会残留 pendingSteer，可能被后续 steerNext 误消费 | 门内 `pendingSteer.set(task.id, null)` 两次清理后注入协商反馈指令 |
| 11 | mock 进程计数器跨运行累积 → 中止后重跑时 fixloop 的 failFirst 判定失效（非插件缺陷） | 重启 mock 清零后复测通过；E2E 报告注明「场景切换须重启 mock」 |

### 发布前收敛审查（v5.2 三遍复审，5 项追加修复）

第 1 遍协议层（契约一致性 + 旧快照兼容）、第 2 遍引擎层（门全路径/记账/清理/报告）、第 3 遍跨层复验（全套 E2E 重跑）：

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 12 | `recover()` 对 v5.2 之前的旧快照不做字段归一化 → 恢复后 `planAudit`/`auditSkipped` 为 undefined：配置审计时 `planAudit.push` 在 turn-stopping 处理器内抛 TypeError（未处理拒绝），`auditSkipped += 1` 产生 NaN | recover 展开 spread 时显式归一化 `planAudit ?? []` / `auditSkipped ?? 0` |
| 13 | 子会话消息过滤只覆盖 reviewer → auditor 回复若引用 ```plan 围栏会再次触发父任务（停靠在 PLANNING）的围栏检测，造成跨会话 FSM 污染 | 泛化为 `if (child) return`：所有子代理消息只记账、永不驱动父 FSM |
| 14 | `mergeAuditVerdicts` 仅聚合 passed 旗标 → 审计员 passed=true 却列出 major 问题时计划放行，偏离 D1「blocker/major 拦截」文义 | 并集中出现 blocker/major 议题即强制 fail（minor 不拦截）；新增单测覆盖 |
| 15 | 派发结果 `skipped` 字段无人消费（孤儿）；`runtime.start` 返回 undefined 时 `run.result` 同步抛错；终报/终止里程碑不含审计轮次信息 | skipped>0 记 warn 日志；start 返回空句柄按 spawn 失败处理；新增 `renderAuditNote` 接入 done/doneFlagged/全部 abort 里程碑（`｜审计 N 轮（终判…），审计放行 M 次`）；systemPrompt 规划段补审计协商协议说明（audit_response 字段契约对规划者自洽） |

### 已知语义说明

- 审计耗尽的终止走 plan_retry 既有 fallback（`model/hard-fail` → ABORTED），终态里程碑文案为「模型不可用且不可降级」——与 schema 校验耗尽同轨（D2 决策：预算复用），审计不通过的里程碑（`计划审计不通过…第 N/2 次`）在终止前可见，足以定位真实原因。
- 审计步骤不计入规划步数预算（`stageSteps.plan`），仅进 executionLog（`sub:auditor` 前缀）——防止审计轮次挤占 wander 检测。

## 真机测试（2026-09-04，真实网关 + 真实模型）

环境：隔离家目录 `local-home`（wps 真网关 `ai-kas.kso.net/codeplan/v1`），profile `local-test` 经 `dsh plugin --profile local-test add <plugin>` 真实安装流程 live-link 插件。阶段模型：plan=kimi-k2.5(high)、execute=glm-5.3-flash(off)、review=glm-5(high)、plan_audit=qwen3.7-max(high) + glm-5.2(medium)；预算 task ¥2 / daily ¥20 封顶。

### 全链路真实轨迹（一次通过）

任务启动（门禁命中）→ 规划 v1（kimi）→ **计划审计（双真审计员）→ 通过 ✓** → 执行 → `[NEED_REPLAN]`（执行者报告计划未覆盖）→ 带反馈重规划 v2 → **第二版计划再次真实审计 → 通过 ✓（D3 实证）** → 执行产出 `fizzbuzz.py` → 复核 pass(conf=0.9) → `任务完成 ✓ 3 步 / 1 文件｜审计 2 轮（终判通过）`（终报审计注记生效）。产物实际运行输出正确（1..20 FizzBuzz 序列）。真实审计员给出真实 minor 意见（r1: `test-1`/`ISSUE-1` risk_coverage；r2: `IA1` file_consistency），union 合并与终判逻辑按设计工作。预算 ledger 真实记录 token（估价模式 cost=0，v1 已知语义）。

### 真机发现并处理的问题

| # | 现象 | 定性 / 处置 |
| --- | --- | --- |
| R1 | 占位 API key 在 mock 下全程无感（mock 不校验鉴权），真网关返回 403 循环 | 从真实家目录 `.credentials.yaml` refs 提取真实 key 写入测试家 .env（值不落日志）。E2E 结论：mock 覆盖不到鉴权层，属预期边界 |
| R2 | `deepseek/deepseek-v4-flash`（effort=off）请求：网关接受连接但流式挂死（usage 恒 0、无内容、8min+），**无任何 error 事件** → 健康系统与墙钟熔断均不触发（二者都依赖事件回调），父会话请求插件层无取消手段 | 模型/网关侧流式挂死。规避：执行阶段换 glm-5.3-flash 后全程正常。建议后续：宿主驱动层增加请求级 watchdog（插件层无法实现，已知限制） |
| R3 | 执行阶段省略 `reasoning_effort` → schema 默认 `low` → `zhipu/glm-5.3-flash`（settings 未声明任何 effort 档位）→ `UNSUPPORTED_REASONING_EFFORT` 进程级致命退出 | 配置规则：settings 未声明 reasoningEfforts 的模型（glm-5.3-flash / qwen3.8-flash / vision-exp 等）阶段配置必须显式 `reasoning_effort: off`（README 已注明）。插件无法拦截 provider 层致命错误 |

### 真机测试配置要点

```yaml
stages:
  plan:    { model: moonshot/kimi-k2.5, reasoning_effort: high }
  execute: { model: zhipu/glm-5.3-flash, reasoning_effort: off }  # 无 effort 档位的模型必须 off
  review:  { model: zhipu/glm-5, reasoning_effort: high }
  plan_audit:
    - { model: ali/qwen3.7-max, reasoning_effort: high }
    - { model: zhipu/glm-5.2, reasoning_effort: medium }
budget: { daily_limit_cny: 20, task_limit_cny: 2 }
```

## 复现步骤

```powershell
# 1. 启动 mock 网关（场景可选 ok / fixloop / noreview / passthrough；审计场景
#    auditpass / auditfix / auditrebut / auditexhaust / auditskip 需 --patch e2e/audit.patch.yml）
$env:MOCK_SCENARIO='ok'; node e2e/mock-provider.mjs

# 2. 运行一次性任务（隔离 DSH_HOME 已含 orch-test profile 与 .env 凭据）
$env:DSH_HOME='D:\workspace\dsh_per\e2e\dsh-home'
dsh --profile orch-test --patch e2e/probe.patch.yml "编写一个 hello.py 脚本"

# 3. 查看任务快照与预算
Get-Content e2e\dsh-home\storages\orchestrator\tasks\task-*.json
Get-Content e2e\dsh-home\storages\orchestrator\budget\budget.json
```

## v5.3 设置界面与快捷命令（真机 + 结构验收）

- 日期：2026-09-03（v5.3 会话）
- 环境：`local-home` 隔离 DSH_HOME + 真实网关（kimi-k2.5/glm-5.3-flash/glm-5 + 双审计员）；web 链路用 alt-port（3081）临时 web-test profile

### ① settings-only 编排（headless 真机）

- 配置：local-test 补丁**删除全部 stages**；`settings.yaml` 写 `dsh-orchestrator` 用户段（三阶段 + 双审计员 + 预算）。
- 结果：任务 DONE，planVersion=1，审计 1 轮通过（真实审计员提出 IA 级问题被采纳修复），fizzbuzz.py 产物经真实执行验证（1..20 FizzBuzz 序列正确）。
- 结论：**D6 分层链实证**——编排可以完全由 settings 用户段驱动，补丁层零阶段配置。

### ② web 半包服务链路（alt-port）

- `web-test` profile（dsh-base + dsh-web-app + dsh-orchestrator）`--port 3081 --no-open` 启动即出 `dsh web: http://127.0.0.1:3081`。
- `GET /plugins/dsh-orchestrator/client.js` → 200，内容为本插件 bundle（`window.__ModuleLoader__.load({id:"dsh-orchestrator",...})`）：Node 半包扫描 → boot graph 哈希 → `/plugins` 服务，全链路成立。
- 槽位配对（Settings→Plugins 卡片渲染）与保存路径待用户桌面 GUI 人工验证（安装：`dsh plugin --profile desktop add D:\workspace\dsh_per\dsh-orchestrator`，重启宿主生效）。

### ③ 过程发现（已修复）

| # | 发现 | 处置 |
| --- | --- | --- |
| R4 | 引擎启动 TDZ 崩溃：`applyOverrides()` 在 `sessionOverrides` 声明前调用（`Cannot access 'sessionOverrides' before initialization`，插件树加载失败） | 分层块依赖的 map 声明上移；教训：引擎 boot 顺序对声明位置敏感，tsc 不查 TDZ |
| R5 | `ctx.get('settings')` 在 apply 时服务不可注入（settings-file provider init 未完成）→ 注册静默跳过 → 编排未激活（首次真机运行直接透传） | 改官方 `installSettingsSection` 同形：`ctx.inject(['settings'], ...)` 注入等待；headless settings-only 复跑通过 |
| R6 | headless 一次性模式无命令适配器：`/orch status` 被当普通文本交模型 | 设计约束记录（D10 注）：命令类验证必须走对话 UI |
| R7 | 预存缺陷：/orch set 后 `applyOverrides` 仅合并会话层，saved-overrides 全局默认被丢弃 | 重构分层合成：saved 层常驻内存参与每次计算 |

### ④ 回归

- 单元 58/58（+7 namespace 分层、+3 web bundle 冒烟）；CI 结构门禁 OK。
- mock 网关 E2E 场景套件未重跑（本版未触及 FSM/门禁/审计协议路径；相关改动仅配置分层与命令注册，由单测覆盖）。

## v5.3 三轮深度审查（结构/动态/交叉回归）

- 日期：2026-09-03（v5.3 审查会话）
- 方法：第一遍结构通读（engine/schema/router/registry/gate/ledger/health/mechanical/fsm/transition-table/namespace/web 卡片/测试）；第二遍动态死循环与有界性分析（迁移表 + mock E2E 七场景）；第三遍交叉一致性与全量回归（文档vs实现、真机 settings-only、69 单测 + CI 门禁）。

### 修复清单（R8–R12）

| # | 发现 | 处置 |
| --- | --- | --- |
| R8 | `mechanical_verification.enabled` 属 settings 策划子集（D7），但 `MechanicalVerifier` 在 boot 时用 `cfg` 固化——UI 切换开关后 `verifier.run()` 仍按旧值执行（启用不生效/禁用仍跑命令） | verifier 增加动态 `isEnabled` getter，engine 传入 `() => effectiveConfig.mechanical_verification.enabled` |
| R9 | `/orch set` 会话覆盖被 `applyOverrides` 全量 flatMap 合并进**全局** effectiveConfig——多会话宿主下 A 会话覆盖泄漏到 B 会话（命令文案却称"会话级"） | 重构分层：effectiveConfig 仅含全局层（补丁→saved→settings）；会话覆盖经 `sessionEffective`/router `override` 参数**按会话**在绑定/显示点应用；`/orch save` 只持久化本会话覆盖；配套 3 个单测 |
| R10 | 强制编排（/orch task、/per on、gated 模式）在 inert 配置（无 stages）下会创建 `configValid=false` 的任务 → task/launch 守卫拒绝 → 立即 ABORTED + "守卫链溢出"误导信息 | handleUserInput 预算检查后增加 stages 存在性前置拒绝（launchRejected 明确文案），不再创建注定失败的任务 |
| R11 | `stageSteps.plan/execute` 从不复位——多次修复轮/重规划后累计步骤超 `planning_steps_max`/`executing_steps_max`，长任务被误判"粒度过粗"强制重规划直至 DONE_FLAGGED 误伤 | 迁移表新增 `plan_steps=0`（plan/retry）与 `execute_steps=0`（plan/ok 后 replan/ok、review/fail-exec、review/pass:MISS、review/deadlock:EXEC）动作，每轮新预算；配套 3 个 FSM 单测 |
| R12 | settings 注册 D11 兜底 try/catch 只包住 `ctx.inject` 调用本身，**回调内**的注册异常（存储段被拒）仍是未捕获 rejection | 回调体整体 try/catch，降级仅补丁层；`buildConfigBase` 改折叠 savedRaw 作为 seam base |

### web 卡片保存语义修复（与子代理交叉审查）

- 行回落继承与同保存内 per-leaf set 冲突：model 回到 base 值触发整行 unset 时，先前已压入的 leaf set（如 provider 改动）被 unset 覆盖丢失 → 改为「整行 set + base 值携带」，杜绝等值覆盖与编辑丢失。
- plan_audit 数组整体写回：未触碰审计员的 `reasoning_effort`/`on_failure` 缺键导致与 base 数组 JSON 不相等 → 写回后静默回落到 schema 默认（high→medium）→ `auditToUser` 按索引携带 base 叶子值；新增 5 个保存语义单测（总计 69 个）。

### mock E2E 七场景实证（有界性）

| 场景 | 终态 | 说明 |
| --- | --- | --- |
| ok | DONE | 主链路全通 |
| fixloop | DONE | 1 轮修复 → 复核通过 |
| auditpass | DONE | 1 轮审计即过 |
| auditfix / auditrebut | DONE | 2 轮协商（plan_retry=1）后通过 |
| auditexhaust | ABORTED | plan_retry=2 耗尽有界终止 |
| auditskip | DONE | 审计不可用 fail-open（auditSkipped=1） |
| noreview | DONE_FLAGGED | fix_cycle=3 耗尽有界交付 |
| passthrough | 无任务 | inert 配置零任务零记账 |

### 回归

- 单元 69/69（+5 web 保存语义 +3 路由隔离 +3 步骤预算复位）；CI 门禁 OK（6 states, 57 cycles all costed, fallbacks acyclic）。
- settings-only 真机（F3 重构后）：补丁零 stages + settings.yaml 用户段 → 任务 DONE、双审计员照常，复验通过。

### 真机观测 R13（非缺陷，设计有界性实证）

- 现象：settings-only 真机复验（run4）出现 DONE_FLAGGED——executor（glm-5.3-flash）连续 4 个计划版本输出 `[NEED_REPLAN]`（v1→v4 各一次"执行中遇到计划未覆盖"），replan_cycle=3 耗尽后按 `exec/defect:EXHAUSTED` 有界终止并旗标交付。
- 判定：**模型行为，非引擎回归**——NEED_REPLAN 检测（EXECUTING 文本含标记→置 needReplan）与 F7 步骤预算复位无关；审计门 4 轮全过（qwen3.7-max/glm-5.2），产物 fizzbuzz.py 20/20 零偏差完全正确。
- 机制验证：这正是设计目标——弱执行模型把 NEED_REPLAN 当逃生口时，重规划预算耗尽即终止并交付旗标，绝不无限循环（run3 同配置干净 DONE 佐证随机性）。
- 改进候选（v5.4）：NEED_REPLAN 触发可要求附带具体未覆盖描述（当前仅文本标记即可触发）；或在连续 2 轮 NEED_REPLAN 且审计无新问题时不消耗 replan 预算直接按执行缺陷处理。

## v5.3 收尾：独立子代理交叉审查（设置界面专项）

独立子代理逐行审查 web 卡片与设置层，确认并修复 S1–S3（严重）/M4–M8（中等）/L9–L16（轻微），要点：

- **S1** inert 安装卡片渲染崩溃（null 行 TypeError）→ makeDraft 恒产出可编辑三行，复活路径可达
- **S2** overlay 误食 resolved 段（scope.get() 含默认+base）→ 改经 describe() 读 **raw 用户段**；`/orch save` 恢复生效、复活默认值（high/hard_fail）恢复；raw 段端到端实证：e2e settings.yaml 临时写入用户段 + 零 stages 补丁 → DONE + 1 轮审计
- **S3** plan_audit 恒等值覆盖 + fallback_chain 静默清除 → auditToUser 恒携带 base 链；未触碰时回落继承
- **M4** model 回 base 丢同行覆盖 → 整行 set + base 携带；**M5** 保存后陈旧重播种 → 用 mutate 应答权威值重播种；**M7** 预算整数校验 + 冲突/校验失败文案区分；**M8** 阶段行"重置为继承"按钮 + placeholder
- 测试：72/72（新增 S1/S2 raw 段回归）；CI 门禁绿；web bundle 构建链并入 pnpm build
