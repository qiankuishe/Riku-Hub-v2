# 图床功能故障排除指南

## 问题：404 错误 - 页面未找到

### 症状
访问 `/images` 时显示：
```
This page can't be found
HTTP ERROR 404
```

### 原因
Worker 没有正确路由 `/images` 路径到 `images.html` 文件。

### 解决方案 ✅

已修复以下文件：

1. **`packages/worker/src/utils/http.ts`**
   - 在 `pageMap` 中添加了 `/images: '/images.html'` 映射

2. **`packages/worker/src/index.ts`**
   - 添加了 `/app/images` 到 `/images` 的重定向

### 重新部署步骤

#### 本地开发环境

```bash
# 1. 重启 Worker
cd packages/worker
# 按 Ctrl+C 停止当前进程
corepack pnpm dev

# 2. 重启 Web（如果需要）
cd packages/web
# 按 Ctrl+C 停止当前进程
corepack pnpm dev

# 3. 清除浏览器缓存
# Chrome: Ctrl+Shift+Delete
# 或者使用无痕模式

# 4. 访问
# http://localhost:8787/images (Worker)
# http://localhost:5173/images (Web Dev Server)
```

#### 生产环境

```bash
# 1. 重新构建 Worker
cd packages/worker
corepack pnpm build

# 2. 部署 Worker
wrangler deploy

# 3. 重新构建 Web
cd packages/web
corepack pnpm build

# 4. 部署 Pages
wrangler pages deploy dist

# 5. 清除 Cloudflare 缓存
# 在 Cloudflare Dashboard 中清除缓存
```

---

## 其他常见问题

### 问题：上传失败

#### 症状
点击上传后显示错误或无响应

#### 可能原因
1. Telegram Bot Token 未配置
2. Telegram Chat ID 未配置
3. 数据库迁移未运行
4. 文件大小超过 20MB

#### 解决方案

1. **检查环境变量**
   ```bash
   # 查看 wrangler.toml
   cat wrangler.toml | grep TELEGRAM
   ```

2. **验证 Telegram 配置**
   ```bash
   # 测试 Bot Token
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
   
   # 应该返回 Bot 信息
   ```

3. **运行数据库迁移**
   ```bash
   # 本地
   wrangler d1 execute DB --local --file=./migrations/0002_images.sql
   
   # 生产
   wrangler d1 execute DB --file=./migrations/0002_images.sql
   ```

4. **检查文件大小**
   - 确保文件小于 20MB
   - 在前端会有提示

---

### 问题：看不到上传的文件

#### 症状
上传成功但列表中看不到文件

#### 可能原因
1. 用户未登录
2. 数据库查询错误
3. 前端筛选条件不匹配

#### 解决方案

1. **检查登录状态**
   - 确保已登录
   - 检查浏览器 Cookie

2. **检查数据库**
   ```bash
   # 查询 images 表
   wrangler d1 execute DB --local --command="SELECT * FROM images LIMIT 10"
   ```

3. **重置筛选条件**
   - 切换到"全部"文件类型
   - 切换到"全部"筛选
   - 清空搜索框

4. **刷新页面**
   - 按 F5 或点击标题刷新

---

### 问题：图片无法显示

#### 症状
文件列表中图片显示为空白或加载失败

#### 可能原因
1. Telegram 文件访问失败
2. 代理配置错误
3. 网络问题

#### 解决方案

1. **检查文件 URL**
   ```bash
   # 测试文件访问
   curl http://localhost:8787/api/images/file/<FILE_ID>
   ```

2. **检查 Telegram 连接**
   ```bash
   # 测试 Telegram API
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getFile?file_id=<FILE_ID>
   ```

3. **查看浏览器控制台**
   - 打开开发者工具（F12）
   - 查看 Network 标签
   - 检查失败的请求

---

### 问题：批量操作失败

#### 症状
批量删除、复制等操作失败

#### 可能原因
1. 未选中文件
2. 权限问题
3. 网络超时

#### 解决方案

1. **确保选中文件**
   - 点击文件右上角的复选框
   - 或使用"全选当前页"

2. **检查权限**
   - 确保是文件的所有者
   - 检查用户 ID

3. **减少批量数量**
   - 一次操作不要超过 50 个文件
   - 分批操作

---

### 问题：搜索不工作

#### 症状
输入搜索关键词后没有结果

#### 可能原因
1. 搜索逻辑错误
2. 大小写敏感
3. 数据未加载

#### 解决方案

1. **检查搜索内容**
   - 搜索是不区分大小写的
   - 可以搜索文件名或 ID

2. **清空搜索框**
   - 点击搜索框的清除按钮
   - 重新输入

3. **刷新页面**
   - 确保数据已加载

---

### 问题：移动端显示异常

#### 症状
在手机上显示不正常

#### 可能原因
1. 响应式样式问题
2. 浏览器兼容性

#### 解决方案

1. **使用现代浏览器**
   - Chrome、Safari、Firefox 最新版

2. **清除缓存**
   - 清除浏览器缓存
   - 刷新页面

3. **检查视口**
   - 确保页面有正确的 viewport meta 标签

---

## 调试技巧

### 1. 查看 Worker 日志

```bash
# 实时查看日志
wrangler tail

# 或在 Cloudflare Dashboard 查看
```

### 2. 查看浏览器控制台

```javascript
// 打开控制台（F12）
// 查看错误信息
// 查看网络请求
```

### 3. 测试 API

```bash
# 测试列表 API
curl -H "Cookie: auth_token=YOUR_TOKEN" \
  http://localhost:8787/api/images/list

# 测试上传 API
curl -X POST \
  -H "Cookie: auth_token=YOUR_TOKEN" \
  -F "file=@test.jpg" \
  http://localhost:8787/api/images/upload
```

### 4. 检查数据库

```bash
# 查看表结构
wrangler d1 execute DB --local --command="PRAGMA table_info(images)"

# 查看数据
wrangler d1 execute DB --local --command="SELECT * FROM images"

# 查看索引
wrangler d1 execute DB --local --command="PRAGMA index_list(images)"
```

---

## 性能优化

### 如果列表加载慢

1. **启用虚拟滚动**
   - 安装 `vue-virtual-scroller`
   - 修改 ImagesPage.vue

2. **减少每页数量**
   - 修改 `pageSize` 从 15 到 10

3. **启用图片懒加载**
   - 已默认启用

### 如果上传慢

1. **压缩图片**
   - 使用图片压缩工具
   - 减小文件大小

2. **减少并发数**
   - 修改 `MAX_CONCURRENT` 从 3 到 2

3. **检查网络**
   - 使用更快的网络
   - 检查 Telegram API 连接

---

## 获取帮助

如果以上方法都无法解决问题：

1. **查看完整日志**
   ```bash
   wrangler tail --format pretty
   ```

2. **检查 GitHub Issues**
   - 搜索类似问题
   - 提交新 Issue

3. **联系支持**
   - 提供错误信息
   - 提供复现步骤
   - 提供环境信息

---

## 检查清单

部署前检查：

- [ ] 数据库迁移已运行
- [ ] Telegram Bot Token 已配置
- [ ] Telegram Chat ID 已配置
- [ ] Worker 已重新部署
- [ ] Web 已重新构建
- [ ] 浏览器缓存已清除
- [ ] 可以访问 `/images` 页面
- [ ] 可以上传文件
- [ ] 可以查看文件列表
- [ ] 可以删除文件
- [ ] 批量操作正常
- [ ] 搜索功能正常
- [ ] 移动端显示正常

---

**问题已解决？** 🎉

如果还有问题，请查看其他文档或提交 Issue。
