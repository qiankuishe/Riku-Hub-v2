# 迁移说明（v1 → v2）

本文档用于从旧版本项目迁移到当前 v2 架构。

## 迁移目标

- 前端统一到 Vue 3 + Element Plus + UnoCSS
- 后端从单体路由迁移为分层结构（Controller / Service / Repository / Route）
- 部署以 `CACHE_KV + DB(D1)` 为默认绑定

## 目录变化

- 已移除：
  - `packages/web/src-rebuild`
  - `packages/web/src/components/ui/*`（旧自定义 Ui 组件）
- 新增（后端分层）：
  - `packages/worker/src/controllers/*`
  - `packages/worker/src/services/*`
  - `packages/worker/src/repositories/*`
  - `packages/worker/src/routes/*`
  - `packages/worker/src/types/*`

## 部署配置变化

- 以 `wrangler.toml` 当前配置为准：
  - `CACHE_KV`：缓存数据
  - `DB`：结构化业务数据
- `APP_KV` 仍保留兼容分支，但非默认部署必需绑定。

## 数据库迁移

按顺序执行：

1. `migrations/0001_app_data.sql`
2. `migrations/0002_runtime_data.sql`
3. `migrations/0003_add_notes.sql`
4. `migrations/0004_add_clipboard.sql`
5. `migrations/0005_add_settings_logs.sql`

## 接口兼容策略

- 主接口保留：
  - `/api/navigation`、`/api/sources`、`/api/notes`、`/api/snippets`、`/api/settings/*`
- 兼容接口保留：
  - `/api/nav`、`/api/sub`、`/api/clipboard`、`/api/settings`（旧形态）

## 验证建议

每次迁移后执行：

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

全部通过后再执行部署。

