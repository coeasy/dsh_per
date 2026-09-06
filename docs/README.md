# dsh-per 文档中心

当前正式版本统一为 **v0.1.0**。

## 文档命令约定

为了避免占位符造成误解，**所有面向用户的命令示例默认统一使用 DSH Web 的 `web` profile**：

```bash
dsh plugin --profile web add dsh-per@0.1.0
dsh plugin --profile web list --depth 0
dsh --profile web
```

如果你使用自定义 profile，例如 `my-team`，就把同一组命令里的 `web` 一致替换为 `my-team`：

```bash
dsh plugin --profile my-team add dsh-per@0.1.0
dsh plugin --profile my-team list --depth 0
dsh --profile my-team
```

关键规则：**安装到哪个 profile，运行、查看、更新和卸载时都使用同一个 profile。**

## 新用户推荐顺序

1. **[安装指南](INSTALLATION.md)**：固定 npm 版本、npm latest、GitHub tag、Release tarball、本地源码、更新和卸载。
2. **[使用指南](USAGE.md)**：启动 `web` profile、完成最小配置、掌握 `/per` 与 `/orch`。
3. **[配置参考](CONFIGURATION.md)**：配置 gate、stages、预算、机械验证、熔断和风险策略。
4. **[故障排查](TROUBLESHOOTING.md)**：安装、加载、模型、验证和运行时常见问题。

## 面向不同角色

### 普通用户

- [安装指南](INSTALLATION.md)
- [使用指南](USAGE.md)
- [故障排查](TROUBLESHOOTING.md)

### 高级用户 / 团队管理员

- [配置参考](CONFIGURATION.md)
- [版本策略](VERSIONING.md)
- [分支与发布维护](BRANCHING_AND_RELEASE.md)

### 开发者 / 维护者

- [项目功能、架构与重构计划](PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md)
- [E2E 测试基线](E2E测试报告-v0.1.0.md)
- [分支与发布维护](BRANCHING_AND_RELEASE.md)

### 社区传播 / 项目介绍

- [项目介绍与宣传稿](PROMOTION.md)

## 当前正式发布

- npm：`dsh-per@0.1.0`
- GitHub Release：`v0.1.0`
- Release tarball：`dsh-per-0.1.0.tgz`
- 长期分支：`main`

## 文档维护原则

- README 只保留产品介绍、快速安装、快速使用和文档导航。
- 安装、使用、配置、排障分别维护。
- 所有可复制的 DSH 用户命令默认写成 `--profile web`，不再使用 profile 占位符。
- 自定义 profile 只使用具体名称示例，例如 `my-team`。
- 新功能必须同步检查 README、USAGE、CONFIGURATION、INSTALLATION 和 TROUBLESHOOTING。
- 正式版本只由 `VERSION`、`package.json.version`、npm 与 GitHub Release 共同确定。
