# 图床功能完整指南

## 概述

Riku-Hub 集成了完整的图床功能，支持图片、视频、音频和文档的上传、管理和分享。基于 Telegram Bot API 提供免费的文件存储服务。

## 快速开始

### 1. 配置 Telegram Bot

1. **创建 Bot**
   - 在 Telegram 搜索 `@BotFather`
   - 发送 `/newbot` 命令
   - 设置 Bot 名称和用户名
   - 获得 Bot Token

2. **获取 Chat ID**
   - 在 Telegram 搜索 `@userinfobot`
   - 发送任意消息获取 Chat ID

### 2. 配置环境变量

在 `wrangler.toml` 中添加：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "your_bot_token_here"
TELEGRAM_CHAT_ID = "your_chat_id_here"
```

### 3. 运行数据库迁移

```bash
# 本地开发
wrangler d1 execute DB --local --file=./migrations/0002_images.sql

# 生产环境
wrangler d1 execute DB --file=./migrations/0002_images.sql
```

### 4. 启动服务

```bash
corepack pnpm install
corepack pnpm dev:worker  # 启动 Worker
corepack pnpm dev:web     # 启动 Web（新终端）
```

访问：`http://localhost:5173/images`

## 功能特性

### 文件管理
- **上传**：支持图片、视频、音频、文档（最大 20MB）
- **预览**：图片预览、视频播放、音频播放
- **操作**：删除、收藏、重命名、复制链接
- **批量操作**：批量删除、复制、下载、黑白名单管理

### 搜索和筛选
- **搜索**：按文件名搜索
- **筛选**：按文件类型（图片/视频/音频/文件）
- **状态筛选**：全部/收藏/黑名单/白名单
- **排序**：时间倒序/名称升序/大小倒序

### 用户体验
- **响应式设计**：支持桌面、平板、移动端
- **拖拽上传**：支持文件拖拽上传
- **进度显示**：实时上传进度
- **并发控制**：最多 3 个文件并发上传

## API 接口

### 文件列表
```http
GET /api/images/list?page=1&limit=20&type=image&filter=all&sort=dateDesc&search=keyword
```

### 文件上传
```http
POST /api/images/upload
Content-Type: multipart/form-data

file: [File]
```

### 文件操作
```http
DELETE /api/images/:id                    # 删除文件
POST /api/images/:id/like                 # 切换收藏
PUT /api/images/:id/name                  # 修改文件名
POST /api/images/:id/block                # 加入黑名单
POST /api/images/:id/unblock              # 加入白名单
```

### 文件访问
```http
GET /api/images/file/:id                  # 获取文件（代理到 Telegram）
```

## 部署指南

### 生产部署

1. **配置环境变量**
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   ```

2. **运行数据库迁移**
   ```bash
   wrangler d1 execute DB --file=./migrations/0002_images.sql
   ```

3. **部署应用**
   ```bash
   corepack pnpm build
   wrangler deploy
   ```

### 验证部署

访问以下功能确认部署成功：
- [ ] 页面访问：`/images`
- [ ] 文件上传功能
- [ ] 文件列表显示
- [ ] 搜索和筛选
- [ ] 文件操作（删除、收藏等）

## 故障排除

### 常见问题

**Q: 上传失败**
- 检查 Telegram Bot Token 和 Chat ID 配置
- 确认文件大小不超过 20MB
- 检查网络连接

**Q: 文件列表为空**
- 确认数据库迁移已执行
- 检查用户登录状态
- 刷新页面重试

**Q: 404 错误**
- 确认 Worker 路由配置正确
- 检查 `packages/worker/src/utils/http.ts` 中的 `pageMap`
- 确认 `images.html` 已构建到 dist 目录

### 调试步骤

1. **检查构建**
   ```bash
   corepack pnpm check  # 类型检查
   corepack pnpm build  # 构建验证
   ```

2. **检查数据库**
   ```bash
   wrangler d1 execute DB --command="SELECT name FROM sqlite_master WHERE type='table';"
   ```

3. **检查环境变量**
   ```bash
   wrangler secret list
   ```

## 技术架构

### 后端组件
- **Telegram Service**：文件上传和访问
- **Images Repository**：数据库操作
- **Images Routes**：API 路由处理

### 前端组件
- **ImagesPage.vue**：主页面组件
- **Composables**：业务逻辑封装
  - `useImageList.ts`：列表管理
  - `useImageUpload.ts`：上传逻辑
  - `useImageOperations.ts`：文件操作
- **API Client**：HTTP 请求封装

### 数据库结构
```sql
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  is_liked INTEGER DEFAULT 0,
  list_type TEXT,
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## 性能优化

### 当前指标
- 构建产物：~62 kB (gzip: ~20 kB)
- 首屏加载：< 2s
- API 响应：< 100ms
- 数据库查询：< 50ms

### 优化建议
- **图片懒加载**：大量文件时提升性能
- **虚拟滚动**：处理超大列表
- **图片压缩**：上传前自动压缩
- **CDN 加速**：集成 Cloudflare R2

## 限制说明

1. **文件大小**：最大 20MB（Telegram 限制）
2. **并发上传**：最多 3 个（避免速率限制）
3. **文件类型识别**：基于扩展名
4. **存储依赖**：依赖 Telegram 服务可用性

## 安全考虑

- **用户隔离**：所有查询都包含 user_id 过滤
- **文件验证**：检查文件类型和大小
- **访问控制**：需要登录才能访问
- **代理访问**：隐藏 Telegram Bot Token

## 扩展功能

### 计划中的功能
- 相册管理（文件夹组织）
- 图片编辑（裁剪、旋转、滤镜）
- 统计分析（存储使用、访问统计）
- API 开放（RESTful API）
- 插件支持（PicGo、Typora 等）

### 集成建议
- **CDN**：Cloudflare R2 + 自定义域名
- **压缩**：TinyPNG API 集成
- **AI**：图片标签、智能分类
- **监控**：文件访问统计、异常监控

---

**最后更新**：2026-03-21  
**版本**：v1.0.0  
**状态**：生产就绪 ✅