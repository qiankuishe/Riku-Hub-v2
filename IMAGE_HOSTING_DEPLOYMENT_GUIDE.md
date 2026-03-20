# 图床功能启用指南

## 重要说明

⚠️ **图床功能已完全集成到 Riku-Hub 项目中，无需单独部署！**

如果你的 Riku-Hub 项目已经部署，只需要：
1. 添加 Telegram 配置（2个环境变量）
2. 运行一个数据库迁移文件
3. 重新部署（自动包含图床功能）

---

## 前提条件

- ✅ Riku-Hub 项目已部署（或准备部署）
- ✅ 已获取 Telegram Bot Token
- ✅ 已获取 Telegram Chat ID

---

## 部署场景

### 场景 A：项目已部署，添加图床功能

如果你的 Riku-Hub 已经在运行，只需 3 步：

1. **添加 Telegram 环境变量**
2. **运行图床数据库迁移**
3. **重新部署项目**

### 场景 B：首次部署项目（包含图床）

如果是首次部署 Riku-Hub，按照标准部署流程，额外添加 Telegram 配置即可。

---

## 场景 A：为现有项目添加图床功能

### 步骤 1：添加 Telegram 配置（2分钟）

**使用 Wrangler CLI（推荐）**：

```bash
cd 张三/Riku-Hub

# 设置 Bot Token
pnpm dlx wrangler secret put TELEGRAM_BOT_TOKEN
# 提示输入时，粘贴你的 Bot Token

# 设置 Chat ID
pnpm dlx wrangler secret put TELEGRAM_CHAT_ID
# 提示输入时，粘贴你的 Chat ID
```

**或使用 Cloudflare Dashboard**：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Workers & Pages → 选择你的 Worker
3. Settings → Variables → Add variable
4. 添加：
   - `TELEGRAM_BOT_TOKEN` = 你的 Bot Token
   - `TELEGRAM_CHAT_ID` = 你的 Chat ID
5. 点击 Save

### 步骤 2：运行图床数据库迁移（1分钟）

```bash
cd 张三/Riku-Hub

# 运行图床迁移（生产环境）
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_images.sql
```

**预期输出**：
```
🌀 Executing on DB (xxxx-xxxx-xxxx-xxxx) from ./migrations/0002_images.sql:
🚣 Executed 7 commands in 0.456s
```

### 步骤 3：重新部署项目（2分钟）

```bash
cd 张三/Riku-Hub

# 重新构建和部署
pnpm run build
pnpm dlx wrangler deploy
```

**完成！** 访问 `https://your-domain.com/images` 即可使用图床功能。

---

## 场景 B：首次部署项目（包含图床）

### 完整部署流程

按照 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) 的标准流程，额外添加以下步骤：

#### 1. 标准部署步骤

```bash
cd 张三/Riku-Hub

# 1. 安装依赖
pnpm install

# 2. 创建 KV 和 D1（如果还没创建）
pnpm dlx wrangler kv namespace create CACHE_KV
pnpm dlx wrangler d1 create riku-hub-db

# 3. 运行所有数据库迁移（按顺序）
pnpm dlx wrangler d1 execute DB --file=./migrations/0001_app_data.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_runtime_data.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0003_add_notes.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0004_add_clipboard.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0005_add_settings_logs.sql
pnpm dlx wrangler d1 execute DB --file=./migrations/0002_images.sql  # 图床迁移

# 4. 设置必需的 secrets
pnpm dlx wrangler secret put ADMIN_USERNAME
pnpm dlx wrangler secret put ADMIN_PASSWORD_HASH
pnpm dlx wrangler secret put SUB_TOKEN

# 5. 设置图床 secrets
pnpm dlx wrangler secret put TELEGRAM_BOT_TOKEN
pnpm dlx wrangler secret put TELEGRAM_CHAT_ID

# 6. 构建和部署
pnpm run build
pnpm dlx wrangler deploy
```

#### 2. 验证部署

访问你的域名：
- 主页：`https://your-domain.com/`
- 图床：`https://your-domain.com/images`

---

### A1. 创建 Telegram Bot

1. 在 Telegram 搜索：`@BotFather`
2. 发送命令：`/newbot`
3. 按提示设置 Bot 名称（例如：`My Image Bot`）
4. 设置 Bot 用户名（例如：`my_image_bot`）
5. 复制获得的 Token

**Token 格式示例**：
```
123456789:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890
```

### A2. 获取 Chat ID

1. 在 Telegram 搜索：`@userinfobot`
2. 发送任意消息
3. 复制获得的 Chat ID

**Chat ID 格式示例**：
```
987654321
```

### A3. 测试 Bot（可选但推荐）

```bash
# 替换 YOUR_BOT_TOKEN 为你的实际 Token
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getMe"

# 应该返回 Bot 信息，例如：
# {"ok":true,"result":{"id":123456789,"is_bot":true,"first_name":"My Image Bot",...}}
```

