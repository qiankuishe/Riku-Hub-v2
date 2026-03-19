import { mountProtectedPage } from '../composables/usePageMount';
import LogsPage from '../pages/logs/LogsPage.vue';

void mountProtectedPage({
  component: LogsPage,
  currentPath: '/logs',
  title: '运行日志'
});
