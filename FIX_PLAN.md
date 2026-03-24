# Riku-Hub 问题修复计划

## 修复范围

根据审查报告，本次修复以下问题：

### 1. 添加订阅源内容大小限制（宽松）
- **限制：** 10MB（非常宽松，足够容纳大型订阅）
- **位置：** `packages/worker/src/services/subscriptions-service.ts`
- **影响：** 创建和更新订阅源时验证

### 2. 添加 CSRF 保护
- **方案：** 使用 SameSite Cookie 属性
- **位置：** `packages/worker/src/services/auth-service.ts`
- **影响：** 所有会话 Cookie

### 3. 修复会话固定攻击风险
- **方案：** 登录成功后重新生成 token
- **位置：** `packages/worker/src/services/auth-service.ts`
- **影响：** 登录流程

### 4. 添加 Rate Limiting（订阅刷新）
- **限制：** 每个用户 5 分钟内最多刷新 3 次
- **位置：** `packages/worker/src/controllers/subscriptions-controller.ts`
- **影响：** `/api/sources/refresh` 接口

### 5. 审查并清理日志敏感信息
- **检查：** 所有 `appendLog` 调用
- **确保：** 不记录密码、token 等敏感数据

### 6. 优化错误信息
- **原则：** 生产环境返回通用错误，详细信息只记录日志
- **位置：** 多处错误处理

### 7. 添加输入验证
- **验证：** URL 格式、Email 格式、字符串长度
- **位置：** 导航链接、订阅源等

### 8. 添加数据库索引
- **索引：** `sources.enabled` 字段
- **位置：** 新建迁移文件

---

## 详细修复步骤

### 步骤 1：添加订阅源内容大小限制

**文件：** `packages/worker/src/services/subscriptions-service.ts`

```typescript
// 在 createSource 和 updateSource 方法中添加验证
const MAX_SOURCE_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB

if (content.length > MAX_SOURCE_CONTENT_SIZE) {
  throw new SubscriptionsHttpError(400, '订阅源内容过大（最大 10MB）');
}
```

---

### 步骤 2：添加 CSRF 保护（SameSite Cookie）

**文件：** `packages/worker/src/services/auth-service.ts`

```typescript
// 修改 setCookie 调用，添加 SameSite 属性
setCookie(response, 'session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax', // 或 'Strict'
  maxAge: SESSION_TTL_SECONDS
});
```

---

### 步骤 3：修复会话固定攻击

**文件：** `packages/worker/src/services/auth-service.ts`

```typescript
// 在 login 方法中，登录成功后删除旧 session（如果存在）
const oldToken = getCookie(request, 'session');
if (oldToken) {
  await this.repository.deleteSession(oldToken);
}

// 然后生成新 token
const token = randomToken(32);
```

---

### 步骤 4：添加 Rate Limiting

**文件：** `packages/worker/src/controllers/subscriptions-controller.ts`

```typescript
// 添加刷新限流检查
private async checkRefreshRateLimit(env: Env, username: string): Promise<boolean> {
  const key = `ratelimit:refresh:${username}`;
  const now = Date.now();
  const window = 5 * 60 * 1000; // 5分钟
  const maxAttempts = 3;
  
  const data = await env.CACHE_KV.get(key, 'json') as { attempts: number; resetAt: number } | null;
  
  if (!data || now > data.resetAt) {
    await env.CACHE_KV.put(key, JSON.stringify({ attempts: 1, resetAt: now + window }), { expirationTtl: 300 });
    return true;
  }
  
  if (data.attempts >= maxAttempts) {
    return false;
  }
  
  await env.CACHE_KV.put(key, JSON.stringify({ attempts: data.attempts + 1, resetAt: data.resetAt }), { expirationTtl: 300 });
  return true;
}
```

---

### 步骤 5：审查日志敏感信息

**检查所有 appendLog 调用：**
- ✅ `source_create` - 只记录名称
- ✅ `source_update` - 只记录名称
- ✅ `login` - 只记录用户名
- ✅ `logout` - 无敏感信息
- ✅ 其他操作 - 无敏感信息

**结论：** 当前日志记录安全，无需修改

---

### 步骤 6：优化错误信息

**原则：**
- 内部错误返回通用信息
- 用户错误返回具体信息
- 详细错误记录到日志

**示例修改：**
```typescript
// 修改前
return { ok: false, error: `刷新聚合缓存失败: ${String(error)}` };

// 修改后
await appendLog(env, 'refresh_error', String(error));
return { ok: false, error: '刷新失败，请稍后重试' };
```

---

### 步骤 7：添加输入验证

**URL 验证：**
```typescript
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

**Email 验证：**
```typescript
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

**字符串长度验证：**
```typescript
function validateStringLength(value: string, min: number, max: number, fieldName: string): void {
  if (value.length < min || value.length > max) {
    throw new Error(`${fieldName} 长度必须在 ${min}-${max} 之间`);
  }
}
```

---

### 步骤 8：添加数据库索引

**文件：** `migrations/0006_add_enabled_index.sql`

```sql
-- 为 sources.enabled 字段添加索引，优化查询性能
CREATE INDEX IF NOT EXISTS idx_sources_enabled
  ON sources(enabled, sort_order);
```

---

## 测试计划

### 1. 订阅源大小限制测试
```bash
# 测试超大内容
curl -X POST /api/sources \
  -H "Cookie: session=xxx" \
  -d '{"name":"test","content":"'$(head -c 11000000 /dev/zero | base64)'"}'
# 预期：400 错误
```

### 2. CSRF 保护测试
```bash
# 检查 Cookie 属性
curl -v /api/auth/login
# 预期：Set-Cookie 包含 SameSite=Lax
```

### 3. Rate Limiting 测试
```bash
# 连续刷新 4 次
for i in {1..4}; do
  curl -X POST /api/sources/refresh -H "Cookie: session=xxx"
done
# 预期：第 4 次返回 429
```

### 4. 输入验证测试
```bash
# 测试无效 URL
curl -X POST /api/navigation/links \
  -H "Cookie: session=xxx" \
  -d '{"categoryId":"xxx","title":"test","url":"invalid-url"}'
# 预期：400 错误
```

---

## 回归测试

修复完成后运行：
```bash
corepack pnpm test
corepack pnpm check
```

确保所有测试通过。

---

## 部署步骤

1. 运行新的数据库迁移
```bash
wrangler d1 execute DB --file ./migrations/0006_add_enabled_index.sql
```

2. 部署代码
```bash
corepack pnpm deploy
```

3. 验证功能
- 登录测试
- 订阅源创建测试
- 刷新限流测试

---

## 预期影响

### 用户体验
- ✅ 更安全的会话管理
- ✅ 防止恶意大文件上传
- ✅ 防止频繁刷新滥用
- ⚠️ 刷新限流可能影响高频用户（但 5 分钟 3 次已经很宽松）

### 性能
- ✅ 数据库索引提升查询性能
- ✅ 大小限制防止内存溢出
- ⚠️ Rate Limiting 增加少量 KV 读写

### 兼容性
- ✅ 完全向后兼容
- ✅ 现有功能不受影响

---

## 完成标准

- [ ] 所有代码修改完成
- [ ] 单元测试通过
- [ ] 类型检查通过
- [ ] 手动测试通过
- [ ] 文档更新（如需要）
- [ ] 删除临时文档

---

**修复开始时间：** 待定  
**预计完成时间：** 1-2 小时  
**修复人：** Kiro AI Assistant
