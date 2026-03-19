# API 文档

本文档记录当前 Worker 暴露的 HTTP 接口（主接口 + 兼容接口）。

## 鉴权规则

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/check`
- `POST /api/auth/register`（兼容）

以上无需已有会话，其余 `/api/*` 需要携带 `session` Cookie。
其中 `POST /api/auth/register` 仅在 `COMPAT_ALLOW_REGISTER=true` 且配置了 `COMPAT_REGISTER_KEY` 时可用。
请求体 `register_key` 或请求头 `x-register-key` 必须匹配该密钥。

## 健康与基础

- `GET /health`：健康检查
- `GET /api/favicon?url=...`：获取并缓存站点 favicon（base64 data URL）
- `GET /sub?token=...&format=...`：订阅下载入口

## 认证

- `POST /api/auth/login`
  - body: `{ username|email, password }`
- `POST /api/auth/logout`
- `GET /api/auth/check`

## 导航（主接口）

- `GET /api/navigation`
- `POST /api/navigation/categories`
  - body: `{ name }`
- `PUT /api/navigation/categories/reorder`
  - body: `{ ids: string[] }`
- `PUT /api/navigation/categories/:id`
  - body: `{ name }`
- `DELETE /api/navigation/categories/:id`
- `POST /api/navigation/links`
  - body: `{ categoryId, title, url, description? }`
- `POST /api/navigation/links/:id/visit`
- `PUT /api/navigation/links/reorder`
  - body: `{ categoryId, ids: string[] }`
- `PUT /api/navigation/links/:id`
  - body: `{ categoryId?, title?, url?, description? }`
- `DELETE /api/navigation/links/:id`

## 订阅源

- `GET /api/sources`
- `GET /api/sources/:id`
- `POST /api/sources/validate`
  - body: `{ content }`
- `POST /api/sources`
  - body: `{ name, content }`
- `PUT /api/sources/reorder`
  - body: `{ ids: string[] }`
- `PUT /api/sources/:id`
  - body: `{ name?, content?, enabled? }`
- `DELETE /api/sources/:id`
- `POST /api/sources/refresh`

## 笔记

- `GET /api/notes`
- `POST /api/notes`
  - body: `{ title?, content? }`
- `PUT /api/notes/:id`
  - body: `{ title?, content?, isPinned? }`
- `DELETE /api/notes/:id`

## 片段（Snippets）

- `GET /api/snippets?type=&q=`
- `POST /api/snippets`
  - body: `{ type, title?, content? }`
- `PUT /api/snippets/:id`
  - body: `{ type?, title?, content?, isPinned? }`
- `DELETE /api/snippets/:id`

## 设置与日志

- `GET /api/logs?limit=50`
- `GET /api/settings/export/stats`
- `GET /api/settings/export`
- `POST /api/settings/import`
  - body: `{ backup }`
- `DELETE /api/settings/data/:scope`
  - `scope`: `sources | navigation | notes | snippets | clipboard | all`

## 兼容接口（保留）

### 认证兼容

- `POST /api/auth/register`
- `GET /api/auth/me`

### 导航兼容（`/api/nav`）

- `GET /api/nav`
- `GET /api/nav/categories`
- `POST /api/nav/categories`
- `PUT /api/nav/categories/reorder`
- `PUT /api/nav/categories/:id`
- `DELETE /api/nav/categories/:id`
- `GET /api/nav/links`
- `POST /api/nav/links`
- `PUT /api/nav/links/reorder`
- `PUT /api/nav/links/:id`
- `DELETE /api/nav/links/:id`
- `POST /api/nav/links/:id/visit`

### 订阅兼容（`/api/sub`）

- `GET /api/sub`
- `GET /api/sub/sources`
- `POST /api/sub/sources`
- `GET /api/sub/articles`
- `PUT /api/sub/articles/:id/read`
- `POST /api/sub/fetch`
- `GET /api/sub/info`

### 剪贴板兼容（`/api/clipboard`）

- `GET /api/clipboard`
- `POST /api/clipboard`
- `PUT /api/clipboard/:id/pin`
- `DELETE /api/clipboard/:id`

### 设置兼容（`/api/settings`）

- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/settings/stats`
