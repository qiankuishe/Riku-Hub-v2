import { mountProtectedPage } from '../composables/usePageMount';
import SettingsPage from '../pages/settings/SettingsPage.vue';

void mountProtectedPage({
  component: SettingsPage,
  currentPath: '/riku/settings',
  title: '系统设置'
});
