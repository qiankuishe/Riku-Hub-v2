# 图床功能集成执行计划

## 项目概述

将 Telegraph-Image 的图床功能集成到 Riku-Hub，在侧边栏新增"图床"入口，提供完整的图片/视频/音频/文件管理功能。

**核心原则**：前端布局完全保留，后端逻辑照搬，只做技术栈适配。

---

## 阶段一：数据库和后端基础（第 1 天）✅

### 1.1 数据库迁移

**文件**：`migrations/0002_images.sql`

**任务**：
- [x] 创建 `images` 表
- [x] 创建索引
- [x] 添加外键约束

**SQL 结构**：
```sql
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  is_liked INTEGER DEFAULT 0,
  list_type TEXT,
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_images_user_id ON images(user_id);
CREATE INDEX idx_images_created_at ON images(created_at DESC);
CREATE INDEX idx_images_file_type ON images(file_type);
CREATE INDEX idx_images_is_liked ON images(is_liked);
```

### 1.2 环境变量配置

**文件**：`wrangler.toml`

**任务**：
- [x] 添加 Telegram Bot Token
- [x] 添加 Telegram Chat ID

**配置**：
```toml
[vars]
TELEGRAM_BOT_TOKEN = "your_bot_token"
TELEGRAM_CHAT_ID = "your_chat_id"
```

### 1.3 Telegram 服务层

**文件**：`packages/worker/src/services/telegram-service.ts`

**任务**：
- [x] 实现 `uploadToTelegram()` - 上传文件到 Telegram
- [x] 实现 `getFileUrl()` - 获取文件访问 URL
- [x] 实现 `proxyTelegramFile()` - 代理文件访问
- [x] 实现 `detectFileType()` - 文件类型检测

**接口**：
```typescript
export interface TelegramService {
  uploadToTelegram(file: File, env: Env): Promise<string>;
  getFileUrl(fileId: string, env: Env): Promise<string>;
}
```

### 1.4 Images Repository

**文件**：`packages/worker/src/repositories/images-repository.ts`

**任务**：
- [x] `list()` - 列表查询（支持分页、筛选、排序）
- [x] `getById()` - 根据 ID 获取
- [x] `create()` - 创建记录
- [x] `update()` - 更新记录
- [x] `delete()` - 删除记录
- [x] `toggleLike()` - 切换收藏状态
- [x] `updateListType()` - 更新黑白名单状态

**接口**：
```typescript
export interface ImagesRepository {
  list(userId: string, options: ListOptions): Promise<ImageRecord[]>;
  create(data: CreateImageData): Promise<ImageRecord>;
  update(id: string, userId: string, data: UpdateImageData): Promise<ImageRecord>;
  delete(id: string, userId: string): Promise<void>;
  toggleLike(id: string, userId: string): Promise<ImageRecord>;
  updateListType(id: string, userId: string, listType: 'Block' | 'White' | null): Promise<ImageRecord>;
}
```

### 1.5 Images API 路由

**文件**：`packages/worker/src/routes/images.ts`

**任务**：
- [x] `GET /api/images/list` - 获取列表
- [x] `POST /api/images/upload` - 上传文件
- [x] `DELETE /api/images/:id` - 删除文件
- [x] `POST /api/images/:id/like` - 切换收藏
- [x] `PUT /api/images/:id/name` - 修改文件名
- [x] `POST /api/images/:id/block` - 加入黑名单
- [x] `POST /api/images/:id/unblock` - 加入白名单
- [x] `GET /api/images/file/:id` - 获取文件（代理到 Telegram）
- [x] 路由注册到 `index.ts`
- [x] 更新 Env 接口

---

## 阶段二：前端 API 层（第 1 天）✅

### 2.1 类型定义

**文件**：`packages/shared/src/types/images.ts`

**任务**：
- [x] 定义 `ImageRecord` 类型
- [x] 定义 `FileType` 类型
- [x] 定义 `ListType` 类型
- [x] 定义请求/响应类型
- [x] 导出到 `types.ts`

