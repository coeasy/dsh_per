# dsh-per 文档中心

这里是 dsh-per 的当前有效文档入口。项目正式版本统一为 **v0.1.0**；历史项目梳理、重构轮次和优化草案已经合并到当前架构与重构计划，不再作为独立维护文档。

## 新用户推荐顺序

1. **[安装指南](INSTALLATION.md)**：选择 npm、固定版本、GitHub tag、本地源码或 tarball 安装。
2. **[使用指南](USAGE.md)**：完成最小配置，掌握 `/per` 与 `/orch`。
3. **[配置参考](CONFIGURATION.md)**：按需配置 gate、stages、预算、机械验证、熔断和风险策略。
4. **[故障排查](TROUBLESHOOTING.md)**：安装、启用、模型、验证和运行时常见问题。

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

- README 只保留最重要的产品介绍、快速安装、快速使用和文档导航。
- 安装、使用、配置、排障分别维护，避免一个 README 无限膨胀。
- 只有当前有效方案放在 docs 根目录；历史重构草案不再与正式文档并列。
- 新功能必须同时检查是否需要更新 README、USAGE、CONFIGURATION 或 TROUBLESHOOTING。
- 发布版本只有一套事实来源：`VERSION`、`package.json.version`、npm 与 GitHub Release。
