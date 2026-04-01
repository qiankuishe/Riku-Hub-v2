# 移动端优化说明

## 优化时间
2026-04-01

## 主要问题
1. 手机端右侧内容溢出屏幕
2. 侧边栏从右侧滑出（需要改为左侧）
3. 部分固定宽度元素导致布局问题

## 已完成的优化

### 1. 全局防溢出
- 添加 `overflow-x: hidden` 到 html, body
- 设置 `max-width: 100vw` 防止容器超出视口
- 所有元素添加 `box-sizing: border-box`

### 2. 侧边栏优化
**改动位置**: `packages/web/src/styles/index.css`

- ✅ 侧边栏从**左侧**滑出（原来是右侧）
- ✅ 添加滑入动画 `translateX(-100%)` → `translateX(0)`
- ✅ 宽度限制为 `min(320px, 85vw)` 避免占满屏幕
- ✅ 边框改为右边框

```css
.mobile-drawer-backdrop {
  justify-items: start; /* 从左侧显示 */
}

.mobile-drawer {
  width: min(320px, 85vw);
  border-right: 1px solid var(--rk-border);
}
```

### 3. 响应式布局优化

#### 中等屏幕 (max-width: 980px)
- 主容器宽度 100%，移除左侧边距
- 内边距调整为 12px
- 工具栏按钮支持换行
- 对话框宽度 90%
- 表格支持横向滚动

#### 小屏幕 (max-width: 640px)
- 内边距缩小为 10px
- 顶栏改为垂直布局
- 网格布局强制单列
- 对话框宽度 95%
- 移动端抽屉宽度 `min(280px, 80vw)`
- 固定宽度元素强制 100% 宽度

#### 超小屏幕 (max-width: 480px)
- 内边距缩小为 8px
- 对话框宽度 98%
- 移动端抽屉宽度 `min(260px, 85vw)`
- 标题字体进一步缩小

### 4. Element Plus 组件优化
- 表单元素宽度 100%
- 按钮组支持换行
- 对话框内容区域可滚动
- 表格支持横向滚动
- 输入框防止 iOS 自动缩放（font-size: 16px）

### 5. 特殊元素处理
- 图片自动响应式 `max-width: 100%`
- 代码块支持横向滚动
- 固定宽度的内联样式强制覆盖为 100%

## 测试建议

### 桌面端测试
- [ ] 侧边栏正常显示（宽度 260px）
- [ ] 主内容区域居中（max-width: 1360px）
- [ ] 所有功能正常工作

### 平板测试 (768px - 980px)
- [ ] 侧边栏隐藏，显示菜单按钮
- [ ] 点击菜单按钮，侧边栏从左侧滑出
- [ ] 内容区域占满宽度
- [ ] 对话框宽度适中

### 手机测试 (< 640px)
- [ ] 无横向滚动条
- [ ] 所有内容在屏幕内可见
- [ ] 侧边栏从左侧滑出
- [ ] 按钮和表单元素大小合适
- [ ] 对话框接近全屏

### 超小屏幕测试 (< 480px)
- [ ] 布局紧凑但可用
- [ ] 文字大小可读
- [ ] 按钮可点击

## 关键文件

- `packages/web/src/styles/index.css` - 主要样式文件
- `packages/web/src/components/layout/SectionShell.vue` - 布局组件
- `packages/web/src/components/layout/MobileNavDrawer.vue` - 移动端抽屉

## 后续优化建议

1. **图片懒加载**: 图床页面大量图片时优化性能
2. **虚拟滚动**: 长列表性能优化
3. **触摸手势**: 添加左滑返回等手势
4. **底部导航**: 考虑添加底部导航栏（更符合移动端习惯）
5. **PWA 支持**: 添加 manifest.json 和 service worker

## 注意事项

- 所有优化都在 `@media` 查询内，不影响桌面端
- 使用 `!important` 的地方都是为了覆盖 Element Plus 默认样式
- 侧边栏动画使用 `cubic-bezier(0.4, 0, 0.2, 1)` 提供流畅体验
