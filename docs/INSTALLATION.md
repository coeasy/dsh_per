# dsh-per 安装指南

本文覆盖 dsh-per 的主要安装方式、安装验证、升级、重装、卸载和常见安装问题。当前正式版本为 **v0.1.0**。

## 1. 前置条件

### 1.1 DeepSeek Harness / DSH CLI

先确认 `dsh` 可以执行：

```bash
dsh --help
```

插件安装命令格式为：

```bash
dsh plugin --profile <profile> <pnpm-command...>
```

DSH 会在目标 profile 中执行对应的 pnpm 操作，并在操作成功后重新计算已安装的 bundle 层。

### 1.2 pnpm

当前 DSH 的 profile 插件管理依赖 pnpm，请确认：

```bash
pnpm --version
```

仓库开发环境固定使用 `pnpm@9.15.9`。如果只是通过 DSH 安装插件，优先遵循你当前 Harness/DSH 环境对 pnpm 的要求。

### 1.3 Node.js

`dsh-per` package 声明：

```text
Node.js >= 22
```

如果你需要从源码构建或本地调试，请确认：

```bash
node --version
```

## 2. 推荐方式：从 npm 安装固定版本

生产、团队和可复现环境推荐固定正式版本：

```bash
dsh plugin --profile <profile> add dsh-per@0.1.0
```

示例：

```bash
dsh plugin --profile web add dsh-per@0.1.0
```

优点：

- 安装最快；
- 版本明确；
- 不受 npm latest 后续变化影响；
- 适合团队统一环境。

## 3. 从 npm 安装 latest

如果希望直接使用 npm 当前默认版本：

```bash
dsh plugin --profile <profile> add dsh-per
```

当前 npm 正式版本就是 `0.1.0`。

对于生产环境，仍建议显式写固定版本。

## 4. 从 GitHub tag 安装

适合希望直接从 GitHub 正式 tag 安装的用户：

```bash
dsh plugin --profile <profile> add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

示例：

```bash
dsh plugin --profile web add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

这种方式绑定正式 Git tag，适合 npm 访问受限但 GitHub 可用的环境。

## 5. 从 GitHub main 安装

只建议测试当前主线，不建议生产环境使用：

```bash
dsh plugin --profile <profile> add git+https://github.com/coeasy/dsh_per.git#main
```

`main` 会持续变化；正式环境应优先使用 npm 固定版本或 `v0.1.0` tag。

## 6. 从 GitHub Release tarball 安装

GitHub Release 提供：

```text
dsh-per-0.1.0.tgz
```

下载到本地后，可以把 tarball 路径直接交给 DSH：

### Windows

```powershell
dsh plugin --profile web add C:\Downloads\dsh-per-0.1.0.tgz
```

### macOS / Linux

```bash
dsh plugin --profile web add ~/Downloads/dsh-per-0.1.0.tgz
```

这种方式适合：

- 离线分发；
- 内网镜像；
- 归档安装；
- 安装指定 Release 产物。

## 7. 从本地源码安装

适合开发和调试。

```bash
git clone https://github.com/coeasy/dsh_per.git
cd dsh_per
pnpm install --no-frozen-lockfile
pnpm run build
```

然后安装当前目录：

```bash
dsh plugin --profile <profile> add .
```

也可以使用绝对路径：

### Windows

```powershell
dsh plugin --profile web add D:\github\dsh_per
```

### macOS / Linux

```bash
dsh plugin --profile web add /home/user/github/dsh_per
```

DSH 会把相对文件路径锚定到你运行命令时的目录，再交给 pnpm 处理。

## 8. 使用 file: / link: 本地安装

因为 `dsh plugin` 会把参数转发给 pnpm，也可以使用 pnpm 的文件依赖语法。

复制式本地依赖：

```bash
dsh plugin --profile web add file:.
```

链接式本地依赖：

```bash
dsh plugin --profile web add link:.
```

开发时如果希望源码变化能快速反映到 profile，可考虑 `link:`；正式使用建议 npm 固定版本。

## 9. 安装后验证

查看 profile 已安装依赖：

```bash
dsh plugin --profile <profile> list --depth 0
```

确认列表中存在：

```text
dsh-per 0.1.0
```

进入 DSH 会话后，再执行：

```text
/orch status
```

如果插件已经加载但还没有配置 stages，状态会提示阶段模型未配置；这是正常的默认 inert 行为。

## 10. 首次启用

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

## 11. 更新

### 更新 npm 安装

```bash
dsh plugin --profile <profile> update dsh-per
```

如果你希望继续固定正式版本，可重新执行：

```bash
dsh plugin --profile <profile> add dsh-per@0.1.0
```

### 更新 GitHub 安装

重新执行对应 Git spec：

```bash
dsh plugin --profile <profile> add git+https://github.com/coeasy/dsh_per.git#v0.1.0
```

### 更新本地源码

```bash
git pull
pnpm install --no-frozen-lockfile
pnpm run build
dsh plugin --profile <profile> add .
```

## 12. 卸载

```bash
dsh plugin --profile <profile> remove dsh-per
```

DSH 在 pnpm 删除成功后会重新计算 profile bundle 列表，使 dsh-per 不再作为 profile 层加载。

卸载后可以验证：

```bash
dsh plugin --profile <profile> list --depth 0
```

## 13. 重装

出现依赖状态异常时，可执行：

```bash
dsh plugin --profile <profile> remove dsh-per
dsh plugin --profile <profile> add dsh-per@0.1.0
```

如果问题来自 profile 本身，先记录你的 profile 配置，再检查 DSH profile 目录与 pnpm 错误输出。

## 14. Git 安装提示

DSH 上游会在 Git 依赖安装失败时提示 profile 目录位置。某些 pnpm 版本可能限制 Git 依赖的构建脚本；如果 pnpm 明确提示 `allowBuilds`，按它输出的精确 package key 写入目标 profile 的 `pnpm-workspace.yaml` 后重试。

不要在没有错误提示时预先放宽构建脚本权限。

## 15. 选择哪一种方式

| 场景 | 推荐安装方式 |
| --- | --- |
| 普通用户 | `dsh-per@0.1.0` |
| 团队/生产 | 固定 npm 版本 |
| npm 访问受限 | GitHub `v0.1.0` tag |
| 离线/内网 | Release tarball |
| 插件开发 | 本地目录或 `link:` |
| 测试主线 | GitHub `main`，仅测试使用 |

## 16. 下一步

- 首次使用：[USAGE.md](USAGE.md)
- 完整配置：[CONFIGURATION.md](CONFIGURATION.md)
- 安装和运行问题：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
