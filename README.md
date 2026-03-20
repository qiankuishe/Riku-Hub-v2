# Riku-Hub

Cloudflare Workers 版的 Riku-Hub 聚合服务。当前仓库保留了主接口和兼容接口，部署按仓库内 `wrangler.toml` 直接落地即可。

## 当前状态（2026-03-20）

- Week 1 P0（安全修复）已完成
- Week 2 P1（重构与稳定性）已完成
- **前后台分离架构**已部署：
  - 公开首页：`/`（3D 背景展示）
  - 后台管理：`/riku/*`（可配置 Cloudflare Access 保护）
  - 图片外链：`/i/:id/:filename`（公开访问）
- 图床功能完整上线（Telegram 存储）
- 最新验证：`check + test` 全通过（`67/67`）

## 架构说明

### 公开访问（无需认证）
- `/` - 首页（3D 背景展示页）
- `/i/:id/:filename` - 图片外链（公开访问）

### 受保护路径（可配置 Cloudflare Access）
- `/riku/login` - 登录页面
- `/riku/nav` - 网站导航
- `/riku/images` - 图床管理
- `/riku/notes` - 笔记管理
- `/riku/snippets` - 代码片段
- `/riku/subscriptions` - 订阅聚合
- `/riku/logs` - 运行日志
- `/riku/settings` - 系统设置

### API 端点（Session Token 认证）
- `/api/*` - 所有 API 接口

## 组成

- `packages/worker`：Worker API、Cron 刷新、KV / D1 访问
- `packages/web`：Vue 3 管理后台和静态页面入口
- `packages/shared`：解析、转换、类型与公共工具

## 前端技术栈（v2）

- Vue 3 + TypeScript
- Element Plus（统一 UI 组件）
- UnoCSS（原子化样式）
- @iconify/vue + Carbon Icons（图标）
- Three.js（3D 背景效果）

## 当前部署事实

- 运行时按当前配置只绑定：`CACHE_KV` + `DB`
- `CACHE_KV` 只存缓存数据：聚合结果、格式化输出、favicon 和 DNS 缓存
- `DB`（D1）承载结构化表和主业务数据（会话、导航、订阅、笔记、片段、剪贴板、图床、设置、日志等）
- `APP_KV` 仅保留为代码中的兼容分支，不在当前默认部署路径中启用

部署细节见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)，接口清单见 [`docs/API.md`](./docs/API.md)，迁移说明见 [`docs/MIGRATION.md`](./docs/MIGRATION.md)。

## 图床功能

- 基于 Telegram Bot API 的免费存储方案
- 支持图片、视频、音频、文档（最大 20MB）
- 短链接格式：`/i/{8位短ID}/{文件名}`
- 支持收藏、黑白名单、批量操作
- 公开访问，无需认证

## 文档索引

- 部署文档：[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)
- 安全文档：[`docs/SECURITY.md`](./docs/SECURITY.md)
- 故障排查：[`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md)
- 接口文档：[`docs/API.md`](./docs/API.md)
- 迁移文档：[`docs/MIGRATION.md`](./docs/MIGRATION.md)
- Cloudflare Access 配置：[`CLOUDFLARE_ACCESS_SETUP.md`](./CLOUDFLARE_ACCESS_SETUP.md)

## 数据库迁移

- `migrations/0001_app_data.sql`：导航、笔记、片段、应用日志基础表
- `migrations/0002_runtime_data.sql`：`app_meta`、会话、登录限流、订阅源
- `migrations/0003_add_short_id.sql`：图床短 ID 字段
- `migrations/0004_add_clipboard.sql`：剪贴板表
- `migrations/0005_add_settings_logs.sql`：设置和日志表

## 本地开发

```bash
pnpm install
pnpm dev:web
pnpm dev:worker
```

## 构建与部署

```bash
# 构建前端
cd packages/web
npm run build

# 部署到 Cloudflare
cd ../..
npx wrangler deploy
```

或使用 workspace 命令：

```bash
pnpm check    # 类型检查
pnpm test     # 运行测试
pnpm build    # 构建项目
```

## 路由说明

### 页面路由
- 主路径：`/riku/*`（新架构）
- 旧路径自动重定向：`/login` → `/riku/login`，`/images` → `/riku/images` 等

### API 路由
- 主路径：`/api/navigation`、`/api/snippets`、`/api/images`
- 兼容别名：`/api/nav`、`/api/clipboard`

### 特殊路由
- `/i/:id/:filename` - 图片外链（公开）
- `/sub/:token` - 订阅聚合端点
- `/health` - 健康检查

## 环境变量

### 必需
- `TELEGRAM_BOT_TOKEN` - Telegram Bot Token（图床功能）
- `TELEGRAM_CHAT_ID` - Telegram Chat ID（图床功能）

### 可选
- `AGGREGATE_TTL_SECONDS` - 聚合缓存时间（默认 3600）
- `MAX_LOG_ENTRIES` - 最大日志条数（默认 200）
- `PUBLIC_CLIPBOARD_ENABLED` - 公开剪贴板（默认 false）
- `COMPAT_ALLOW_REGISTER` - 允许注册（默认 false）
- `COMPAT_REGISTER_KEY` - 注册密钥

## Cloudflare Access 配置

推荐配置 Cloudflare Access 保护 `/riku/*` 路径：

1. 进入 Cloudflare Dashboard → Zero Trust
2. 创建 Self-hosted 应用
3. 配置路径：`/riku`
4. 设置认证方式（邮箱/GitHub/等）

详细步骤见 [`CLOUDFLARE_ACCESS_SETUP.md`](./CLOUDFLARE_ACCESS_SETUP.md)

## 安全特性

- **双重认证**：Cloudflare Access（前端）+ Session Token（API）
- **登录限流**：防止暴力破解
- **密码哈希**：bcrypt 加密存储
- **SSRF 防护**：URL 验证和黑名单
- **公开路径隔离**：图片外链独立路径，不受认证影响
