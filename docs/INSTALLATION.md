# dsh-per 安装指南

本文覆盖 dsh-per 的主要安装方式、安装验证、升级、重装、卸载和常见安装问题。当前正式版本为 **v0.1.0**。

## 1. 先看最常用的安装方式

如果你平时使用 DSH Web，直接执行：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

然后使用同一个 `web` profile 启动：

```bash
dsh --profile web
```

验证插件是否已经安装：

```bash
dsh plugin --profile web list --depth 0
```

如果列表中能看到：

```text
dsh-per 0.1.0
```

说明 npm 包已经装进 `web` profile。

## 2. `--profile web` 到底是什么意思？

DSH 使用 **profile** 来表示一套独立的运行配置和插件组合。

可以把它理解成：

```text
一个 profile = 一套 DSH 配置 + 一组插件 + 一组 bundle/patch
```

例如官方常见的 Web 使用方式是：

```bash
dsh --profile web
```

因此，要让 dsh-per 在这个 Web 环境里生效，就应该把它安装到同一个 `web` profile：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

### 文档中的 `<profile>` 是占位符

下面这种写法：

```bash
dsh plugin --profile <profile> add dsh-per@0.1.0
```

不是让你原样复制 `<profile>`。

你必须把 `<profile>` 换成实际 profile 名称。

如果使用 Web：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

如果你自己有一个名为 `my-team` 的 profile：

```bash
dsh plugin --profile my-team add dsh-per@0.1.0
```

之后运行时也应使用同一个 profile：

```bash
dsh --profile my-team
```

最重要的一条规则：

> **插件安装到哪个 profile，运行 DSH 时就要使用哪个 profile。**

## 3. 安装命令逐项解释

以这条命令为例：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

含义如下：

| 部分 | 含义 |
| --- | --- |
| `dsh` | 调用 DeepSeek Harness / DSH CLI |
| `plugin` | 进入 profile 插件管理 |
| `--profile web` | 操作名为 `web` 的 profile |
| `add` | 安装一个依赖/插件 |
| `dsh-per` | npm 包名 |
| `@0.1.0` | 固定安装 dsh-per 的 0.1.0 版本 |

所以整条命令可以理解成：

> **把 npm 上的 `dsh-per@0.1.0` 安装到 DSH 的 `web` profile 中。**

## 4. 前置条件

### 4.1 DeepSeek Harness / DSH CLI

先确认 `dsh` 可以执行：

```bash
dsh --help
```

通用插件管理命令格式是：

```bash
dsh plugin --profile <你的-profile-名称> <pnpm-command...>
```

DSH 会在目标 profile 中执行对应的 pnpm 操作，并在操作成功后重新计算已安装的 bundle 层。

### 4.2 pnpm

当前 DSH 的 profile 插件管理依赖 pnpm，请确认：

```bash
pnpm --version
```

仓库开发环境固定使用 `pnpm@9.15.9`。如果只是通过 DSH 安装插件，优先遵循你当前 Harness/DSH 环境对 pnpm 的要求。

### 4.3 Node.js

`dsh-per` package 声明：

```text
Node.js >= 22
```

如果需要从源码构建或本地调试，请确认：

```bash
node --version
```

## 5. 推荐方式：npm 固定版本

对于普通用户、生产环境和团队环境，推荐：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

如果不是 `web` profile，则把 `web` 换成你的实际 profile 名称。

优点：

- 安装最快；
- 版本明确；
- 不受 npm latest 后续变化影响；
- 适合团队统一环境。

## 6. npm latest

如果希望直接使用 npm 当前默认版本：

```bash
dsh plugin --profile web add dsh-per
```

当前 npm 正式版本就是 `0.1.0`。

正式环境仍建议显式固定版本：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

## 7. GitHub tag 安装

npm 访问受限时，可以从正式 Git tag 安装：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

这种方式绑定正式 Git tag，也适合需要从 GitHub 直接获取源码构建产物的环境。

## 8. GitHub main 安装

