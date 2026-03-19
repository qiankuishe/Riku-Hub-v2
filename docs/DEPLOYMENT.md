# Deployment

这份文档只写当前仓库真实可用的部署步骤，不预设额外基础设施。

## 绑定

- `CACHE_KV`：缓存 KV，存聚合结果、格式化输出、favicon 和 DNS 缓存。
- `DB`：Cloudflare D1，存结构化业务表。

当前仓库默认部署只需要 `CACHE_KV` 和 `DB`。  
`APP_KV` 仅作为兼容分支保留，不在当前默认部署链路中要求绑定。

## 迁移顺序

- `migrations/0001_app_data.sql`
- `migrations/0002_runtime_data.sql`
- `migrations/0003_add_notes.sql`
- `migrations/0004_add_clipboard.sql`
- `migrations/0005_add_settings_logs.sql`

`migrations/0001_initial.sql` 和 `0001_app_data.sql` 内容重复，部署时只保留一条执行线即可，当前文档按 `0001_app_data.sql` 作为起点。

## 部署步骤

1. 安装依赖。

```bash
pnpm install
```

2. 创建 KV namespace 和 D1 数据库，然后把结果填进 `wrangler.toml`（或直接在 Dashboard 绑定同名变量）。

```bash
pnpm dlx wrangler kv namespace create CACHE_KV
pnpm dlx wrangler d1 create riku-hub-db
```

3. 按顺序执行迁移。

```bash
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0001_app_data.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0002_runtime_data.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0003_add_notes.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0004_add_clipboard.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0005_add_settings_logs.sql
```

4. 设置 secrets。

```bash
pnpm dlx wrangler secret put ADMIN_USERNAME
pnpm dlx wrangler secret put ADMIN_PASSWORD_HASH
pnpm dlx wrangler secret put SUB_TOKEN
```

5. 生成前端静态资源并部署。

```bash
pnpm build:web
pnpm deploy
```

`pnpm deploy` 本身会先执行 `build:web`，所以日常部署直接跑 `pnpm deploy` 就够了。

## 本地开发

- `pnpm dev:web`：启动 Vite 前端。
- `pnpm dev:worker`：启动 Wrangler Worker。
- `pnpm build:web`：检查前端打包是否可用。
- `pnpm test`：跑 workspace 里的测试。

## 路由兼容

- `GET /api/navigation` 和 `GET /api/snippets` 是当前主接口。
- `GET /api/nav` 和 `GET /api/clipboard` 仍保留为兼容别名。
- 页面路由当前以 `/nav` 和 `/snippets` 为准。
- `/navigation` 和 `/clipboard` 仍会被前端路径归一化到主路由，但它们属于兼容入口，不建议当作新链接写进文档或配置。