---

## 本地开发测试

### 1. 配置本地环境变量

编辑 `wrangler.toml` 文件，添加：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890"
TELEGRAM_CHAT_ID = "987654321"
```

⚠️ **注意**：`wrangler.toml` 文件已在 `.gitignore` 中，不会被提交到 Git。

### 2. 运行本地数据库迁移

```bash
cd 张三/Riku-Hub

# 运行图床数据库迁移
pnpm dlx wrangler d1 execute DB --local --file=./migrations/0002_images.sql
```

**预期输出**：
```
🌀 Executing on local database DB (xxxx-xxxx-xxxx-xxxx) from ./migrations/0002_images.sql:
🚣 Executed 7 commands in 0.123s
```

### 3. 启动开发服务器

**终端 1：启动 Worker**
```bash
cd 张三/Riku-Hub/packages/worker
corepack pnpm dev
```

**终端 2：启动 Web**
```bash
cd 张三/Riku-Hub/packages/web
corepack pnpm dev
```

### 4. 访问图床页面

打开浏览器访问：
- Web Dev Server: `http://localhost:5173/images`
- Worker: `http://localhost:8787/images`

### 5. 测试上传功能

1. 点击"上传文件"按钮
2. 选择一张图片（小于 20MB）
3. 等待上传完成
4. 查看文件列表

### 5.4 测试 Telegram 存储

1. 打开 Telegram，找到你的 Bot
2. 应该能看到刚才上传的图片
3. 点击图片可以查看

---

## 第六步：部署到生产环境（5分钟）

### 6.1 部署 Worker

```bash
cd 张三/Riku-Hub/packages/worker

# 部署 Worker
pnpm dlx wrangler deploy
```

**预期输出**：
```
Total Upload: xx.xx KiB / gzip: xx.xx KiB
Uploaded riku-hub-worker (x.xx sec)
Published riku-hub-worker (x.xx sec)
  https://riku-hub-worker.your-subdomain.workers.dev
Current Deployment ID: xxxx-xxxx-xxxx-xxxx
```

### 6.2 部署 Pages

```bash
cd 张三/Riku-Hub/packages/web

# 部署 Pages
pnpm dlx wrangler pages deploy dist --project-name=riku-hub
```

**预期输出**：
```
✨ Success! Uploaded xx files (x.xx sec)

✨ Deployment complete! Take a peek over at https://xxxx.riku-hub.pages.dev
```

### 6.3 配置自定义域名（可选）

1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages
3. 选择你的项目
4. 进入 Custom domains
5. 添加自定义域名

---

## 第七步：验证部署（5分钟）

### 7.1 访问生产环境

访问你的域名 + `/images`，例如：
- `https://your-domain.pages.dev/images`
- `https://your-domain.com/images`

### 7.2 功能验证清单

- [ ] 页面正常加载（无 404 错误）
- [ ] 页面样式正常（卡片式布局）
- [ ] 用户已登录
- [ ] 侧边栏显示"图床"入口
- [ ] 上传单个文件成功
- [ ] 上传多个文件成功
- [ ] 文件列表显示正常
- [ ] 图片预览正常
- [ ] 搜索功能正常
- [ ] 筛选功能正常
- [ ] 排序功能正常
- [ ] 删除文件成功
- [ ] 收藏功能正常
- [ ] 批量操作正常
- [ ] 移动端显示正常

### 7.3 性能验证

```bash
# 测试 API 响应时间
curl -w "@-" -o /dev/null -s "https://your-domain.com/api/images/list" <<'EOF'
    time_namelookup:  %{time_namelookup}\n
       time_connect:  %{time_connect}\n
    time_appconnect:  %{time_appconnect}\n
   time_pretransfer:  %{time_pretransfer}\n
      time_redirect:  %{time_redirect}\n
 time_starttransfer:  %{time_starttransfer}\n
                    ----------\n
         time_total:  %{time_total}\n
EOF
```

**预期**：`time_total` 应该小于 1 秒

---

## 故障排除

### 问题 1：页面 404

**症状**：访问 `/images` 显示 404

**解决方案**：
1. 检查 `packages/web/dist/images.html` 是否存在
2. 重新构建：`corepack pnpm run build`
3. 重新部署：`pnpm dlx wrangler pages deploy dist`
4. 清除浏览器缓存

### 问题 2：上传失败

**症状**：点击上传后显示错误

**检查项**：
1. Telegram Bot Token 是否正确
2. Chat ID 是否正确
3. 文件大小是否超过 20MB
4. 网络连接是否正常

**验证配置**：
```bash
# 测试 Bot Token
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getMe"

# 测试发送消息
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage" \
  -d "chat_id=YOUR_CHAT_ID" \
  -d "text=Test message"
```

