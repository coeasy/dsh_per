# Changelog

## 0.1.0（2026-09-06）

`dsh-per` 的唯一正式发布版本。此前仓库中出现过的更高数字仅用于开发阶段内部批次标记，本次全部归档并合并到 `0.1.0`，不作为真实 npm/GitHub Release 版本。

### 核心能力

- 三阶段多模型编排：Plan → Execute → Review。
- Gate 门禁与 `/per on|off|auto|<task>`、`/orch` 管理命令。
- 计划结构化协议、重试、重规划与最多两名计划审计员的协商审计。
- 独立 reviewer、分片复核、deadlock 保守处理与自动修复回路。
- compile / lint / tests 机械验证，支持并行、超时与任务取消。
- 日预算、任务预算、token/调用数/墙钟限制、模型定价与透传记账。
- 模型健康窗口、熔断、半开与 fallback chain。
- 任务快照、启动恢复、终态清理和有界运行时状态。
- Settings → Plugins 配置卡片与 `web/dist/client.js` 客户端 bundle。

### 已完成的内部重构批

- 将早期巨型 engine 胶水层拆分为 `src/engine/*` 模块，同时保持 `engine.ts` 为共享状态与 transition 唯一发射中枢。
- 修复敏感路径 glob 边界、request/review/audit 异步异常保护、deadlock fallback、墙钟熔断、预算预检、快照节流与机械验证取消。
- 清理未消费配置与死 API，并增加 schema 配置键消费门禁。
- 接通 `budget.count_passthrough`、lint 机械摘要、可注入时钟、budget daily 记录保留窗、模型单价 Settings 编辑器。
- 当前回归测试覆盖 FSM、engine gate/turn、协议单元测试、Web bundle 与历次重构回归。

### 发布工程归档

- `VERSION` 与 `package.json` 统一为 `0.1.0`。
- `scripts/check-version.mjs` 作为版本漂移硬门禁。
- CI 修复无 lockfile 仓库与 `--frozen-lockfile`/pnpm cache 的冲突，并修复 summary shell 引号错误。
- 增加可重复执行的 Release workflow：完整门禁 → `npm pack` → 可选 npm publish → GitHub Release。
- 正式发布版本保持 `v0.1.0`；后续架构/质量改造默认继续在这一版本线上收敛，除非用户明确决定改变版本策略。
