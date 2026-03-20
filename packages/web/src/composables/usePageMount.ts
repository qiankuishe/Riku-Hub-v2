import { createApp, defineComponent, h, type Component } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import SectionShell from '../components/layout/SectionShell.vue';
import { getCurrentFullPath } from '../utils/pageConfig';
import { buildLoginRedirectUrl, rememberAppRoute, resolveAppRoute } from '../utils/routeMemory';
import { authApi } from '../api';
import 'virtual:uno.css';
import 'element-plus/dist/index.css';
import '../styles/index.css';

const ELEMENT_THEME_STYLE_ID = 'rk-element-theme-override';

function ensureElementThemeStyles() {
  if (document.getElementById(ELEMENT_THEME_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = ELEMENT_THEME_STYLE_ID;
  style.textContent = `
    :root {
      /* 主色调 */
      --el-color-primary: #000000;
      --el-color-primary-light-3: #4d4d4d;
      --el-color-primary-light-5: #808080;
      --el-color-primary-light-7: #b3b3b3;
      --el-color-primary-light-8: #cccccc;
      --el-color-primary-light-9: #e6e6e6;
      --el-color-primary-dark-2: #000000;
      --el-color-danger: #ef4444;
      --el-color-success: #10b981;
      --el-color-warning: #f59e0b;
      --el-color-info: #6b7280;
      
      /* 统一尺寸 - 让所有组件默认更大 */
      --el-component-size: 40px;
      --el-component-size-large: 48px;
      --el-component-size-small: 36px;
      
      /* 统一圆角 */
      --el-border-radius-base: 10px;
      --el-border-radius-small: 8px;
      --el-border-radius-round: 20px;
      
      /* 统一字体大小 */
      --el-font-size-base: 15px;
      --el-font-size-medium: 14px;
      --el-font-size-small: 13px;
      --el-font-size-large: 16px;
      
      /* 统一间距 */
      --el-input-height: 40px;
    }

    /* 按钮统一样式 */
    .el-button {
      height: 40px;
      padding: 0 20px;
      font-size: 15px;
      font-weight: 500;
      border-radius: 10px;
      transition: all 0.2s ease;
    }
    
    .el-button--large {
      height: 48px;
      padding: 0 24px;
      font-size: 16px;
    }
    
    .el-button--small {
      height: 36px;
      padding: 0 16px;
      font-size: 14px;
    }
    
    /* 圆形按钮保持正圆 */
    .el-button.is-circle {
      width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 50%;
    }
    
    .el-button--large.is-circle {
      width: 48px;
      height: 48px;
    }
    
    .el-button--small.is-circle {
      width: 36px;
      height: 36px;
    }
    
    .el-button--default {
      background-color: #ffffff;
      border-color: #d2d2d7;
      color: #1d1d1f;
    }
    
    .el-button--default:hover {
      background-color: #f5f5f7;
      border-color: #b3b3b8;
    }

    .el-button--primary {
      background-color: #000000;
      border-color: #000000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .el-button--primary:hover {
      background-color: #1a1a1a;
      border-color: #1a1a1a;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transform: translateY(-1px);
    }

    .el-button--primary:active {
      background-color: #333333;
      border-color: #333333;
      transform: translateY(0);
    }
    
    .el-button--danger {
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.15);
    }
    
    .el-button--danger:hover {
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
      transform: translateY(-1px);
    }
    
    /* 输入框统一样式 */
    .el-input__wrapper {
      height: 40px;
      border-radius: 10px;
      padding: 0 16px;
      box-shadow: 0 0 0 1px #d2d2d7 inset;
      transition: all 0.2s ease;
    }
    
    .el-input__wrapper:hover {
      box-shadow: 0 0 0 1px #b3b3b8 inset;
    }
    
    .el-input__wrapper.is-focus {
      box-shadow: 0 0 0 2px #000000 inset;
    }
    
    .el-input__inner {
      font-size: 15px;
      height: 38px;
    }
    
    .el-input--large .el-input__wrapper {
      height: 48px;
      padding: 0 20px;
    }
    
    .el-input--large .el-input__inner {
      height: 46px;
      font-size: 16px;
    }
    
    .el-input--small .el-input__wrapper {
      height: 36px;
      padding: 0 12px;
    }
    
    .el-input--small .el-input__inner {
      height: 34px;
      font-size: 14px;
    }
    
    /* 下拉菜单统一样式 */
    .el-dropdown-menu {
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
      border: 1px solid #e5e7eb;
    }
    
    .el-dropdown-menu__item {
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 14px;
      margin: 2px 0;
    }
    
    .el-dropdown-menu__item:hover {
      background-color: #f5f5f7;
    }
    
    /* 对话框统一样式 */
    .el-dialog {
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }
    
    .el-dialog__header {
      padding: 24px 24px 16px;
    }
    
    .el-dialog__title {
      font-size: 18px;
      font-weight: 600;
    }
    
    .el-dialog__body {
      padding: 16px 24px 24px;
    }
    
    /* 分页器统一样式 */
    .el-pagination {
      gap: 8px;
    }
    
    .el-pagination button,
    .el-pager li {
      min-width: 36px;
      height: 36px;
      border-radius: 8px;
      font-size: 14px;
    }
    
    /* 标签统一样式 */
    .el-tag {
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 13px;
      font-weight: 500;
    }
    
    /* 选择器统一样式 */
    .el-select .el-input__wrapper {
      cursor: pointer;
    }
    
    .el-select-dropdown {
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
      border: 1px solid #e5e7eb;
    }
    
    .el-select-dropdown__item {
      padding: 10px 16px;
      font-size: 14px;
    }
    
    /* 表单项统一样式 */
    .el-form-item__label {
      font-size: 14px;
      font-weight: 500;
      color: #1d1d1f;
    }
    
    /* 文本域统一样式 */
    .el-textarea__inner {
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 15px;
      border: 1px solid #d2d2d7;
      transition: all 0.2s ease;
    }
    
    .el-textarea__inner:hover {
      border-color: #b3b3b8;
    }
    
    .el-textarea__inner:focus {
      border-color: #000000;
      border-width: 2px;
      padding: 11px 15px;
    }
    
    /* 消息提示统一样式 */
    .el-message {
      border-radius: 12px;
      padding: 14px 20px;
      font-size: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
    }
    
    /* 警告框统一样式 */
    .el-alert {
      border-radius: 10px;
      padding: 14px 16px;
    }
  `;
  document.head.appendChild(style);
}

export interface ProtectedPageOptions {
  component: Component;
  currentPath: string;
  title: string;
  subtitle?: string;
}

function mount(component: Component) {
  ensureElementThemeStyles();
  const app = createApp(component);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);
  app.use(pinia);
  app.mount('#app');
}

export async function mountProtectedPage(options: ProtectedPageOptions) {
  const currentRoute = getCurrentFullPath();
  rememberAppRoute(currentRoute);

  try {
    const { authenticated } = await authApi.check();
    if (!authenticated) {
      window.location.replace(buildLoginRedirectUrl(currentRoute));
      return;
    }
  } catch {
    window.location.replace(buildLoginRedirectUrl(currentRoute));
    return;
  }

  const Root = defineComponent({
    name: `${options.title}RebuildRoot`,
    setup() {
      return () =>
        h(
          SectionShell,
          {
            currentPath: options.currentPath,
            title: options.title,
            subtitle: options.subtitle ?? ''
          },
          {
            default: () => h(options.component)
          }
        );
    }
  });

  mount(Root);
}

export async function mountLoginPage(component: Component) {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  try {
    const { authenticated } = await authApi.check();
    if (authenticated) {
      window.location.replace(resolveAppRoute(redirect));
      return;
    }
  } catch {
    // noop
  }
  mount(component);
}

export function mountHomePage(component: Component) {
  mount(component);
}

export function mountLauncherPage() {
  window.location.replace(resolveAppRoute(null));
}
