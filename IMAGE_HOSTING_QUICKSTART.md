# 图床功能快速开始指南

## 5 分钟快速部署

### 步骤 1：配置 Telegram Bot（2 分钟）

1. **创建 Bot**
   ```
   在 Telegram 搜索：@BotFather
   发送命令：/newbot
   设置名称：MyImageBot
   设置用户名：my_image_bot
   ```
   
   获得 Token：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

2. **获取 Chat ID**
   ```
   在 Telegram 搜索：@userinfobot
   发送任意消息
   ```
   
   获得 Chat ID：`987654321`

### 步骤 2：配置环境变量（1 分钟）

编辑 `wrangler.toml`：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
TELEGRAM_CHAT_ID = "987654321"
```

### 步骤 3：运行数据库迁移（1 分钟）

```bash
# 本地开发
wrangler d1 execute DB --local --file=./migrations/0002_images.sql

# 生产环境
wrangler d1 execute DB --file=./migrations/0002_images.sql
```

### 步骤 4：启动开发服务器（1 分钟）

```bash
# 安装依赖（如果还没安装）
corepack pnpm install

# 启动 Worker
cd packages/worker
corepack pnpm dev

# 新终端：启动 Web
cd packages/web
corepack pnpm dev
```

### 步骤 5：访问图床

打开浏览器：`http://localhost:5173/images`

---

## 快速测试

### 测试上传

1. 点击"上传文件"按钮
2. 选择一张图片
3. 等待上传完成
4. 查看文件列表

### 测试功能

- **搜索**：在搜索框输入文件名
- **筛选**：点击文件类型图标切换
- **排序**：点击排序图标选择排序方式
- **收藏**：点击文件卡片左上角的星标
- **删除**：悬停文件卡片，点击删除按钮
- **批量操作**：选中多个文件，点击批量操作图标

---

## 常见问题

### Q: 上传失败怎么办？

A: 检查以下几点：
1. Telegram Bot Token 是否正确
2. Chat ID 是否正确
3. 文件大小是否超过 20MB
4. 网络连接是否正常

### Q: 看不到上传的文件？

A: 可能原因：
1. 数据库迁移未运行
2. 用户未登录
3. 刷新页面试试

### Q: 如何修改文件大小限制？

A: 编辑以下文件：
- 前端：`packages/web/src/pages/images/composables/useImageUpload.ts`
- 后端：`packages/worker/src/routes/images.ts`

修改 `MAX_FILE_SIZE` 常量（注意：Telegram 限制 20MB）

### Q: 如何更换存储方式？

A: 当前使用 Telegram 存储，如需更换：
1. 修改 `telegram-service.ts` 中的上传逻辑
2. 修改 `images-repository.ts` 中的文件 ID 存储
3. 修改 API 路由中的文件访问逻辑

---

## 生产部署

### 部署到 Cloudflare Pages

```bash
# 构建前端
cd packages/web
corepack pnpm build

# 部署 Worker
cd packages/worker
wrangler deploy

# 部署 Pages
cd packages/web
wrangler pages deploy dist
```

### 环境变量配置

在 Cloudflare Dashboard 中配置：
1. 进入 Workers & Pages
2. 选择你的 Worker
3. 进入 Settings > Variables
4. 添加环境变量：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

### 数据库迁移

```bash
# 生产环境迁移
wrangler d1 execute DB --file=./migrations/0002_images.sql
```

---

## 下一步

- [ ] 配置自定义域名
- [ ] 设置 CDN 加速
- [ ] 启用图片压缩
- [ ] 添加相册功能
- [ ] 集成图片编辑

---

## 获取帮助

- 查看完整文档：`IMAGE_HOSTING_COMPLETE.md`
- 查看实施计划：`IMAGE_HOSTING_IMPLEMENTATION_PLAN.md`
- 查看进度报告：`IMAGE_HOSTING_PROGRESS.md`

---

**祝你使用愉快！** 🎉
