# dsh-per

[![npm](https://img.shields.io/npm/v/dsh-per.svg)](https://www.npmjs.com/package/dsh-per)
[![CI](https://github.com/coeasy/dsh_per/actions/workflows/ci.yml/badge.svg)](https://github.com/coeasy/dsh_per/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 当前正式版本：**v0.1.0** · npm：`dsh-per@0.1.0`

**dsh-per 是面向 DeepSeek Harness / DSH 的多模型任务编排插件。** 它把复杂任务从“一次模型调用”升级为可规划、可复核、可修复、可验证、可预算控制的执行流水线。

```text
用户任务
  → Gate
  → Plan
  → Plan Audit（可选）
  → Execute
  → Review
  → Mechanical Verify
  → Fix / Replan / Done
  → Accounting + Snapshot
```

如果你希望 DSH 在代码修改、重构、迁移、复杂分析等任务上不仅“给答案”，而是按阶段执行并在交付前做独立复核，dsh-per 就是为这个场景设计的。

## 为什么使用 dsh-per

- **规划与执行分离**：先形成结构化计划，再进入执行，避免边想边改导致目标漂移。
- **独立复核**：reviewer 与 executor 分离，支持缺陷检查、自动修复和重规划。
- **计划审计**：可配置最多两个审计模型检查可行性、粒度、风险覆盖和文件一致性。
- **机械验证**：可接入 compile / lint / tests；模型认为“通过”不等于真实通过。
- **预算护栏**：支持日预算、任务预算、调用数、token 与墙钟熔断。
- **模型降级**：提供模型健康窗口、熔断、半开和 fallback chain。
- **安全恢复**：快照记录任务状态；宿主重启时不会盲目重复执行遗留任务。
- **默认不打扰**：安装后若未配置 stages，插件保持 inert / passthrough。

## 30 秒安装

本文档和 `docs/` 下所有面向用户的命令，**默认统一使用 DSH Web 的 `web` profile**，这样命令可以直接复制执行。

### 1. 安装固定版本

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

这条命令的意思是：把 npm 上的 `dsh-per@0.1.0` 安装到 DSH 的 `web` profile。

### 2. 确认已经安装

```bash
dsh plugin --profile web list --depth 0
```

应能看到：

```text
dsh-per 0.1.0
```

### 3. 启动同一个 Web profile

```bash
dsh --profile web
```

> 如果你使用自定义 profile，请在安装、查看、更新、卸载和启动时始终使用同一个 profile 名称。完整示例见 [安装指南](docs/INSTALLATION.md)。

也可以安装 npm 当前 latest：

```bash
dsh plugin --profile web add dsh-per
```

## 最小启用配置

安装完成后，可在 **Settings → Plugins → dsh-per** 配置常用参数；也可以在 profile patch 中覆盖 `per` 行。

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

未配置 `stages` 时，插件不会接管普通会话。

## 第一次验证

启动 DSH Web 后，在会话中执行：

```text
/orch status
```

然后强制执行一次编排任务：

```text
/per 重构当前模块，保持外部 API 不变，并在完成后运行测试
```

## 常用命令

```text
/per 重构当前模块并运行测试
/per on
/per off
/per auto
/orch status
/orch budget
/orch task 修复当前项目 CI 并验证所有测试
/orch passthrough
/orch abort
```

会话级临时切换模型示例：

```text
/orch set plan=vendor/planner execute=vendor/executor review=vendor/reviewer
/orch reset
/orch save
```

完整命令和典型工作流见 **[使用指南](docs/USAGE.md)**。

## 安装方式

| 场景 | 推荐方式 |
| --- | --- |
| DSH Web 普通用户 | `dsh plugin --profile web add dsh-per@0.1.0` |
| npm latest | `dsh plugin --profile web add dsh-per` |
| npm 访问受限 | GitHub `v0.1.0` tag |
| 离线/内网 | GitHub Release tarball |
| 插件开发 | 本地目录或 `link:` |
| 测试主线 | GitHub `main`，仅测试使用 |

完整命令见 **[安装指南](docs/INSTALLATION.md)**。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [文档首页](docs/README.md) | 文档地图、默认 `web` profile 约定与阅读顺序 |
| [安装指南](docs/INSTALLATION.md) | npm / GitHub / 本地 / tarball / 更新 / 卸载 / 自定义 profile |
| [使用指南](docs/USAGE.md) | 从启动 Web 到 `/per`、`/orch` 和典型工作流 |
| [配置参考](docs/CONFIGURATION.md) | stages、gate、预算、验证、熔断、风险等完整配置 |
| [故障排查](docs/TROUBLESHOOTING.md) | 安装失败、插件未启用、模型、预算、验证等问题 |
| [项目介绍与宣传稿](docs/PROMOTION.md) | 面向社区、团队和用户的项目介绍 |
| [架构与重构计划](docs/PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md) | 项目结构、风险与后续改进路线 |
| [版本策略](docs/VERSIONING.md) | 正式版本治理 |
| [分支与发布](docs/BRANCHING_AND_RELEASE.md) | main、短期分支、CI、npm 与 Release 规则 |
| [E2E 基线](docs/E2E测试报告-v0.1.0.md) | 当前正式版本端到端验证记录 |

## 代码结构

```text
src/
├── engine.ts          # 宿主接线、共享状态、transition 统一出口
├── engine/            # audit/review/accounting/commands/request/... 子模块
├── task/              # FSM、registry、transition table
├── protocols/         # plan / plan-audit / review / mechanical
├── gate/              # 输入门禁
├── router/            # 模型路由、健康与降级
├── budget/            # 预算台账
├── persistence/       # 快照
├── settings/          # Settings namespace / overlay
├── visibility/        # 用户可见里程碑
└── config/            # 配置 schema
```

核心约束：FSM 是任务状态唯一权威；`engine.ts` 持有宿主生命周期与 transition 发射权；外部副作用必须可超时、可取消、可降级；无法验证时使用 flagged / abort，而不是伪造成功。

## 开发与质量门禁

```bash
pnpm install --no-frozen-lockfile
pnpm run version:check
pnpm exec tsc --noEmit -p tsconfig.json
pnpm test
pnpm run build
pnpm run ci:checks
```

当前发布基线已经通过 TypeScript、build、结构门禁和 **151 个测试**。

## 版本与发布

- 当前正式版本固定为 **v0.1.0**。
- npm：`dsh-per@0.1.0`。
- GitHub Release：`v0.1.0`。
- `VERSION` 与 `package.json.version` 必须一致。
- 未经明确决定，不以文档轮次、重构批次、CI 修复为理由自行升级版本。
- `main` 是唯一长期维护与正式发布分支。

## License

MIT
