# Cloudflare Access 配置指南

## 前后台分离架构

### 公开访问（无需认证）
- `/` - 首页（3D 背景展示页）
- `/i/:id/:filename` - 图片外链

### 受保护路径（需要 CF Access 认证）
- `/riku/*` - 所有后台管理页面

## Cloudflare Access 配置步骤

### 1. 登录 Cloudflare Dashboard
访问：https://dash.cloudflare.com/

### 2. 进入 Zero Trust
1. 选择你的账户
2. 点击左侧菜单 "Zero Trust"
3. 如果是第一次使用，需要设置团队名称

### 3. 创建 Access 应用

#### 步骤 A：基本信息
1. 进入 "Access" → "Applications"
2. 点击 "Add an application"
3. 选择 "Self-hosted"
4. 填写信息：
   - Application name: `Riku-Hub 后台`
   - Session Duration: `24 hours`（或根据需求调整）
   - Application domain: `dh.300031.xyz`
   - Path: `/riku`

#### 步骤 B：配置策略
1. Policy name: `允许管理员访问`
2. Action: `Allow`
3. 添加规则（选择一种或多种）：

**选项 1：邮箱验证（推荐）**
```
Include:
- Emails: your-email@example.com
```

**选项 2：GitHub OAuth**
```
Include:
- Login Methods: GitHub
- GitHub usernames: your-github-username
```

**选项 3：一次性 PIN 码**
```
Include:
- Emails ending in: @yourdomain.com
- Login Methods: One-time PIN
```

#### 步骤 C：高级设置（可选）
- Enable automatic cloudflared authentication: ✅
- Browser rendering: ✅
- CORS Settings: 根据需要配置

### 4. 测试访问

#### 测试公开访问
```bash
# 首页应该可以直接访问
curl https://dh.300031.xyz/

# 图片外链应该可以直接访问
curl https://dh.300031.xyz/i/c572c341/test.jpg
```

#### 测试受保护路径
```bash
# 后台页面应该被拦截
curl https://dh.300031.xyz/riku/images
# 应该返回 CF Access 登录页面
```

### 5. 登录流程

1. 访问 `https://dh.300031.xyz/riku/login`
2. CF Access 拦截并显示登录页面
3. 选择认证方式（邮箱/GitHub/等）
4. 完成认证后，CF Access 设置 Cookie
5. 自动跳转到登录页面
6. 输入应用层用户名密码
7. 登录成功，进入后台

### 6. API 访问说明

**重要**：API 端点 `/api/*` 不受 CF Access 保护，但有应用层 Session Token 认证。

这是因为：
- 前端在 CF Access 保护下，只有授权用户能访问
- 前端调用 API 时，使用 Session Token 认证
- 双重保护：CF Access（前端） + Session Token（API）

如果需要 API 也加 CF Access 保护，需要额外配置 CORS 和认证流程。

## 安全检查清单

- [ ] CF Access 应用已创建
- [ ] 路径配置为 `/riku`
- [ ] 认证策略已设置（邮箱/GitHub）
- [ ] 测试公开路径可访问（`/` 和 `/i/*`）
- [ ] 测试受保护路径被拦截（`/riku/*`）
- [ ] 完成 CF Access 认证后可访问后台
- [ ] 应用层登录功能正常
- [ ] 图片外链正常工作

## 常见问题

### Q1: 访问 `/riku/images` 时出现无限重定向
**A**: 检查 CF Access 策略是否正确，确保你的邮箱/账号在允许列表中。

### Q2: 图片外链无法访问
**A**: 确保 CF Access 规则只保护 `/riku` 路径，不要保护 `/i` 路径。

### Q3: API 调用失败
**A**: API 不受 CF Access 保护，检查 Session Token 是否有效。

### Q4: 登录后仍然被拦截
**A**: 清除浏览器 Cookie，重新进行 CF Access 认证。

## 路径规则总结

```
Cloudflare Access 规则：
┌─────────────────────────────────────┐
│ Application: Riku-Hub 后台          │
│ Domain: dh.300031.xyz               │
│ Path: /riku                         │
│ Include: /riku/*                    │
│ Exclude: (无)                       │
└─────────────────────────────────────┘

不受保护的路径：
- / (首页)
- /i/* (图片外链)
- /api/* (API 端点，有应用层认证)
- /sub/* (订阅端点)
- /health (健康检查)
```

## 部署后验证

1. 访问 `https://dh.300031.xyz/` → 应该看到首页
2. 点击"登录"按钮 → 跳转到 `/riku/login`
3. CF Access 拦截 → 显示认证页面
4. 完成认证 → 看到应用登录页面
5. 输入用户名密码 → 进入后台
6. 测试图片外链 → 无需认证即可访问

## 回滚方案

如果出现问题，可以临时禁用 CF Access：
1. 进入 CF Dashboard → Zero Trust → Access → Applications
2. 找到 "Riku-Hub 后台" 应用
3. 点击 "..." → "Disable"
4. 所有路径恢复公开访问（但仍有应用层认证）
