# Riku-Hub 安全最佳实践

本文档描述 Riku-Hub 的安全设计、配置要求和最佳实践。

## 目录

- [安全架构](#安全架构)
- [环境变量配置](#环境变量配置)
- [导入安全](#导入安全)
- [兼容注册接口](#兼容注册接口)
- [审计日志](#审计日志)
- [安全检查清单](#安全检查清单)

---

## 安全架构

### 认证与授权

**认证机制**:
- 基于会话 Cookie 的认证
- 会话 TTL：24 小时
- CSRF 保护：SameSite=Strict

**授权机制**:
- 单用户模式（通过主密码保护）
- 所有 API 端点需要有效会话
- 兼容注册接口默认关闭

### 输入验证

**多层验证**:
1. 前端表单验证（基础校验）
2. 后端类型验证（TypeScript 严格模式）
3. 业务逻辑验证（大小限制、格式检查）
4. 安全校验（URL 协议、SQL 注入防护）

### SSRF 防护

**DNS 验证**:
- 订阅源 URL 必须通过 DNS 验证
- 阻止内网 IP 地址（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）
- 阻止本地回环地址（127.0.0.0/8, ::1）
- 阻止链路本地地址（169.254.0.0/16, fe80::/10）

**实现**:
```typescript
// packages/shared/src/parser.ts
function isSafeDomain(hostname: string): boolean {
  // 检查是否为内网 IP
  // 检查是否为本地回环
  // 检查是否为链路本地
}
```

---

## 环境变量配置

### 必需变量

#### MASTER_PASSWORD_HASH
- **用途**: 主密码的 SHA-256 哈希值
- **要求**: 
  - 原始密码至少 16 个字符
  - 包含大小写字母、数字和特殊字符
  - 不要使用常见密码
- **生成方法**:
  ```bash
  echo -n "your-strong-password" | sha256sum
  ```
- **示例**: `5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8`

### 可选变量（安全相关）

#### COMPAT_ALLOW_REGISTER
- **用途**: 是否允许兼容注册接口
- **默认值**: `false`
- **生产环境**: 必须为 `false`
- **开发环境**: 可以设置为 `true`（仅用于测试）
- **有效值**: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`

#### COMPAT_REGISTER_KEY
- **用途**: 兼容注册接口的密钥
- **要求**:
  - 至少 32 个字符
  - 使用强随机字符串
  - 定期轮换（建议 90 天）
- **生成方法**:
  ```bash
  openssl rand -base64 32
  ```
- **示例**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

### 环境变量安全基线

**生产环境必须满足**:
```bash
# 认证
MASTER_PASSWORD_HASH=<strong-hash>  # 必需，强密码哈希

# 兼容接口（生产环境必须关闭）
COMPAT_ALLOW_REGISTER=false         # 必需
# COMPAT_REGISTER_KEY 不设置或留空

# 数据库
DATABASE=<D1-binding>               # 必需
CACHE_KV=<KV-binding>               # 必需
APP_KV=<KV-binding>                 # 可选
```

**开发环境可以放宽**:
```bash
# 认证
MASTER_PASSWORD_HASH=<test-hash>

# 兼容接口（仅用于测试）
COMPAT_ALLOW_REGISTER=true
COMPAT_REGISTER_KEY=<32-chars-minimum>

# 数据库
DATABASE=<local-D1>
CACHE_KV=<local-KV>
```

---

## 导入安全

### URL 协议校验

**问题**: 恶意备份可能包含非 HTTP(S) 协议的 URL，导致 XSS 或本地文件访问。

**防护措施**:
1. **双重校验**：规范化前后都检查
2. **协议白名单**：仅允许 `http://` 和 `https://`
3. **宽容模式**：跳过非法链接，继续导入有效链接
4. **详细反馈**：返回跳过的链接详情

**阻止的协议**:
- `javascript:` - XSS 攻击
- `data:` - XSS 攻击
- `file:` - 本地文件访问
- `vbscript:` - 脚本执行
- `about:` - 浏览器内部页面

**实现**:
```typescript
// packages/worker/src/index.ts
function normalizeNavigationBackup(records, skippedDetails) {
  // 1. 规范化前检查
  if (rawUrl && /^(javascript|data|file|vbscript|about):/i.test(rawUrl)) {
    skippedDetails.push({ url: rawUrl, reason: 'illegal_protocol' });
    return null;
  }
  
  // 2. 规范化
  const normalizedUrl = normalizeNavigationUrl(rawUrl);
  
  // 3. 规范化后再次检查
  if (normalizedUrl && !isSafeNavigationUrl(normalizedUrl)) {
    skippedDetails.push({ url: rawUrl, reason: 'unsafe_url' });
    return null;
  }
}
```

### 内容大小限制

**按类型分类限制**（遵循用户体验优先原则）:

| 类型 | 限制 | 说明 |
|------|------|------|
| 订阅源内容 | 10MB | 兼容大型订阅源 |
| 图片片段 | 10MB | 支持高清截图（base64 编码） |
| 笔记内容 | 5MB | 支持长文档 |
| 代码片段 | 1MB | 支持完整代码文件 |
| 链接数据 | 10KB | 足够存储元数据 |
| 总备份大小 | 100MB | 防止过大备份 |

**数量限制**:
- 每个分类的条目数：2,000
- 导航链接总数：10,000
- 订阅源数量：2,000

**实现**:
```typescript
// packages/worker/src/services/settings-service.ts
const CONTENT_SIZE_LIMITS = {
  source: 10 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  code: 1 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  link: 10 * 1024
};
```

### 导入响应格式

**成功导入**:
```json
{
  "success": true,
  "message": "导入完成，当前数据已替换",
  "imported": {
    "sources": 10,
    "navigation": 50,
    "notes": 20,
    "snippets": 30,
    "clipboard": 15
  },
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

---

## 兼容注册接口

### 设计目的

兼容注册接口用于：
- 兼容旧系统或自动化工具
- 测试环境快速创建账户
- CI/CD 流程中的自动化测试

**⚠️ 警告**: 这是一个高权限入口，生产环境必须关闭！

### 安全加固措施

#### 1. 默认关闭
```bash
# 生产环境
COMPAT_ALLOW_REGISTER=false  # 必须

# 开发环境（仅用于测试）
COMPAT_ALLOW_REGISTER=true
```

#### 2. 密钥强度要求
```typescript
// 至少 32 个字符
if (requiredRegisterKey.length < 32) {
  throw new Error('COMPAT_REGISTER_KEY 长度必须至少 32 个字符');
}
```

#### 3. IP 限流
- 限制：5 次/小时（每个 IP）
- 存储：CACHE_KV
- 窗口：3600 秒（1 小时）

```typescript
const rateLimitKey = `rate_limit:compat_register:${clientIp}`;
const currentCount = await getRateLimitCount(env.CACHE_KV, rateLimitKey);
if (currentCount >= 5) {
  throw new Error('注册请求过于频繁，请 1 小时后重试');
}
```

#### 4. 审计日志
所有注册尝试都会记录到 `app_logs` 表：

**成功注册**:
```json
{
  "type": "COMPAT_REGISTER_SUCCESS",
  "username": "testuser",
  "email": "test@example.com",
  "ip": "1.2.3.4",
  "userAgent": "Mozilla/5.0...",
  "timestamp": 1234567890
}
```

**密钥错误**:
```json
{
  "type": "COMPAT_REGISTER_INVALID_KEY",
  "ip": "1.2.3.4",
  "userAgent": "Mozilla/5.0...",
  "timestamp": 1234567890
}
```

**触发限流**:
```json
{
  "type": "COMPAT_REGISTER_RATE_LIMIT",
  "ip": "1.2.3.4",
  "userAgent": "Mozilla/5.0...",
  "timestamp": 1234567890
}
```

### 使用方法

**请求**:
```bash
curl -X POST https://your-worker.workers.dev/api/compat/register \
  -H "Content-Type: application/json" \
  -H "x-register-key: your-32-char-key" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "strong-password"
  }'
```

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

### 运维建议

1. **生产环境默认关闭**
   ```bash
   COMPAT_ALLOW_REGISTER=false
   ```

2. **密钥管理**
   - 使用 Cloudflare Secrets 存储
   - 定期轮换（建议 90 天）
   - 不要硬编码或提交到代码仓库

3. **访问控制**
   - 仅允许特定 IP 或内网访问
   - 使用 Cloudflare Access 或 WAF 规则

4. **监控告警**
   - 监控兼容注册调用频率
   - 异常调用时触发告警
   - 定期审查审计日志

5. **文档化**
   - 在部署文档中明确说明风险
   - 记录开启原因和时间
   - 定期审查是否仍需开启

---

## 审计日志

### 日志表结构

**app_logs 表**（应用级日志）:
```sql
CREATE TABLE app_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
```

### 安全事件类型

| 事件类型 | 说明 | 严重程度 |
|---------|------|---------|
| COMPAT_REGISTER_SUCCESS | 兼容注册成功 | INFO |
| COMPAT_REGISTER_INVALID_KEY | 密钥错误 | WARNING |
| COMPAT_REGISTER_RATE_LIMIT | 触发限流 | WARNING |

### 查询审计日志

**查询最近的注册尝试**:
```sql
SELECT * FROM app_logs 
WHERE action LIKE 'COMPAT_REGISTER%' 
ORDER BY created_at DESC 
LIMIT 100;
```

**统计失败尝试**:
```sql
SELECT 
  action,
  COUNT(*) as count,
  DATE(created_at) as date
FROM app_logs 
WHERE action IN ('COMPAT_REGISTER_INVALID_KEY', 'COMPAT_REGISTER_RATE_LIMIT')
GROUP BY action, DATE(created_at)
ORDER BY date DESC;
```

**查询特定 IP 的活动**:
```sql
SELECT * FROM app_logs 
WHERE detail LIKE '%"ip":"1.2.3.4"%'
ORDER BY created_at DESC;
```

### 日志保留策略

**建议**:
- 保留时间：90 天
- 定期归档：每月归档到对象存储
- 敏感信息：不记录密码等敏感数据
- 定期审查：每周审查异常日志

---

## 安全检查清单

### 部署前检查

- [ ] `MASTER_PASSWORD_HASH` 已设置且使用强密码
- [ ] `COMPAT_ALLOW_REGISTER` 设置为 `false`（生产环境）
- [ ] `COMPAT_REGISTER_KEY` 未设置或留空（生产环境）
- [ ] HTTPS 强制启用
- [ ] 安全响应头配置（CSP, X-Frame-Options, etc.）
- [ ] Rate Limiting 启用
- [ ] 审计日志启用

### 运行时检查

- [ ] 定期审查审计日志（每周）
- [ ] 监控异常登录尝试
- [ ] 监控兼容注册调用（应该为 0）
- [ ] 检查订阅源 URL 是否异常
- [ ] 检查导入失败率

### 定期维护

- [ ] 密钥轮换（90 天）
- [ ] 依赖包更新（每月）
- [ ] 安全扫描（每季度）
- [ ] 渗透测试（每年）
- [ ] 备份恢复测试（每季度）

### 事件响应

**发现安全问题时**:
1. 立即禁用受影响的功能
2. 审查审计日志，确定影响范围
3. 修复漏洞
4. 通知用户（如果需要）
5. 更新文档和检查清单

**密钥泄露时**:
1. 立即轮换密钥
2. 审查审计日志，查找异常活动
3. 撤销所有会话
4. 通知用户更改密码
5. 调查泄露原因

---

## 安全联系方式

如果发现安全问题，请通过以下方式报告：

- **邮箱**: security@example.com
- **加密**: 使用 PGP 公钥加密敏感信息
- **响应时间**: 24 小时内确认，7 天内修复

**请勿公开披露**安全问题，直到我们有机会修复。

---

## 参考资源

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Workers Security](https://developers.cloudflare.com/workers/platform/security/)
- [Web Security Cheat Sheet](https://cheatsheetseries.owasp.org/)

---

**文档版本**: 1.0  
**最后更新**: 2026-03-20  
**维护者**: Riku-Hub Team