**类型**：
```typescript
export type FileType = 'image' | 'video' | 'audio' | 'document';
export type ListType = 'Block' | 'White' | null;
export type SortOption = 'dateDesc' | 'nameAsc' | 'sizeDesc';
export type FilterOption = 'all' | 'favorites' | 'blocked' | 'unblocked' | 'adult';

export interface ImageRecord {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  fileType: FileType;
  telegramFileId: string;
  isLiked: boolean;
  listType: ListType;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageListResponse {
  images: ImageRecord[];
  cursor: string | null;
  hasMore: boolean;
}
```

### 2.2 API 客户端

**文件**：`packages/web/src/api/images.ts`

**任务**：
- [x] 实现 `getList()` - 获取列表
- [x] 实现 `upload()` - 上传文件
- [x] 实现 `delete()` - 删除文件
- [x] 实现 `toggleLike()` - 切换收藏
- [x] 实现 `updateName()` - 修改文件名
- [x] 实现 `updateListType()` - 更新黑白名单
- [x] 实现 `getFileUrl()` - 获取文件 URL

**接口**：
```typescript
export const imagesApi = {
  async getList(params: ListParams): Promise<ImageListResponse> {},
  async upload(file: File): Promise<ImageRecord> {},
  async delete(id: string): Promise<void> {},
  async toggleLike(id: string): Promise<ImageRecord> {},
  async updateName(id: string, name: string): Promise<ImageRecord> {},
  async updateListType(id: string, type: ListType): Promise<ImageRecord> {}
};
```

---

## 阶段三：前端页面开发（第 2-3 天）

### 3.1 页面结构

**文件**：`packages/web/src/pages/images/ImagesPage.vue`

**任务**：
- [ ] 创建页面骨架
- [ ] 实现顶部工具栏
- [ ] 实现文件网格布局
- [ ] 实现底部分页

**组件结构**：
```vue
<template>
  <div class="images-page">
    <!-- 顶部工具栏 -->
    <header class="images-header">
      <div class="header-left">
        <h1>图床管理</h1>
        <span class="stats">{{ totalCount }} 个文件</span>
      </div>
      <div class="header-center">
        <el-input v-model="searchQuery" placeholder="搜索..." />
      </div>
      <div class="header-right">
        <el-button @click="handleUpload">上传</el-button>
        <!-- 操作菜单 -->
      </div>
    </header>

    <!-- 文件网格 -->
    <main class="images-content">
      <div class="images-grid">
        <ImageCard v-for="item in displayedImages" :key="item.id" :image="item" />
      </div>
    </main>

    <!-- 分页 -->
    <footer class="images-footer">
      <el-pagination />
    </footer>
  </div>
</template>
```

### 3.2 子组件

**文件结构**：
```
packages/web/src/pages/images/
├── ImagesPage.vue
└── components/
    ├── ImageCard.vue       # 图片卡片
    ├── VideoCard.vue       # 视频卡片
    ├── AudioCard.vue       # 音频卡片
    ├── FileCard.vue        # 文件卡片
    └── ImageToolbar.vue    # 工具栏
```

**任务**：
- [ ] 创建 `ImageCard.vue` - 图片卡片组件
- [ ] 创建 `VideoCard.vue` - 视频卡片组件
- [ ] 创建 `AudioCard.vue` - 音频卡片组件
- [ ] 创建 `FileCard.vue` - 文件卡片组件
- [ ] 创建 `ImageToolbar.vue` - 工具栏组件

### 3.3 Composables

**文件结构**：
```
packages/web/src/pages/images/composables/
├── useImageList.ts         # 列表逻辑
├── useImageUpload.ts       # 上传逻辑
├── useImageOperations.ts   # 操作逻辑
└── useImageFilters.ts      # 筛选排序逻辑
```

**任务**：
- [ ] `useImageList.ts` - 列表加载、分页
- [ ] `useImageUpload.ts` - 文件上传、进度
- [ ] `useImageOperations.ts` - 删除、收藏、编辑
- [ ] `useImageFilters.ts` - 搜索、排序、筛选

### 3.4 样式文件

