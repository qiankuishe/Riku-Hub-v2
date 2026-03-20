# 图床功能启用指南（简化版）

## 重要说明

✅ **图床功能已完全集成到 Riku-Hub 项目中**

不需要单独部署！只需在现有项目中添加 2 个环境变量和运行 1 个迁移文件。

---

## 快速启用（3步骤）

### 场景 A：项目已部署 → 添加图床功能

```bash
cd 张三/Riku-Hub

# 1. 添加 Telegram 配置
pnpm dlx wrangler secret put TELEGRAM_BOT_TOKEN  # 输入你的 Bot Token
pnpm dlx wrangler secret put TELEGRAM_CHAT_ID    # 输入你的 Chat ID

# 2. 运行图床数据库迁移
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_images.sql

# 3. 重新部署
pnpm run build
pnpm dlx wrangler deploy
```

**完成！** 访问 `https://your-domain.com/images`

---

### 场景 B：首次部署项目（包含图床）

按照标准部署流程，额外添加图床配置：

```bash
cd 张三/Riku-Hub

# === 标准部署步骤 ===
pnpm install
pnpm dlx wrangler kv namespace create CACHE_KV
pnpm dlx wrangler d1 create riku-hub-db

# 运行所有迁移（包括图床）
pnpm dlx wrangler d1 execute DB --file=./migrations/0001_app_data.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_runtime_data.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0003_add_notes.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0004_add_clipboard.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0005_add_settings_logs.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_images.sql  # 图床迁移

# 设置必需的 secrets
pnpm dlx wrangler secret put ADMIN_USERNAME
pnpm dlx wrangler secret put ADMIN_PASSWORD_HASH
pnpm dlx wrangler secret put SUB_TOKEN

# === 图床额外配置 ===
pnpm dlx wrangler secret put TELEGRAM_BOT_TOKEN
pnpm dlx wrangler secret put TELEGRAM_CHAT_ID

# 构建和部署
pnpm run build
pnpm dlx wrangler deploy
```

---

## 获取 Telegram 配置

### 1. 创建 Bot

1. Telegram 搜索：`@BotFather`
2. 发送：`/newbot`
3. 设置名称和用户名
4. 复制 Token（格式：`123456789:ABCdefGHI...`）

### 2. 获取 Chat ID

1. Telegram 搜索：`@userinfobot`
2. 发送任意消息
3. 复制 Chat ID（格式：`987654321`）

### 3. 测试配置（可选）

```bash
# 测试 Bot Token
curl "https://api.telegram.org/bot你的Token/getMe"

# 应该返回 Bot 信息
```

---

## 本地开发测试

### 1. 配置本地环境

编辑 `wrangler.toml`：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "你的Bot Token"
TELEGRAM_CHAT_ID = "你的Chat ID"
```

### 2. 运行本地迁移

```bash
pnpm dlx wrangler d1 execute DB --local --file=./migrations/0002_images.sql
```

### 3. 启动开发服务器

```bash
# 终端 1
cd packages/worker
pnpm dev

# 终端 2
cd packages/web
pnpm dev
```

### 4. 访问测试

- `http://localhost:5173/images`
- `http://localhost:8787/images`

---

## 验证部署

访问 `https://your-domain.com/images`，检查：

- [ ] 页面正常加载
- [ ] 侧边栏显示"图床"入口
- [ ] 可以上传文件
- [ ] 可以查看文件列表
- [ ] 可以删除文件
- [ ] 可以收藏文件

---

## 常见问题

### Q: 上传失败怎么办？

**检查**：
1. Bot Token 是否正确
2. Chat ID 是否正确
3. 文件是否超过 20MB

**测试**：
```bash
curl "https://api.telegram.org/bot你的Token/getMe"
```

### Q: 看不到上传的文件？

**解决**：
1. 确认数据库迁移已运行
2. 刷新页面
3. 检查浏览器控制台

### Q: 页面 404？

**解决**：
1. 重新构建：`pnpm run build`
2. 检查 `packages/web/dist/images.html` 是否存在
3. 重新部署

---

## 项目集成说明

图床功能已完全集成到 Riku-Hub：

### 后端集成
- ✅ API 路由：`/api/images/*`
- ✅ 数据库表：`images`
- ✅ Telegram 服务：`telegram-service.ts`
- ✅ 用户隔离：基于 `userId`

### 前端集成
- ✅ 页面路由：`/images`
- ✅ 侧边栏入口：图床
- ✅ 统一 UI 风格：卡片式布局
- ✅ 响应式设计：移动端适配

### 部署集成
- ✅ 统一构建：`pnpm run build`
- ✅ 统一部署：`pnpm dlx wrangler deploy`
- ✅ 共享数据库：使用同一个 D1 数据库
- ✅ 共享认证：使用同一套用户系统

---

## 成本说明

### Cloudflare（免费套餐足够）
- Workers：100,000 请求/天
- D1：5GB 存储
- Pages：500 次构建/月

### Telegram（完全免费）
- 无限存储
- 单文件最大 20MB
- 无带宽限制

**总成本**：个人使用完全免费！

---

## 相关文档

- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) - 项目完整部署文档
- [IMAGE_HOSTING_COMPLETE.md](./IMAGE_HOSTING_COMPLETE.md) - 功能详细说明
- [IMAGE_HOSTING_TROUBLESHOOTING.md](./IMAGE_HOSTING_TROUBLESHOOTING.md) - 故障排除

---

**部署难度**：⭐☆☆☆☆（非常简单）

**预计时间**：5-10 分钟

**最后更新**：2026年3月20日
