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

export interface ProtectedPageOptions {
  component: Component;
  currentPath: string;
  title: string;
  subtitle?: string;
}

function mount(component: Component) {
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
