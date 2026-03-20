# Deployment

这份文档只写当前仓库真实可用的部署步骤，不预设额外基础设施。

## 绑定

- `CACHE_KV`：缓存 KV，存聚合结果、格式化输出、favicon 和 DNS 缓存。
- `DB`：Cloudflare D1，存结构化业务表。

当前仓库默认部署只需要 `CACHE_KV` 和 `DB`。  
`APP_KV` 仅作为兼容分支保留，不在当前默认部署链路中要求绑定。

## 迁移顺序

- `migrations/0001_app_data.sql`
- `migrations/0002_runtime_data.sql`
- `migrations/0003_add_notes.sql`
- `migrations/0004_add_clipboard.sql`
- `migrations/0005_add_settings_logs.sql`

`migrations/0001_initial.sql` 和 `0001_app_data.sql` 内容重复，部署时只保留一条执行线即可，当前文档按 `0001_app_data.sql` 作为起点。

## 部署步骤

1. 安装依赖。

```bash
pnpm install
```

2. 创建 KV namespace 和 D1 数据库，然后把结果填进 `wrangler.toml`（或直接在 Dashboard 绑定同名变量）。

```bash
pnpm dlx wrangler kv namespace create CACHE_KV
pnpm dlx wrangler d1 create riku-hub-db
```

3. 按顺序执行迁移。

```bash
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0001_app_data.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0002_runtime_data.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0003_add_notes.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0004_add_clipboard.sql
pnpm dlx wrangler d1 execute riku-hub-db --file ./migrations/0005_add_settings_logs.sql
```

4. 设置 secrets。

```bash
pnpm dlx wrangler secret put ADMIN_USERNAME
pnpm dlx wrangler secret put ADMIN_PASSWORD_HASH
pnpm dlx wrangler secret put SUB_TOKEN
```

可选兼容开关：

- `COMPAT_ALLOW_REGISTER` 默认关闭（未设置即关闭）。
  只有在你明确需要旧版 `/api/auth/register` 行为时，才在 Worker 环境变量中设置为 `true`。
- `COMPAT_REGISTER_KEY` 默认为空。
  当开启 `COMPAT_ALLOW_REGISTER=true` 时，必须同时配置该密钥；客户端需在请求体 `register_key` 或请求头 `x-register-key` 传入。
- `PUBLIC_CLIPBOARD_ENABLED` 默认关闭。
  仅在你确认“登录页公开节点展示”场景时设置为 `true`。

5. 生成前端静态资源并部署。

```bash
pnpm build:web
pnpm deploy
```

`pnpm deploy` 会先执行 `check + test + build:web`，然后再部署。

## 本地开发

- `pnpm dev:web`：启动 Vite 前端。
- `pnpm dev:worker`：启动 Wrangler Worker。
- `pnpm build:web`：检查前端打包是否可用。
- `pnpm test`：跑 workspace 里的测试。

## 路由兼容

- `GET /api/navigation` 和 `GET /api/snippets` 是当前主接口。
- `GET /api/nav` 和 `GET /api/clipboard` 仍保留为兼容别名。
- 页面路由当前以 `/nav` 和 `/snippets` 为准。
- `/navigation` 和 `/clipboard` 仍会被前端路径归一化到主路由，但它们属于兼容入口，不建议当作新链接写进文档或配置。


## 安全配置指南

### 环境变量安全要求

**ADMIN_PASSWORD_HASH（必需）**：
- 使用强密码（至少 16 个字符，包含大小写字母、数字和特殊字符）
- 生成哈希：`echo -n "your-strong-password" | sha256sum`
- 不要使用常见密码或弱密码
- 示例：`5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8`

**SUB_TOKEN（可选）**：
- 用于订阅聚合功能的访问令牌
- 建议使用随机字符串：`openssl rand -base64 32`

**COMPAT_REGISTER_KEY（仅开发环境）**：
- **生产环境必须不设置或留空**
- 开发环境如需使用，必须至少 32 个字符
- 生成方法：`openssl rand -base64 32`
- **定期轮换**：建议每 90 天轮换一次

### 安全检查清单

**部署前必须完成**：

- [ ] `ADMIN_PASSWORD_HASH` 已设置且使用强密码
- [ ] `COMPAT_ALLOW_REGISTER` 未设置或设置为 `false`（生产环境）
- [ ] `COMPAT_REGISTER_KEY` 未设置或留空（生产环境）
- [ ] HTTPS 已启用（Cloudflare Workers 默认启用）
- [ ] 已阅读 [SECURITY.md](./SECURITY.md) 文档
- [ ] 已了解 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 故障排查方法

**运行时检查**：

- [ ] 定期审查审计日志（每周）
- [ ] 监控异常登录尝试
- [ ] 监控兼容注册调用（应该为 0）
- [ ] 检查订阅源 URL 是否异常
- [ ] 检查导入失败率

**定期维护**：

- [ ] 密钥轮换（90 天）
- [ ] 依赖包更新（每月）
- [ ] 安全扫描（每季度）
- [ ] 备份恢复测试（每季度）

### 兼容注册接口安全警告

⚠️ **重要**：`COMPAT_ALLOW_REGISTER` 是一个高权限入口，**生产环境必须关闭**！

**为什么要关闭**：
- 允许绕过主密码直接创建会话
- 如果密钥泄露，可能被滥用
- 缺少额外的安全验证（如验证码）

**如果必须开启**（仅开发/测试环境）：
1. 设置强密钥（至少 32 个字符）
2. 启用 IP 限流（已内置，5 次/小时）
3. 定期审查审计日志
4. 使用 Cloudflare Access 或 WAF 限制访问
5. 定期轮换密钥（90 天）

详细信息请参阅 [SECURITY.md - 兼容注册接口](./SECURITY.md#兼容注册接口)。

### 监控和告警

**推荐监控指标**：
- 响应时间（P50/P95/P99）
- 错误率
- 缓存命中率
- 订阅刷新成功率
- 兼容注册调用次数（应该为 0）

**告警规则**：
- 错误率 > 5%（5 分钟）
- P95 延迟 > 2000ms（10 分钟）
- 缓存命中率 < 70%（15 分钟）
- 兼容注册调用 > 0（立即）

### 故障恢复

**备份策略**：
- 定期导出备份（建议每天）
- 备份保留时间：30 天
- 备份存储位置：对象存储或本地

**恢复步骤**：
1. 准备备份文件
2. 登录系统
3. 进入设置页面
4. 点击"导入备份"
5. 选择备份文件
6. 确认导入

详细故障排查请参阅 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

## 相关文档

- [SECURITY.md](./SECURITY.md) - 安全最佳实践
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - 故障排查指南
- [API.md](./API.md) - API 文档

---

**文档版本**: 1.1  
**最后更新**: 2026-03-20  
**维护者**: Riku-Hub Team
