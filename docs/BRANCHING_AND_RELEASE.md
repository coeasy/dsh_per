# dsh-per 分支与发布维护规范

> 当前正式版本：`v0.1.0`  
> 长期分支：`main`

## 1. 分支原则

`main` 是仓库唯一长期维护分支，也是唯一发布来源。

短期分支仅用于单次任务，例如：

- `fix/<topic>`：问题修复；
- `refactor/<topic>`：内部重构；
- `docs/<topic>`：文档更新；
- `release/<topic>`：发布工程调整。

短期分支完成 PR 合并后不再继续开发，应删除或至少重新对齐到最新 `main`，避免形成第二条长期版本线。

## 2. 禁止用分支名表达正式版本升级

除非用户明确决定改变版本策略，否则不要用未来正式版本号命名分支。

建议使用主题式名称：

- `release/publish-pipeline`
- `refactor/runtime-state`
- `refactor/observability`
- `docs/config-reference`
- `fix/snapshot-recovery`

插件正式版本仍由 `VERSION`、`package.json.version`、npm 和 GitHub Release 共同约束，当前统一为 `0.1.0`。

## 3. 当前分支处理结论

2026-09-06 检查时，除 `main` 外还有两个历史短期分支：

- 一个是已经通过 PR #1 squash 合并完成的发布对齐分支；
- 一个是早期错误版本口径留下的 refactor/release 历史分支。

第二个分支中有价值的质量、恢复、可观测性和配置治理规划，已经被当前 `docs/PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md` 覆盖，因此不再保留独立开发意义。

本轮已将两个历史分支全部重新对齐到最新 `main`，不再存在独立代码差异或旧版本开发线。

## 4. PR 与合并规则

推荐流程：

```text
main
  -> short-lived branch
  -> implementation / docs
  -> CI
  -> PR
  -> squash merge
  -> branch cleanup
```

合并前至少满足：

1. `pnpm run version:check`；
2. TypeScript clean；
3. tests green；
4. build green；
5. `pnpm run ci:checks` green；
6. 未经明确授权不修改正式版本。

文档-only 改动也应保持版本契约不变。

## 5. 发布来源

正式发布只允许从 `main` 产生。

当前发布链：

```text
main
  -> version contract
  -> install
  -> typecheck
  -> tests
  -> build
  -> ci:checks
  -> npm pack
  -> npm publish（registry 尚无该版本时）
  -> GitHub Release / tarball
```

当前已发布：

- npm：`dsh-per@0.1.0`
- GitHub Release：`v0.1.0`
- Release 资产：`dsh-per-0.1.0.tgz`

## 6. 后续维护

后续所有质量增强、可观测性、恢复、配置治理和架构改进默认继续在 `v0.1.0` 主线上收敛。只有用户明确要求改变发布版本时，才允许同步调整：

- `VERSION`；
- `package.json.version`；
- README；
- CHANGELOG；
- GitHub Release tag；
- npm package version。
