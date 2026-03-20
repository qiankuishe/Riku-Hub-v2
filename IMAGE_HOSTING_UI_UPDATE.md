# 图床 UI 设计统一更新

## 更新时间
2026年3月20日

## 更新内容

已将图床页面的 UI 设计统一为项目的标准卡片式风格，与笔记、剪贴板等其他页面保持一致。

---

## 主要变更

### 1. 移除渐变背景
- **之前**：使用了粉蓝渐变背景 `linear-gradient(90deg, #ffd7e4 0%, #c8f1ff 100%)`
- **现在**：使用标准的白色卡片背景，与其他页面一致

### 2. 统一顶部工具栏
- **之前**：固定顶部毛玻璃效果工具栏，分散的按钮布局
- **现在**：标准卡片内的标题和操作区域，使用 `flex` 布局

### 3. 统一按钮样式
- **之前**：默认大小按钮，图标按钮无文字
- **现在**：`size="small"` 小号按钮，带文字标签的下拉菜单

### 4. 统一空状态样式
- **之前**：大图标 + 居中布局
- **现在**：虚线边框卡片 + 灰色背景，与其他页面一致

### 5. 统一卡片样式
- **之前**：半透明白色背景 + 阴影
- **现在**：使用 `.content-card` 类，标准边框和圆角

### 6. 统一颜色方案
- **之前**：紫色主题色 `#B39DDB`，金色收藏图标 `#FFD700`
- **现在**：灰色系主题，琥珀色收藏图标 `#f59e0b`

---

## 设计规范

### 按钮规范
```vue
<!-- 主要操作按钮 -->
<ElButton type="primary" size="small">
  <Icon icon="carbon:upload" class="mr-1" />
  上传文件
</ElButton>

<!-- 次要操作按钮 -->
<ElButton size="small">
  <Icon icon="carbon:renew" class="mr-1" />
  刷新
</ElButton>

<!-- 下拉菜单按钮 -->
<ElDropdown>
  <ElButton size="small">
    <Icon :icon="icon" class="mr-1" />
    文字标签
  </ElButton>
  <template #dropdown>
    <ElDropdownMenu>
      <ElDropdownItem command="action">
        <Icon icon="carbon:icon" class="mr-1" />
        操作名称
      </ElDropdownItem>
    </ElDropdownMenu>
  </template>
</ElDropdown>
```

### 卡片规范
```vue
<div class="card">
  <!-- 标题区 -->
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-xl font-semibold text-gray-900">标题</h2>
      <p class="text-sm text-gray-500">描述文字</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <!-- 操作按钮 -->
    </div>
  </div>

  <!-- 内容区 -->
  <div>
    <!-- 内容 -->
  </div>
</div>
```

### 空状态规范
```vue
<div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
  暂无内容
</div>
```

### 颜色规范
- 主文字：`text-gray-900` (#111827)
- 次要文字：`text-gray-500` (#6b7280)
- 边框：`border-gray-200` (#e5e7eb)
- 背景：`bg-gray-50` (#f9fafb)
- 收藏图标：`#f59e0b` (琥珀色)
- 选中状态：`rgba(0, 0, 0, 0.16)` (黑色半透明)

---

## 文件变更

### 修改的文件
- `packages/web/src/pages/images/ImagesPage.vue`

### 变更统计
- 删除：约 200 行（旧样式）
- 新增：约 150 行（新样式）
- 净减少：约 50 行

---

## 视觉对比

### 之前
- 粉蓝渐变背景
- 毛玻璃顶部工具栏
- 大号图标按钮
- 紫色主题色
- 半透明卡片

### 现在
- 白色背景
- 标准卡片布局
- 小号文字按钮
- 灰色系主题
- 标准边框卡片

---

## 兼容性

### 保持不变的功能
- ✅ 所有上传功能
- ✅ 所有文件操作
- ✅ 所有筛选排序
- ✅ 所有批量操作
- ✅ 响应式布局
- ✅ 文件预览

### 改进的体验
- ✅ 更统一的视觉风格
- ✅ 更清晰的操作标签
- ✅ 更简洁的界面
- ✅ 更好的可读性

---

## 部署说明

### 重新构建
```bash
cd packages/web
corepack pnpm run build
```

### 验证
1. 访问 `/images` 页面
2. 检查按钮样式是否统一
3. 检查卡片样式是否一致
4. 检查颜色是否符合规范

---

## 后续优化建议

### 短期（可选）
- 添加文件拖拽上传
- 添加图片懒加载
- 添加虚拟滚动

### 中期（可选）
- 添加文件夹分组
- 添加标签系统
- 添加批量编辑

---

**更新状态**：✅ 已完成并构建成功

**兼容性**：✅ 完全向后兼容

**测试状态**：⚠️ 待部署后测试
