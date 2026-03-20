# Riku-Hub 故障排查指南

本文档提供常见问题的排查步骤和解决方案。

## 目录

- [导入导出问题](#导入导出问题)
- [订阅刷新问题](#订阅刷新问题)
- [认证问题](#认证问题)
- [性能问题](#性能问题)
- [数据库问题](#数据库问题)
- [缓存问题](#缓存问题)

---

## 导入导出问题

### 问题 1：备份文件无法导入

**症状**:
- 导入时提示"导入文件内容无效"
- 导入时提示"导入文件过大"
- 导入部分成功，部分失败

**排查步骤**:

1. **检查文件格式**
   ```bash
   # 确认是有效的 JSON 文件
   cat backup.json | jq .
   ```
   - 如果报错，说明 JSON 格式不正确
   - 使用 JSON 格式化工具修复

2. **检查文件大小**
   ```bash
   # 查看文件大小
   ls -lh backup.json
   ```
   - 总备份大小限制：100MB
   - 如果超过限制，需要分批导入或清理数据

3. **检查内容大小**
   - 订阅源内容：最大 10MB
   - 图片片段：最大 10MB
   - 笔记内容：最大 5MB
   - 代码片段：最大 1MB

4. **检查数量限制**
   - 每个分类的条目数：最大 2,000
   - 导航链接总数：最大 10,000
   - 订阅源数量：最大 2,000

**解决方案**:

**方案 A：分批导入**
```javascript
// 将大备份拆分为多个小备份
const backup = JSON.parse(fs.readFileSync('backup.json'));

// 只导入导航数据
const navBackup = {
  version: backup.version,
  navigation: backup.navigation
};

// 只导入笔记数据
const notesBackup = {
  version: backup.version,
  notes: backup.notes
};
```

**方案 B：清理数据**
```javascript
// 删除过大的图片片段
backup.snippets = backup.snippets.filter(s => {
  if (s.type === 'image') {
    const size = new Blob([s.content]).size;
    return size <= 10 * 1024 * 1024; // 10MB
  }
  return true;
});
```

**方案 C：压缩图片**
```javascript
// 压缩 base64 图片
function compressBase64Image(base64, maxSize) {
  // 使用 canvas 压缩图片
  // 或者使用在线工具压缩
}
```

### 问题 2：导入后部分链接丢失

**症状**:
- 导入成功，但部分导航链接不见了
- 控制台显示"Skipping unsafe URL"警告

**原因**:
- 备份中包含非法协议的 URL（`javascript:`, `data:`, `file:` 等）
- 系统自动跳过这些不安全的链接

**排查步骤**:

1. **查看浏览器控制台**
   ```
   [Import] Skipping unsafe URL with illegal protocol: javascript:alert(1)
   ```

2. **检查导入响应**
   ```json
   {
     "success": true,
     "skipped": {
       "navigation": {
         "count": 3,
         "details": [
           {
             "categoryName": "工具",
             "linkTitle": "恶意链接",
             "url": "javascript:alert(1)",
             "reason": "illegal_protocol"
           }
         ]
       }
     }
   }
   ```

**解决方案**:

**方案 A：修复备份文件**
```javascript
// 将非法协议替换为有效 URL
backup.navigation.forEach(category => {
  category.links.forEach(link => {
    if (link.url.startsWith('javascript:')) {
      link.url = 'https://example.com'; // 替换为有效 URL
    }
  });
});
```

**方案 B：手动添加**
- 导入后手动添加被跳过的链接
- 使用有效的 `http://` 或 `https://` URL

### 问题 3：导出的备份文件过大

**症状**:
- 导出的 JSON 文件超过 100MB
- 浏览器下载缓慢或失败

**排查步骤**:

1. **检查各部分大小**
   ```javascript
   const backup = JSON.parse(fs.readFileSync('backup.json'));
   console.log('Sources:', JSON.stringify(backup.sources).length);
   console.log('Navigation:', JSON.stringify(backup.navigation).length);
   console.log('Notes:', JSON.stringify(backup.notes).length);
   console.log('Snippets:', JSON.stringify(backup.snippets).length);
   console.log('Clipboard:', JSON.stringify(backup.clipboard).length);
   ```

2. **找出大文件**
   ```javascript
   // 找出最大的片段
   backup.snippets.sort((a, b) => b.content.length - a.content.length);
   console.log('Top 10 largest snippets:');
   backup.snippets.slice(0, 10).forEach(s => {
     console.log(`${s.title}: ${(s.content.length / 1024 / 1024).toFixed(2)} MB`);
   });
   ```

**解决方案**:

**方案 A：分批导出**
- 使用"清理数据"功能删除不需要的数据
- 分别导出不同类型的数据

**方案 B：压缩导出**
```javascript
// 使用 gzip 压缩
const pako = require('pako');
const compressed = pako.gzip(JSON.stringify(backup));
```

---

## 订阅刷新问题

### 问题 1：订阅源无法刷新

**症状**:
- 点击刷新按钮无响应
- 提示"刷新失败"
- 订阅内容一直是旧的

**排查步骤**:

1. **检查源 URL 是否可访问**
   ```bash
   curl -I https://example.com/feed.xml
   ```
   - 如果返回 404/500，说明源不可用
   - 如果超时，说明网络问题

2. **检查 DNS 解析**
   ```bash
   nslookup example.com
   ```
   - 确认域名可以正常解析
   - 检查是否为内网地址（会被阻止）

3. **检查内容大小**
   ```bash
   curl -s https://example.com/feed.xml | wc -c
   ```
   - 订阅源内容限制：10MB
   - 如果超过限制，会被拒绝

4. **检查缓存锁**
   - 如果多次快速刷新，可能触发锁争用
   - 等待 2 分钟后重试

**解决方案**:

**方案 A：更新源 URL**
- 如果源已失效，更新为新的 URL
- 或者删除该订阅源

**方案 B：等待缓存过期**
- 缓存 TTL：根据源配置（通常 1-24 小时）
- 等待缓存自动过期后会重新拉取

**方案 C：清除缓存**
```sql
-- 清除特定订阅源的缓存
DELETE FROM cache_entries 
WHERE key LIKE 'subscription:%';
```

### 问题 2：订阅刷新很慢

**症状**:
- 刷新按钮转圈很久
- 超过 30 秒才完成

**原因**:
- 订阅源服务器响应慢
- 订阅源内容过大
- 并发拉取数量过多

**排查步骤**:

1. **测试源响应时间**
   ```bash
   time curl -s https://example.com/feed.xml > /dev/null
   ```

2. **检查源内容大小**
   ```bash
   curl -s https://example.com/feed.xml | wc -c
   ```

**解决方案**:

**方案 A：优化源配置**
- 减少订阅源数量
- 删除响应慢的源
- 使用 RSS 聚合服务（如 Feedly）

**方案 B：调整并发数**
```typescript
// packages/worker/src/services/subscriptions-service.ts
const MAX_CONCURRENT_FETCHES = 8; // 降低并发数
```

### 问题 3：订阅内容解析失败

**症状**:
- 刷新成功，但内容为空
- 提示"解析失败"

**原因**:
- 订阅源格式不标准
- 不支持的 RSS/Atom 版本
- 内容编码问题

**排查步骤**:

1. **检查源格式**
   ```bash
   curl -s https://example.com/feed.xml | head -n 20
   ```
   - 确认是 RSS 或 Atom 格式
   - 检查 XML 是否有效

2. **检查编码**
   ```bash
   curl -I https://example.com/feed.xml | grep -i content-type
   ```
   - 确认编码为 UTF-8

**解决方案**:

**方案 A：使用标准源**
- 更换为标准的 RSS/Atom 源
- 或者使用 RSS 转换服务

**方案 B：手动添加内容**
- 如果源格式特殊，手动复制内容
- 或者使用浏览器扩展抓取

---

## 认证问题

### 问题 1：无法登录

**症状**:
- 输入密码后提示"密码错误"
- 确认密码正确但仍无法登录

**排查步骤**:

1. **检查密码哈希**
   ```bash
   echo -n "your-password" | sha256sum
   ```
   - 对比环境变量 `MASTER_PASSWORD_HASH`
   - 注意：不要有换行符（使用 `echo -n`）

2. **检查环境变量**
   ```bash
   # Cloudflare Workers
   wrangler secret list
   ```

**解决方案**:

**方案 A：重新设置密码哈希**
```bash
# 1. 生成新的哈希
echo -n "new-password" | sha256sum

# 2. 更新环境变量
wrangler secret put MASTER_PASSWORD_HASH
```

**方案 B：使用兼容注册接口**
- 如果开启了兼容注册接口
- 可以通过 API 创建新会话

### 问题 2：会话频繁过期

**症状**:
- 登录后很快就需要重新登录
- 会话 Cookie 丢失

**原因**:
- 会话 TTL 过短（默认 24 小时）
- Cookie 设置问题
- 浏览器隐私设置

**排查步骤**:

1. **检查 Cookie**
   - 打开浏览器开发者工具 → Application → Cookies
   - 查看 `session` Cookie 是否存在
   - 检查过期时间

2. **检查浏览器设置**
   - 确认未启用"清除 Cookie"
   - 确认未启用"隐私模式"

**解决方案**:

**方案 A：调整会话 TTL**
```typescript
// packages/worker/src/controllers/compat-controller.ts
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天
```

**方案 B：使用"记住我"功能**
- 如果有"记住我"选项，勾选它
- 会话 TTL 会延长

---

## 性能问题

### 问题 1：页面加载缓慢

**症状**:
- 首次加载超过 5 秒
- 切换页面有明显延迟

**排查步骤**:

1. **检查网络**
   - 打开浏览器开发者工具 → Network
   - 查看哪些请求慢

2. **检查数据量**
   ```sql
   -- 检查各表的数据量
   SELECT 'sources' as table_name, COUNT(*) as count FROM sources
   UNION ALL
   SELECT 'navigation_links', COUNT(*) FROM navigation_links
   UNION ALL
   SELECT 'notes', COUNT(*) FROM notes
   UNION ALL
   SELECT 'snippets', COUNT(*) FROM snippets;
   ```

**解决方案**:

**方案 A：清理数据**
- 删除不需要的数据
- 使用"清理数据"功能

**方案 B：优化查询**
- 添加数据库索引
- 使用分页加载

### 问题 2：订阅刷新占用资源

**症状**:
- 刷新订阅时页面卡顿
- CPU 使用率高

**解决方案**:

**方案 A：减少并发数**
```typescript
const MAX_CONCURRENT_FETCHES = 4; // 降低并发数
```

**方案 B：分批刷新**
- 不要一次刷新所有订阅源
- 分批次刷新

---

## 数据库问题

### 问题 1：数据库查询失败

**症状**:
- 提示"数据库错误"
- 页面显示空白

**排查步骤**:

1. **检查数据库绑定**
   ```bash
   wrangler d1 list
   ```

2. **检查数据库状态**
   ```bash
   wrangler d1 execute <DB_NAME> --command "SELECT 1"
   ```

**解决方案**:

**方案 A：重新绑定数据库**
```toml
# wrangler.toml
[[d1_databases]]
binding = "DB"
database_name = "riku-hub"
database_id = "<your-database-id>"
```

**方案 B：运行迁移**
```bash
wrangler d1 execute <DB_NAME> --file=migrations/0001_initial.sql
```

### 问题 2：数据丢失

**症状**:
- 之前的数据不见了
- 导入的数据消失

**原因**:
- 数据库被清空
- 使用了错误的数据库

**解决方案**:

**方案 A：从备份恢复**
- 使用最近的备份文件导入
- 定期导出备份

**方案 B：检查数据库**
```sql
-- 检查数据是否真的丢失
SELECT COUNT(*) FROM navigation_links;
```

---

## 缓存问题

### 问题 1：缓存未生效

**症状**:
- 每次都重新拉取订阅源
- 响应时间没有改善

**排查步骤**:

1. **检查 KV 绑定**
   ```bash
   wrangler kv:namespace list
   ```

2. **检查缓存键**
   ```bash
   wrangler kv:key list --namespace-id=<NAMESPACE_ID>
   ```

**解决方案**:

**方案 A：重新绑定 KV**
```toml
# wrangler.toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "<your-kv-id>"
```

### 问题 2：缓存数据过期

**症状**:
- 缓存命中率低
- 频繁重新拉取

**解决方案**:

**方案 A：调整 TTL**
```typescript
// 延长缓存时间
await env.CACHE_KV.put(key, value, {
  expirationTtl: 24 * 60 * 60 // 24 小时
});
```

---

## 获取帮助

如果以上方法都无法解决问题，请：

1. **查看日志**
   ```sql
   SELECT * FROM app_logs 
   ORDER BY created_at DESC 
   LIMIT 100;
   ```

2. **提交 Issue**
   - 访问 GitHub Issues
   - 提供详细的错误信息和复现步骤

3. **联系支持**
   - 邮箱：support@example.com
   - 响应时间：24 小时内

---

**文档版本**: 1.0  
**最后更新**: 2026-03-20  
**维护者**: Riku-Hub Team
