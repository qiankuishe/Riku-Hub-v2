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
    }

    .el-button--primary {
      background-color: #000000;
      border-color: #000000;
    }

    .el-button--primary:hover {
      background-color: #1a1a1a;
      border-color: #1a1a1a;
    }

    .el-button--primary:active {
      background-color: #333333;
      border-color: #333333;
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

export function mountLauncherPage() {
  window.location.replace(resolveAppRoute(null));
}
