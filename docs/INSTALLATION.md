# dsh-per 安装指南

当前正式版本：**v0.1.0**。

本文所有默认命令都直接使用 DSH Web 的 `web` profile，方便复制执行。只有“自定义 profile”一节使用具体名称 `my-team` 说明替换方法，不使用尖括号占位符。

## 1. 推荐安装：npm 固定版本

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

含义：把 npm 上的 `dsh-per@0.1.0` 安装到 DSH 的 `web` profile。

安装后确认：

```bash
dsh plugin --profile web list --depth 0
```

应能看到：

```text
dsh-per 0.1.0
```

然后启动同一个 profile：

```bash
dsh --profile web
```

最重要的规则：**安装到哪个 profile，运行时就使用哪个 profile。**

## 2. 命令逐项解释

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

| 部分 | 含义 |
| --- | --- |
| `dsh` | DSH CLI |
| `plugin` | profile 插件管理 |
| `--profile web` | 操作 `web` profile |
| `add` | 安装插件/依赖 |
| `dsh-per` | npm 包名 |
| `@0.1.0` | 固定安装 0.1.0 |

## 3. 前置条件

### DSH CLI

```bash
dsh --help
```

### pnpm

DSH 当前 profile 插件管理会调用 pnpm：

```bash
pnpm --version
```

### Node.js

`dsh-per` package 要求：

```text
Node.js >= 22
```

需要本地构建时确认：

```bash
node --version
```

## 4. npm latest

如果希望安装 npm 当前 latest：

```bash
dsh plugin --profile web add dsh-per
```

当前 latest 为 `0.1.0`。生产和团队环境仍推荐固定版本：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

## 5. GitHub tag 安装

npm 访问受限时，可直接安装正式 Git tag：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

适合：

- npm 访问受限；
- 希望明确绑定 Git tag；
- 需要直接从 GitHub 获取包源码。

## 6. GitHub main 安装

只用于测试主线，不建议生产使用：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#main
```

正式环境优先固定 npm 版本或 `v0.1.0` tag。

## 7. GitHub Release tarball

Release 资产：

```text
dsh-per-0.1.0.tgz
```

Windows：

```powershell
dsh plugin --profile web add C:\Downloads\dsh-per-0.1.0.tgz
```

macOS / Linux：

```bash
dsh plugin --profile web add ~/Downloads/dsh-per-0.1.0.tgz
```

适合离线分发、内网归档和指定产物安装。

## 8. 本地源码安装

```bash
git clone https://github.com/coeasy/dsh_per.git
cd dsh_per
pnpm install --no-frozen-lockfile
pnpm run build
```

安装当前目录到 Web profile：

```bash
dsh plugin --profile web add .
```

Windows 绝对路径示例：

```powershell
dsh plugin --profile web add D:\github\dsh_per
```

macOS / Linux 绝对路径示例：

```bash
dsh plugin --profile web add /home/user/github/dsh_per
```

## 9. `file:` / `link:` 本地开发

复制式本地依赖：

```bash
dsh plugin --profile web add file:.
```

链接式本地依赖：

```bash
dsh plugin --profile web add link:.
```

开发阶段可使用 `link:`；正式使用推荐 npm 固定版本。

## 10. 自定义 profile

如果你的 DSH profile 叫 `my-team`，使用同一个具体名称完成所有操作：

安装：

```bash
dsh plugin --profile my-team add dsh-per@0.1.0
```

查看：

```bash
dsh plugin --profile my-team list --depth 0
```

启动：

```bash
dsh --profile my-team
```

更新：

```bash
dsh plugin --profile my-team update dsh-per
```

卸载：

```bash
dsh plugin --profile my-team remove dsh-per
```

不要把插件安装在 `my-team`，却用 `web` 启动；反过来也一样。

## 11. 安装后首次启动

默认 Web profile：

```bash
dsh --profile web
```

进入 Web 后打开：

```text
Settings → Plugins → dsh-per
```

配置 plan / execute / review 模型，然后执行：

```text
/orch status
```

如果提示“阶段模型未配置”，说明插件已加载，但还没有完成 stages 配置。

## 12. 最小启用配置

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

没有 `stages` 时，dsh-per 按设计保持 inert / passthrough。

## 13. 更新

npm 安装：

```bash
dsh plugin --profile web update dsh-per
```

重新固定正式版本：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

GitHub tag：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

本地源码：

```bash
git pull
pnpm install --no-frozen-lockfile
pnpm run build
dsh plugin --profile web add .
```

## 14. 卸载

```bash
dsh plugin --profile web remove dsh-per
```

卸载后确认：

```bash
dsh plugin --profile web list --depth 0
```

## 15. 重装

```bash
dsh plugin --profile web remove dsh-per
dsh plugin --profile web add dsh-per@0.1.0
```

## 16. Git 安装提示

如果 Git 依赖安装失败，并且 pnpm 明确提示构建脚本被 `allowBuilds` 阻止，请按 DSH 输出的 profile 目录和精确 package key 修改对应 `pnpm-workspace.yaml` 后重试。

不要在没有错误提示时预先放宽依赖构建权限。

## 17. 推荐方式一览

| 场景 | 推荐命令/方式 |
| --- | --- |
| DSH Web 普通用户 | `dsh plugin --profile web add dsh-per@0.1.0` |
| npm latest | `dsh plugin --profile web add dsh-per` |
| 团队/生产 | 固定 npm 版本 |
| npm 访问受限 | GitHub `v0.1.0` tag |
| 离线/内网 | Release tarball |
| 插件开发 | 本地目录或 `link:` |
| 测试主线 | GitHub `main`，仅测试使用 |

## 18. 最短上手流程

```bash
# 1. 安装
dsh plugin --profile web add dsh-per@0.1.0

# 2. 确认
dsh plugin --profile web list --depth 0

# 3. 启动
dsh --profile web
```

进入 Web 后：

1. 打开 `Settings → Plugins → dsh-per`；
2. 配置 plan / execute / review；
3. 执行 `/orch status`；
4. 执行 `/per 重构当前模块并运行测试` 验证完整编排。

## 19. 相关文档

- [使用指南](USAGE.md)
- [配置参考](CONFIGURATION.md)
- [故障排查](TROUBLESHOOTING.md)
