# dsh-per 故障排查

本文按“安装 → 加载 → 配置 → 执行 → 验证”的顺序排查常见问题。

## 1. `dsh plugin` 提示 pnpm not found

现象：

```text
dsh: pnpm not found on PATH
```

处理：

```bash
pnpm --version
```

如果命令不存在，先安装 pnpm，并重新打开终端确保 PATH 生效。

## 2. npm 安装失败

先确认：

```bash
npm view dsh-per@0.1.0 version
```

然后重试固定版本：

```bash
dsh plugin --profile <profile> add dsh-per@0.1.0
```

如果 profile 中已有异常依赖状态：

```bash
dsh plugin --profile <profile> remove dsh-per
dsh plugin --profile <profile> add dsh-per@0.1.0
```

## 3. GitHub 安装失败

推荐固定 tag：

```bash
dsh plugin --profile <profile> add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

如果 pnpm 明确提示 Git 依赖构建脚本被 `allowBuilds` 阻止，按照 DSH 输出的 profile 目录和 package key 修改对应 `pnpm-workspace.yaml` 后重试。

不要为了排障无条件允许所有依赖执行构建脚本。

## 4. 插件安装了，但没有进入编排

这是最常见情况之一。

dsh-per 默认 bundle 配置是：

```yaml
- insert:
    - id: per
      name: dsh-per
      config: {}
```

没有 `stages` 时插件故意保持 inert / passthrough。

先执行：

```text
/orch status
```

如果看到“阶段模型未配置”，请在 Settings 或 profile patch 中配置 plan / execute / review。

最小配置见 [USAGE.md](USAGE.md)。

## 5. 想强制测试插件是否工作

配置 stages 后执行：

```text
/per 请分析当前任务并给出执行计划
```

或者：

```text
/orch task 请分析当前任务并给出执行计划
```

这两个入口都会绕过 Gate 强制进入编排。

## 6. 普通问题总被编排

临时关闭当前会话：

```text
/per off
```

恢复自动判断：

```text
/per auto
```

只让下一条消息透传：

```text
/orch passthrough
```

如果长期分流不合理，检查 `gate.passthrough_patterns`、`gate.orchestrate_patterns` 和 `gate.default`。

## 7. 模型 reasoning effort 不兼容

当前可配置档位：

```text
off / low / medium / high / max
```

但并非所有 provider/model 都支持所有档位。

如果 provider 报未知 reasoning effort，显式改为它支持的值；不确定时可以先用：

```yaml
reasoning_effort: off
```

## 8. `/orch set` 没有影响所有配置

`/orch set` 只用于当前 session 的 stage model 覆盖：

```text
/orch set plan=<model> execute=<model> review=<model>
```

它不修改 gate、预算、机械验证或其他高级配置。

清除覆盖：

```text
/orch reset
```

保存当前 stage model 覆盖：

```text
/orch save
```

## 9. 机械验证配置报错

正确：

```yaml
mechanical_verification:
  commands:
    compile: pnpm run build
    tests: pnpm test
```

错误示例：

```yaml
compile:
  cmd: pnpm run build
  cwd: .
```

当前 schema 的 `compile/tests/lint` 都是字符串，不接受 `{cmd, cwd}` 对象。

## 10. Mechanical Verify 一直失败

先在目标项目目录手工执行同一个命令：

```bash
pnpm run build
pnpm test
```

确认：

- 命令本身存在；
- 环境依赖齐全；
- PATH 正确；
- 超时时间足够；
- tests 是否依赖 compile 输出。

如果有依赖关系，保持：

```yaml
parallel: false
```

## 11. 预算很快耗尽

查看：

```text
/orch budget
```

检查：

```yaml
budget:
  daily_limit_cny: 50
  task_limit_cny: 5
  count_passthrough: false
```

如果使用自定义模型但没有价格，请配置 `budget.pricing`，否则预算估算可能失真。

## 12. 任务卡住或耗时过长

检查 circuit breaker：

```yaml
circuit_breaker:
  total_llm_calls_max: 40
  total_tokens_max: 800000
  wall_clock_max_min: 30
  review_dispatch_timeout_ms: 300000
  audit_dispatch_timeout_ms: 180000
```

需要立即终止当前任务：

```text
/orch abort
```

## 13. Reviewer 说通过，但最终仍进入修复

这是设计行为。

如果 reviewer 通过但 compile/lint/tests 失败，dsh-per 仍会走机械修复路径，不会把模型判断当成真实验证结果。

## 14. 宿主重启后旧任务没有继续执行

当前正式版本采用安全恢复策略：遗留非终态任务不会自动重复执行，而是安全标记为 abandoned/aborted。

这是为了避免外部副作用被重复执行。checkpoint resume 属于后续架构演进项。

## 15. 测试出现 `MaxListenersExceededWarning`

当前测试环境重复创建 engine 时可能看到 process exit listener 相关 warning。现有测试仍可通过，但这是已知生命周期收敛项，不应通过简单提高 listener 上限来掩盖。

如果你在实际宿主环境遇到同类持续增长问题，请保留完整日志和复现步骤。

## 16. 如何确认当前安装版本

```bash
dsh plugin --profile <profile> list --depth 0
```

当前正式版本应显示：

```text
dsh-per 0.1.0
```

## 17. 报告问题时建议提供

- DSH / Harness 版本；
- Node.js 版本；
- pnpm 版本；
- profile 名称；
- dsh-per 安装来源（npm / Git / local / tarball）；
- `/orch status` 输出（注意隐藏敏感信息）；
- 实际报错和完整上下文；
- 是否可以稳定复现。

## 18. 相关文档

- [安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [配置参考](CONFIGURATION.md)
