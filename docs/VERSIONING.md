# dsh-per 版本策略

## 唯一正式版本

当前插件唯一正式发布版本为：

```text
v0.1.0
```

当前已经完成：

- npm：`dsh-per@0.1.0`；
- GitHub Release：`v0.1.0`；
- Release tarball：`dsh-per-0.1.0.tgz`。

版本的单一事实来源：

1. 根目录 `VERSION`；
2. `package.json.version`；
3. GitHub Release tag；
4. npm package version。

以上四处必须完全一致。

## 内部文档版本不是发布版本

仓库历史上使用过 `v1 / v2 / v3 / v4 / v5` 等编号描述方案、设计定稿或重构轮次。这些编号只代表**文档修订号 / 内部实施批次**，不得映射成 npm 或 GitHub Release 的语义版本。

后续文档建议改用：

- Round A / B / C；
- Phase A / B / C；
- Revision 1 / 2；

避免再次与插件版本混淆。

## 分支名也不是版本来源

分支名称不能覆盖或推导正式版本。

`main` 是唯一长期发布分支。fix / refactor / docs / release 分支只用于短期工作，合并后应删除或重新对齐到 `main`。

未经用户明确批准，不创建类似：

- `release/v0.2.0`；
- `release/v0.4.1`；
- `refactor/v1.0.0`。

即使历史分支名称中曾出现更高版本号，也不代表该版本曾正式发布。详细分支规则见 `docs/BRANCHING_AND_RELEASE.md`。

## 版本变更规则

未经用户明确要求：

- 不修改 `VERSION`；
- 不修改 `package.json.version`；
- 不创建新的正式版本 tag；
- 不以重构轮次、功能批次、CI 修复、文档更新或分支名称为理由自行升级插件版本。

当前所有重构、质量增强、CI 修复、文档完善和发布工程改进，默认继续归档到 `v0.1.0`。

## 机械门禁

`scripts/check-version.mjs` 会检查：

- `VERSION === 0.1.0`；
- `package.json.version === VERSION`；
- README、CHANGELOG、Release workflow 和当前项目计划不存在未经批准的其他正式发布版本号。

CI 和 `prepublishOnly` 都必须执行 `pnpm run version:check`。

## 发布要求

正式发布只允许从 `main` 产生。发布前必须通过：

1. version contract；
2. TypeScript；
3. 全量 tests；
4. build；
5. `ci:checks`；
6. `npm pack`。

如果 npm registry 已经存在 `dsh-per@0.1.0`，重复运行 release workflow 不应再次执行同版本 npm publish；GitHub Release 则允许幂等刷新附件。
