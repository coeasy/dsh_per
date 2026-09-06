# dsh-per：让 DeepSeek Harness 从“调用模型”走向“交付任务”

> 一个面向 DSH / DeepSeek Harness 的多模型任务编排插件：**先规划，再执行，再独立复核，并用真实验证决定是否交付。**

很多 AI 工具已经很擅长回答问题，但真正困难的工程任务往往不是“给出一个答案”，而是：

- 先理解目标和约束；
- 把任务拆成可执行步骤；
- 在修改过程中控制风险；
- 完成后由独立视角检查；
- 运行真实 build / lint / tests；
- 失败时继续修复，而不是提前宣布完成；
- 在成本、调用数和时间超限前及时停止。

**dsh-per 就是为这条“从问题到可靠交付”的链路而设计。**

## 一句话介绍

**dsh-per 把复杂任务组织成 Plan → Execute → Review → Verify 的受控流水线，让多个模型各司其职，并用状态机、预算、降级与机械验证把整个过程约束在可审计边界内。**

## 它解决什么问题

### 一个模型同时规划、执行、检查，容易自我确认

传统单 Agent 流程经常出现：自己提出方案、自己执行，最后再自己判断“已经完成”。

dsh-per 把职责拆开：

```text
Planner 负责想清楚
Executor 负责做出来
Reviewer 负责挑问题
Mechanical Verify 负责给出机器可验证的事实
```

不同角色之间使用结构化协议，而不是依赖模糊自然语言约定。

### “模型说测试通过”不等于测试真的通过

dsh-per 可以直接运行：

```text
compile
lint
tests
```

如果 reviewer 判断通过，但真实命令失败，任务依然不会被标记为成功，而会进入修复路径。

### 复杂任务容易无限迭代

dsh-per 对这些维度设置明确边界：

- 修复轮次；
- 重规划次数；
- LLM 调用数；
- token；
- 墙钟时间；
- 日预算；
- 单任务预算。

目标不是让任务“永远努力”，而是在可控范围内尽可能完成；无法确认时明确 Flagged 或 Abort。

### 一个模型或 provider 不稳定时，整条任务不应直接崩掉

dsh-per 提供模型健康窗口、circuit breaker、半开与 fallback chain，可以按阶段定义失败策略。

计划审计属于增强能力，即使审计服务不可用，也可以按 fail-open 规则继续主任务并留下记录。

## 核心流水线

```text
用户输入
   │
   ▼
Gate / Session Mode
   │
   ▼
Plan
   │
   ├── Plan Audit（可选，最多两个模型）
   │
   ▼
Execute
   │
   ▼
Independent Review
   │
   ▼
Mechanical Verify
   │
   ├── fail → Fix / Replan
   │
   ▼
Done / Flagged / Abort
   │
   ▼
Accounting + Snapshot + Settle
```

## 适合哪些任务

### 代码重构

让 planner 先梳理架构边界，executor 实施，reviewer 检查行为兼容性，最后用 build/tests 收口。

### CI / 构建问题修复

从真实日志出发定位根因，修复后继续检查同类路径，再执行机械验证。

### 发布前质量门禁

在发版前统一执行计划审计、独立复核、构建、测试和预算检查。

### 大规模项目改造

把“完成一个巨大任务”变成受状态机管理的一系列可追踪阶段，而不是依赖一次长上下文调用。

### 高风险修改

对 auth、payment、security 等敏感路径定义风险策略，让任务进入更保守的执行和复核流程。

## 为什么不是简单的多模型 Router

Router 解决的是：**“这次调用哪个模型？”**

dsh-per 解决的是：**“一个复杂任务应该经历哪些阶段、什么时候重试、什么时候降级、什么时候修复、什么时候可以真正结束？”**

因此它的核心不是模型列表，而是：

- FSM 状态机；
- transition table；
- 结构化 plan/review/audit 协议；
- fix / replan 生命周期；
- budget / circuit breaker；
- mechanical verification；
- snapshot / settle。

## 默认安全，不强制接管

dsh-per 安装后默认配置为空：

```yaml
config: {}
```

没有配置 stages 时，它保持 inert / passthrough。

你可以从最小配置开始，再逐步增加审计、预算、fallback 和机械验证。

## 30 秒开始使用

本文档直接使用 DSH Web 的 `web` profile，命令可以直接复制：

```bash
# 安装
dsh plugin --profile web add dsh-per@0.1.0

# 确认
dsh plugin --profile web list --depth 0

# 启动
dsh --profile web
```

进入 Web 后配置 plan / execute / review 三个模型，然后执行：

```text
/per 修复这个项目的 CI，完成后运行测试并检查是否达到发布条件
```

查看状态：

```text
/orch status
```

查看预算：

```text
/orch budget
```

终止任务：

```text
/orch abort
```

## 对团队的价值

对于个人用户，dsh-per 的价值是让复杂任务更稳。

对于团队，它还提供另一层价值：**把原本隐含在 prompt 里的“工作方式”变成可配置、可测试、可审计的工程规则。**

例如：

- 哪个模型负责规划；
- 哪个模型负责执行；
- 是否需要两个 auditor；
- 哪些路径属于高风险；
- 测试失败是否允许交付；
- 一个任务最多花多少钱；
- 模型异常后如何降级；
- 修复多少轮后必须停止。

这些都可以从“团队习惯”变成明确配置。

## 工程设计原则

1. **FSM 是任务状态唯一权威**：不允许模块绕过状态机伪造完成。
2. **真实验证优先于模型自评**：机器可运行的检查由机器执行。
3. **安全降级优先于隐式成功**：无法确认时明确 Flagged / Abort。
4. **所有外部副作用可超时、可取消**。
5. **默认行为保守**：未配置 stages 不接管会话。
6. **版本与发布可追溯**：正式版本、npm、GitHub Release 保持一致。

## 当前状态

当前正式版本：**v0.1.0**。

已经具备：

- Plan / Execute / Review；
- Plan Audit；
- 自动 fix / replan；
- compile / lint / tests；
- 预算和成本估算；
- 模型健康与 fallback；
- snapshot 与安全恢复；
- `/per`、`/orch` 控制面；
- Settings 插件配置；
- npm 与 GitHub Release 分发；
- TypeScript、build、结构门禁和 151 个测试基线。

后续重点是继续强化 snapshot schema、可观测性、配置诊断、质量门禁和 runtime state 生命周期，而不是为了“重构”反复改写已经稳定的核心语义。

## 谁会喜欢 dsh-per

如果你希望 AI Agent：

- 不只是聊天，而是真的完成工程任务；
- 不只会改代码，还会自己复核和验证；
- 不会因为一次模型异常就整条链路失控；
- 不会无限调用直到预算耗尽；
- 在交付前能给出更可信的完成信号；

那么 dsh-per 值得尝试。

## 开始

直接安装到 DSH Web：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

然后：

```bash
dsh --profile web
```

进一步阅读：

- [完整安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [配置参考](CONFIGURATION.md)
- [项目架构与重构计划](PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md)

项目主页：https://github.com/coeasy/dsh_per

npm：`dsh-per`

License：MIT
