# 图床功能部署指南

## 快速部署（5分钟）

### 步骤 1：配置 Telegram Bot（2分钟）

#### 1.1 创建 Bot
1. 在 Telegram 搜索：`@BotFather`
2. 发送命令：`/newbot`
3. 按提示设置名称和用户名
4. 复制获得的 Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

#### 1.2 获取 Chat ID
1. 在 Telegram 搜索：`@userinfobot`
2. 发送任意消息
3. 复制获得的 Chat ID（格式：`987654321`）

### 步骤 2：配置环境变量（1分钟）

编辑 `wrangler.toml`，添加：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "你的Bot Token"
TELEGRAM_CHAT_ID = "你的Chat ID"
```

### 步骤 3：运行数据库迁移（1分钟）

```bash
# 本地开发环境
wrangler d1 execute DB --local --file=./migrations/0002_images.sql

# 生产环境
wrangler d1 execute DB --file=./migrations/0002_images.sql
```

### 步骤 4：部署（1分钟）

```bash
# 构建项目
corepack pnpm run build

# 部署 Worker
cd packages/worker
wrangler deploy

# 部署 Pages
cd ../web
wrangler pages deploy dist
```

### 步骤 5：验证

访问你的域名 + `/images`，例如：
- `https://your-domain.pages.dev/images`
- `https://your-domain.workers.dev/images`

---

## 本地开发测试

### 启动开发服务器

```bash
# 终端 1：启动 Worker
cd packages/worker
corepack pnpm dev

# 终端 2：启动 Web
cd packages/web
corepack pnpm dev
```

### 访问本地服务

- Web Dev Server: `http://localhost:5173/images`
- Worker: `http://localhost:8787/images`

---

## 故障排除

### 问题：页面 404

**解决方案**：
1. 确认 `dist/images.html` 文件存在
2. 重新构建：`corepack pnpm run build`
3. 清除浏览器缓存

### 问题：上传失败

**检查项**：
1. Telegram Bot Token 是否正确
2. Chat ID 是否正确
3. 文件大小是否超过 20MB
4. 网络连接是否正常

### 问题：看不到文件

**解决方案**：
1. 确认数据库迁移已运行
2. 确认用户已登录
3. 刷新页面
4. 检查浏览器控制台错误

---

## 验证清单

部署后测试：

- [ ] 访问 `/images` 页面正常
- [ ] 上传单个文件成功
- [ ] 上传多个文件成功
- [ ] 查看文件列表正常
- [ ] 搜索功能正常
- [ ] 删除文件成功
- [ ] 收藏功能正常
- [ ] 批量操作正常
- [ ] 移动端显示正常

---

## 获取帮助

- 完整文档：`IMAGE_HOSTING_COMPLETE.md`
- 故障排除：`IMAGE_HOSTING_TROUBLESHOOTING.md`
- 快速开始：`IMAGE_HOSTING_QUICKSTART.md`
- 最终状态：`IMAGE_HOSTING_FINAL_STATUS.md`

---

**祝部署顺利！** 🚀
