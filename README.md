# Riku-Hub

Cloudflare Workers 版的 Riku-Hub 聚合服务。当前仓库保留了主接口和兼容接口，部署按仓库内 `wrangler.toml` 直接落地即可。

## 组成

- `packages/worker`：Worker API、Cron 刷新、KV / D1 访问
- `packages/web`：Vue 3 管理后台和静态页面入口
- `packages/shared`：解析、转换、类型与公共工具

## 前端技术栈（v2）

- Vue 3 + TypeScript
- Element Plus（统一 UI 组件）
- UnoCSS（原子化样式）
- @iconify/vue + Carbon Icons（图标）

## 当前部署事实

- 运行时按当前配置只绑定：`CACHE_KV` + `DB`。
- `CACHE_KV` 只存缓存数据：聚合结果、格式化输出、favicon 和 DNS 缓存。
- `DB`（D1）承载结构化表和主业务数据（会话、导航、订阅、笔记、片段、剪贴板、设置、日志等）。
- `APP_KV` 仅保留为代码中的兼容分支，不在当前默认部署路径中启用。

部署细节见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)，接口清单见 [`docs/API.md`](./docs/API.md)，迁移说明见 [`docs/MIGRATION.md`](./docs/MIGRATION.md)。

## 迁移脚本

- `migrations/0001_app_data.sql`：导航、笔记、片段、应用日志基础表。
- `migrations/0002_runtime_data.sql`：`app_meta`、会话、登录限流、订阅源。
- `migrations/0003_add_notes.sql`：笔记文件夹和笔记版本。
- `migrations/0004_add_clipboard.sql`：剪贴板表。
- `migrations/0005_add_settings_logs.sql`：设置和日志表。
- `migrations/0001_initial.sql` 与 `0001_app_data.sql` 内容重复，部署时按 `0001_app_data.sql` 这条线执行即可。

## 本地开发

```bash
pnpm install
pnpm dev:web
pnpm dev:worker
```

## 构建与测试

- `pnpm build`：workspace 级 build / type-check
- `pnpm build:web`：生成 `packages/web/dist`
- `pnpm check`：workspace 级类型检查
- `pnpm test`：workspace 级 Vitest
- `pnpm deploy`：先执行 `check + test + build:web`，再执行 `wrangler deploy`

## 路由兼容现状

- API 主路径是 `/api/navigation` 和 `/api/snippets`。
- API 兼容别名是 `/api/nav` 和 `/api/clipboard`。
- 页面主路径是 `/nav` 和 `/snippets`。
- 页面兼容别名是 `/navigation -> /nav`，`/clipboard -> /snippets`。
- 现在两套前缀都还在，前端入口按主路径工作，兼容路径只用于历史链接和旧调用。
- 兼容注册接口 `/api/auth/register` 默认关闭。
- 只有同时设置 `COMPAT_ALLOW_REGISTER=true` 且配置 `COMPAT_REGISTER_KEY` 时才允许注册。
- 登录页公开节点接口 `/api/clipboard/public` 默认关闭，需设置 `PUBLIC_CLIPBOARD_ENABLED=true` 才会返回公开节点。