只建议测试当前主线，不建议生产环境使用：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#main
```

`main` 会持续变化；正式环境应优先使用 npm 固定版本或 `v0.1.0` tag。

## 9. GitHub Release tarball 安装

GitHub Release 提供：

```text
dsh-per-0.1.0.tgz
```

下载后，可以直接安装本地 tarball。

### Windows

```powershell
dsh plugin --profile web add C:\Downloads\dsh-per-0.1.0.tgz
```

### macOS / Linux

```bash
dsh plugin --profile web add ~/Downloads/dsh-per-0.1.0.tgz
```

适合：

- 离线分发；
- 内网环境；
- 归档安装；
- 指定 Release 产物安装。

## 10. 从本地源码安装

适合开发和调试：

```bash
git clone https://github.com/coeasy/dsh_per.git
cd dsh_per
pnpm install --no-frozen-lockfile
pnpm run build
```

如果要安装到 Web profile：

```bash
dsh plugin --profile web add .
```

也可以使用绝对路径。

### Windows

```powershell
dsh plugin --profile web add D:\github\dsh_per
```

### macOS / Linux

```bash
dsh plugin --profile web add /home/user/github/dsh_per
```

DSH 会把相对文件路径锚定到你运行命令时的目录，再交给 pnpm 处理。

## 11. `file:` / `link:` 本地安装

因为 `dsh plugin` 会把参数转发给 pnpm，也可以使用 pnpm 文件依赖语法。

复制式本地依赖：

```bash
dsh plugin --profile web add file:.
```

链接式本地依赖：

```bash
dsh plugin --profile web add link:.
```

开发时希望源码变化快速反映到 profile，可考虑 `link:`；正式使用建议 npm 固定版本。

## 12. 安装后怎么启动？

如果安装到了 `web`：

```bash
dsh --profile web
```

如果安装到了自定义 `my-team`：

```bash
dsh --profile my-team
```

不要把插件装在一个 profile，却启动另一个 profile，否则运行环境里不会加载你刚安装的插件。

## 13. 安装后验证

以 Web profile 为例：

```bash
dsh plugin --profile web list --depth 0
```

确认存在：

```text
dsh-per 0.1.0
```

启动 DSH Web：

```bash
dsh --profile web
```

进入会话后执行：

```text
/orch status
```

如果插件已经加载但尚未配置 stages，状态会提示阶段模型未配置；这是正常的默认 inert 行为。

## 14. 首次启用

安装完成不代表自动接管所有任务。dsh-per 默认 `config: {}`，没有配置 `stages` 时保持 passthrough。

你可以在：

```text
Settings → Plugins → dsh-per
```

配置常用模型和预算，也可以使用 profile patch 覆盖 `per` 行。

最小示例：

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

完整配置见 [CONFIGURATION.md](CONFIGURATION.md)。

## 15. 更新

### 更新 npm 安装

Web profile：

```bash
dsh plugin --profile web update dsh-per
```

如果希望继续固定正式版本，可以重新执行：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

### 更新 GitHub 安装

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

### 更新本地源码

```bash
git pull
pnpm install --no-frozen-lockfile
pnpm run build
dsh plugin --profile web add .
```

## 16. 卸载

如果插件安装在 Web profile：

```bash
dsh plugin --profile web remove dsh-per
```

DSH 在 pnpm 删除成功后会重新计算 profile bundle 列表，使 dsh-per 不再作为该 profile 的 layer 加载。

卸载后验证：

```bash
dsh plugin --profile web list --depth 0
```

## 17. 重装

```bash
dsh plugin --profile web remove dsh-per
dsh plugin --profile web add dsh-per@0.1.0
```

如果你使用的是其他 profile，请把两条命令里的 `web` 一起替换成实际 profile 名称。

## 18. Git 安装提示

DSH 上游会在 Git 依赖安装失败时提示 profile 目录位置。某些 pnpm 版本可能限制 Git 依赖的构建脚本；如果 pnpm 明确提示 `allowBuilds`，按它输出的精确 package key 写入目标 profile 的 `pnpm-workspace.yaml` 后重试。

不要在没有错误提示时预先放宽构建脚本权限。

## 19. 选择哪一种方式

| 场景 | 推荐命令/方式 |
| --- | --- |
| DSH Web 普通用户 | `dsh plugin --profile web add dsh-per@0.1.0` |
| 团队/生产 | 固定 npm 版本 |
| npm 访问受限 | GitHub `v0.1.0` tag |
| 离线/内网 | Release tarball |
| 插件开发 | 本地目录或 `link:` |
| 测试主线 | GitHub `main`，仅测试使用 |

## 20. 最短上手流程

如果你只是想立即用起来，按下面顺序执行：

```bash
# 1. 安装到 Web profile
dsh plugin --profile web add dsh-per@0.1.0

# 2. 确认已安装
dsh plugin --profile web list --depth 0

# 3. 启动同一个 Web profile
dsh --profile web
```

进入 Web 后：

1. 打开 `Settings → Plugins → dsh-per`；
2. 配置 plan / execute / review 模型；
3. 在会话里执行 `/orch status`；
4. 用 `/per <任务>` 强制启动一次编排任务进行验证。

## 21. 下一步

- 首次使用：[USAGE.md](USAGE.md)
- 完整配置：[CONFIGURATION.md](CONFIGURATION.md)
- 安装和运行问题：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
