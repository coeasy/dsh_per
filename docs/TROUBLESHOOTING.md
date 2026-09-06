# dsh-per 故障排查

当前正式版本：**v0.1.0**。

本文所有默认命令统一使用 DSH Web 的 `web` profile。

## 1. `dsh plugin` 提示 pnpm not found

现象：

```text
dsh: pnpm not found on PATH
```

处理：

```bash
pnpm --version
```

如果不存在，先安装 pnpm，并重新打开终端确保 PATH 生效。

## 2. npm 安装失败

先确认 npm 上存在正式版本：

```bash
npm view dsh-per@0.1.0 version
```

重新安装：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

如果 `web` profile 中已有异常依赖状态：

```bash
dsh plugin --profile web remove dsh-per
dsh plugin --profile web add dsh-per@0.1.0
```

## 3. GitHub 安装失败

固定 tag：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

如果 pnpm 明确提示 Git 依赖构建脚本被 `allowBuilds` 阻止，按照 DSH 输出的 profile 目录和 package key 修改对应 `pnpm-workspace.yaml` 后重试。

不要为了排障无条件允许所有依赖执行构建脚本。

## 4. 插件装了，但启动后看不到

先确认安装位置：

```bash
dsh plugin --profile web list --depth 0
```

然后确保启动的也是同一个 profile：

```bash
dsh --profile web
```

如果你把插件装在 `web`，却启动其他 profile，运行环境不会加载刚安装的插件。

## 5. 插件加载了，但没有进入编排

dsh-per 默认 bundle 配置是：

```yaml
- insert:
    - id: per
      name: dsh-per
      config: {}
```

没有 `stages` 时，插件故意保持 inert / passthrough。

进入 Web 会话执行：

```text
/orch status
```

如果看到“阶段模型未配置”，请在 Settings 或 profile patch 中配置 plan / execute / review。

## 6. 想强制测试插件是否工作

配置 stages 后：

```text
/per 请分析当前任务并给出执行计划
```

或者：

```text
/orch task 请分析当前任务并给出执行计划
```

这两个入口都会绕过 Gate 强制进入编排。

## 7. 普通问题总被编排

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

长期分流不合理时，检查 `gate.passthrough_patterns`、`gate.orchestrate_patterns` 和 `gate.default`。

## 8. reasoning effort 不兼容

当前可配置档位：

```text
off / low / medium / high / max
```

并非所有 provider/model 都支持全部档位。不确定时先用：

```yaml
reasoning_effort: off
```

## 9. `/orch set` 没有影响所有配置

`/orch set` 只覆盖当前 session 的 stage model。

具体示例：

```text
/orch set plan=vendor/planner execute=vendor/executor review=vendor/reviewer
```

它不会修改 gate、预算、机械验证等高级配置。

清除：

```text
/orch reset
```

保存：

```text
/orch save
```

## 10. 机械验证配置报错

正确：

```yaml
mechanical_verification:
  commands:
    compile: pnpm run build
    tests: pnpm test
```

错误：

```yaml
compile:
  cmd: pnpm run build
  cwd: .
```

当前 schema 的 `compile/tests/lint` 都是字符串，不接受 `{cmd, cwd}` 对象。

## 11. Mechanical Verify 一直失败

先在目标项目目录手工执行：

```bash
pnpm run build
pnpm test
```

确认：

- 命令存在；
- 依赖齐全；
- PATH 正确；
- 超时时间足够；
- tests 是否依赖 compile 输出。

有依赖关系时保持：

```yaml
parallel: false
```

## 12. 预算很快耗尽

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

自定义模型建议配置 `budget.pricing`。

## 13. 任务卡住或耗时过长

检查：

```yaml
circuit_breaker:
  total_llm_calls_max: 40
  total_tokens_max: 800000
  wall_clock_max_min: 30
  review_dispatch_timeout_ms: 300000
  audit_dispatch_timeout_ms: 180000
```

立即终止：

```text
/orch abort
```

## 14. Reviewer 说通过，但最终仍进入修复

这是设计行为。

如果 reviewer 通过但 compile/lint/tests 失败，dsh-per 仍走机械修复路径，不会把模型判断当成真实验证结果。

## 15. 宿主重启后旧任务没有继续执行

当前正式版本采用安全恢复策略：遗留非终态任务不会自动重复执行，而是安全标记为 abandoned/aborted。

这是为了避免外部副作用被重复执行。

## 16. 测试出现 `MaxListenersExceededWarning`

当前测试环境重复创建 engine 时可能看到 process exit listener 相关 warning。现有测试仍能通过，但这是已知生命周期收敛项，不应通过提高 listener 上限掩盖。

## 17. 如何确认当前安装版本

```bash
dsh plugin --profile web list --depth 0
```

当前应显示：

```text
dsh-per 0.1.0
```

## 18. 自定义 profile 排障

如果你的 profile 是 `my-team`，所有排障命令也要保持一致：

```bash
dsh plugin --profile my-team list --depth 0
dsh --profile my-team
```

不要混用 `web` 和 `my-team`。

## 19. 报告问题时建议提供

- DSH / Harness 版本；
- Node.js 版本；
- pnpm 版本；
- 实际 profile 名称；
- dsh-per 安装来源；
- `/orch status` 输出（隐藏敏感信息）；
- 完整错误日志；
- 稳定复现步骤。

## 20. 相关文档

- [安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [配置参考](CONFIGURATION.md)