**文件**：`packages/web/src/pages/images/ImagesPage.vue` (scoped styles)

**任务**：
- [ ] 复制 `admin-imgtc.css` 的样式
- [ ] 适配 Riku-Hub 的主题色
- [ ] 调整响应式布局
- [ ] 优化移动端样式

**样式要点**：
```css
/* 保留原有的渐变背景 */
.images-page {
  background: linear-gradient(90deg, #ffd7e4 0%, #c8f1ff 100%);
}

/* 保留毛玻璃效果 */
.images-header {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.75);
}

/* 保留网格布局 */
.images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}
```

---

## 阶段四：路由和导航（第 3 天）

### 4.1 路由配置

**文件**：`packages/web/src/router/index.ts`

**任务**：
- [ ] 添加 `/images` 路由
- [ ] 配置路由守卫（需要登录）

**配置**：
```typescript
{
  path: '/images',
  name: 'images',
  component: () => import('../pages/images/ImagesPage.vue'),
  meta: { requiresAuth: true }
}
```

### 4.2 侧边栏导航

**文件**：`packages/web/src/components/layout/MainSidebar.vue`

**任务**：
- [ ] 添加"图床"导航项
- [ ] 添加图标（carbon:image）
- [ ] 配置路由链接

**导航项**：
```vue
<router-link to="/images" class="nav-item">
  <Icon icon="carbon:image" />
  <span>图床</span>
</router-link>
```

---

## 阶段五：功能实现（第 3-4 天）

### 5.1 核心功能

**任务清单**：
- [ ] 文件上传（单文件）
- [ ] 文件上传（批量，最多 3 个并发）
- [ ] 文件列表展示
- [ ] 文件预览（图片/视频/音频）
- [ ] 文件删除
- [ ] 文件收藏/取消收藏
- [ ] 文件名编辑
- [ ] 复制文件链接

### 5.2 筛选和排序

**任务清单**：
- [ ] 搜索功能（按文件名）
- [ ] 文件类型切换（图片/视频/音频/文件）
- [ ] 排序（时间倒序/名称升序/大小倒序）
- [ ] 筛选（全部/收藏/黑名单/白名单/NSFW）

### 5.3 批量操作

**任务清单**：
- [ ] 批量选择（复选框）
- [ ] 全选当前页
- [ ] 批量复制链接
- [ ] 批量删除
- [ ] 批量下载
- [ ] 批量加入黑名单
- [ ] 批量加入白名单

### 5.4 工具箱功能

**任务清单**：
- [ ] 检测失效文件
- [ ] 快捷方式管理
- [ ] 快捷网站跳转

---

## 阶段六：测试和优化（第 4-5 天）

### 6.1 功能测试

**测试清单**：
- [ ] 上传功能（单文件/批量）
- [ ] 文件类型识别
- [ ] 列表加载和分页
- [ ] 搜索和筛选
- [ ] 排序功能
- [ ] 单文件操作（删除/收藏/编辑）
- [ ] 批量操作
- [ ] 文件预览
- [ ] 响应式布局

### 6.2 性能优化

**优化清单**：
- [ ] 图片懒加载
- [ ] 虚拟滚动（如果文件数量大）
- [ ] 上传进度显示
- [ ] 加载状态优化
- [ ] 错误处理优化

### 6.3 样式调整

**调整清单**：
- [ ] 统一主题色
- [ ] 移动端适配
- [ ] 动画效果
- [ ] 加载骨架屏
- [ ] 空状态提示

---

## 阶段七：文档和部署（第 5 天）

### 7.1 文档更新

**文件**：
- [ ] `README.md` - 添加图床功能说明
- [ ] `docs/FEATURES.md` - 功能文档
- [ ] `docs/API.md` - API 文档

### 7.2 环境配置

**任务**：
- [ ] 配置 Telegram Bot
- [ ] 获取 Bot Token
- [ ] 设置 Chat ID
- [ ] 更新 wrangler.toml

### 7.3 部署测试

**任务**：
- [ ] 本地测试
- [ ] 运行单元测试
- [ ] 部署到测试环境
- [ ] 功能验收