### 问题 3：看不到上传的文件

**症状**：上传成功但列表中看不到

**解决方案**：
1. 确认数据库迁移已运行
2. 确认用户已登录
3. 刷新页面
4. 检查浏览器控制台错误

**检查数据库**：
```bash
# 查询 images 表
pnpm dlx wrangler d1 execute DB --command="SELECT * FROM images LIMIT 10"
```

### 问题 4：图片无法显示

**症状**：文件列表中图片显示为空白

**解决方案**：
1. 检查 Telegram Bot Token 是否正确
2. 检查网络连接
3. 打开浏览器开发者工具查看网络请求
4. 检查是否有 CORS 错误

### 问题 5：环境变量未生效

**症状**：配置了环境变量但仍然报错

**解决方案**：
1. 确认环境变量名称正确（区分大小写）
2. 重新部署 Worker
3. 等待 1-2 分钟让配置生效
4. 清除 Cloudflare 缓存

---

## 安全建议

### 1. 保护 Bot Token

⚠️ **重要**：Bot Token 是敏感信息，泄露后任何人都可以控制你的 Bot。

**最佳实践**：
- ✅ 使用 Wrangler Secrets 存储（推荐）
- ✅ 不要提交到 Git
- ✅ 不要在代码中硬编码
- ✅ 定期轮换 Token

**如果 Token 泄露**：
1. 在 @BotFather 中发送 `/revoke`
2. 选择你的 Bot
3. 生成新的 Token
4. 更新环境变量

### 2. 限制文件大小

当前限制：20MB（Telegram 限制）

**如需调整**：
- 前端：`packages/web/src/pages/images/composables/useImageUpload.ts`
- 后端：`packages/worker/src/routes/images.ts`

### 3. 监控存储使用

Telegram 免费账户限制：
- 单个文件：20MB
- 总存储：无限制
- 上传速度：有限制

**建议**：
- 定期清理不需要的文件
- 压缩大图片
- 使用 CDN 加速访问

---

## 性能优化

### 1. 启用 CDN

Cloudflare Pages 自动启用 CDN，无需额外配置。

### 2. 图片压缩

**前端压缩**（可选）：
```typescript
// 在 useImageUpload.ts 中添加压缩逻辑
async function compressImage(file: File): Promise<File> {
  // 使用 canvas 压缩图片
  // ...
}
```

### 3. 懒加载

当前已实现图片懒加载，无需额外配置。

### 4. 虚拟滚动

对于大量文件，可以启用虚拟滚动：
```bash
# 安装依赖
pnpm add vue-virtual-scroller

# 在 ImagesPage.vue 中使用
```

---

## 监控和维护

### 1. 查看日志

```bash
# 实时查看 Worker 日志
pnpm dlx wrangler tail

# 查看最近的日志
pnpm dlx wrangler tail --format pretty
```

### 2. 监控指标

在 Cloudflare Dashboard 中查看：
- 请求数
- 错误率
- 响应时间
- 带宽使用

### 3. 定期备份

```bash
# 导出数据库
pnpm dlx wrangler d1 export DB --output=backup.sql

# 备份到本地
cp backup.sql ~/backups/riku-hub-$(date +%Y%m%d).sql
```

### 4. 更新依赖

```bash
# 检查过期依赖
pnpm outdated

# 更新依赖
pnpm update

# 重新构建和部署
corepack pnpm run build
pnpm dlx wrangler deploy
```

---

## 成本估算

### Cloudflare 免费套餐

- Workers：100,000 请求/天
- Pages：500 次构建/月
- D1：5GB 存储 + 500 万行读取/天
- KV：100,000 读取/天 + 1,000 写入/天

### Telegram

- 完全免费
- 无存储限制
- 单文件最大 20MB

### 总成本

对于个人使用，完全免费！

---

## 下一步

- [ ] 配置自定义域名
- [ ] 启用 HTTPS（Cloudflare 自动启用）
- [ ] 设置监控告警
- [ ] 定期备份数据
- [ ] 优化图片压缩
- [ ] 添加文件夹功能
- [ ] 集成 CDN 加速

---

## 相关文档

- [IMAGE_HOSTING_COMPLETE.md](./IMAGE_HOSTING_COMPLETE.md) - 功能完整报告
- [IMAGE_HOSTING_TROUBLESHOOTING.md](./IMAGE_HOSTING_TROUBLESHOOTING.md) - 故障排除指南
- [IMAGE_HOSTING_QUICKSTART.md](./IMAGE_HOSTING_QUICKSTART.md) - 快速开始指南
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) - 项目部署文档

---

**部署状态**：✅ 准备就绪

**预计时间**：20-30 分钟

**难度等级**：⭐⭐☆☆☆（简单）

**最后更新**：2026年3月20日