---

## 文件清单

### 后端文件（7 个）

1. `migrations/0002_images.sql` - 数据库迁移
2. `packages/worker/src/services/telegram-service.ts` - Telegram 服务
3. `packages/worker/src/repositories/images-repository.ts` - 数据仓库
4. `packages/worker/src/routes/images.ts` - API 路由
5. `packages/shared/src/types/images.ts` - 类型定义
6. `packages/worker/src/index.ts` - 路由注册（修改）
7. `wrangler.toml` - 环境变量（修改）

### 前端文件（10+ 个）

1. `packages/web/src/pages/images/ImagesPage.vue` - 主页面
2. `packages/web/src/pages/images/components/ImageCard.vue` - 图片卡片
3. `packages/web/src/pages/images/components/VideoCard.vue` - 视频卡片
4. `packages/web/src/pages/images/components/AudioCard.vue` - 音频卡片
5. `packages/web/src/pages/images/components/FileCard.vue` - 文件卡片
6. `packages/web/src/pages/images/components/ImageToolbar.vue` - 工具栏
7. `packages/web/src/pages/images/composables/useImageList.ts` - 列表逻辑
8. `packages/web/src/pages/images/composables/useImageUpload.ts` - 上传逻辑
9. `packages/web/src/pages/images/composables/useImageOperations.ts` - 操作逻辑
10. `packages/web/src/pages/images/composables/useImageFilters.ts` - 筛选逻辑
11. `packages/web/src/api/images.ts` - API 客户端
12. `packages/web/src/router/index.ts` - 路由配置（修改）
13. `packages/web/src/components/layout/MainSidebar.vue` - 侧边栏（修改）

---

## 时间估算

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 阶段一 | 数据库和后端基础 | 1 天 |
| 阶段二 | 前端 API 层 | 0.5 天 |
| 阶段三 | 前端页面开发 | 1.5 天 |
| 阶段四 | 路由和导航 | 0.5 天 |
| 阶段五 | 功能实现 | 1 天 |
| 阶段六 | 测试和优化 | 0.5 天 |
| 阶段七 | 文档和部署 | 0.5 天 |
| **总计** | | **5.5 天** |

---

## 风险和注意事项

### 技术风险

1. **Telegram API 限制**
   - 文件大小：最大 20MB
   - 速率限制：需要控制并发
   - 解决方案：前端限制 + 队列上传

2. **文件类型识别**
   - 依赖文件扩展名
   - 可能不准确
   - 解决方案：支持手动修改类型

3. **性能问题**
   - 大量文件渲染
   - 解决方案：分页 + 懒加载

### 功能风险

1. **与 Snippets 功能重叠**
   - 两个地方都能管理图片
   - 解决方案：明确定位，Snippets 用于快速剪贴，Images 用于专业管理

2. **用户数据隔离**
   - 必须确保用户只能看到自己的文件
   - 解决方案：所有查询都加 user_id 过滤

---

## 下一步行动

**立即开始**：
1. ✅ 创建执行计划（当前文档）
2. ⏭️ 创建数据库迁移文件
3. ⏭️ 实现 Telegram 服务层
4. ⏭️ 实现 Images Repository
5. ⏭️ 实现 API 路由

**今天完成**：
- 阶段一：数据库和后端基础
- 阶段二：前端 API 层

**明天完成**：
- 阶段三：前端页面开发
- 阶段四：路由和导航

**后天完成**：
- 阶段五：功能实现
- 阶段六：测试和优化
- 阶段七：文档和部署

---

## 成功标准

- [ ] 用户可以通过侧边栏进入图床页面
- [ ] 用户可以上传图片/视频/音频/文件
- [ ] 用户可以查看、搜索、筛选、排序文件
- [ ] 用户可以执行单文件操作（删除/收藏/编辑/复制）
- [ ] 用户可以执行批量操作
- [ ] 页面响应式，移动端可用
- [ ] 所有测试通过
- [ ] 文档完整

---

**准备开始实施！** 🚀
