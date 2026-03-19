import { mountProtectedPage } from '../composables/usePageMount';
import NavigationPage from '../pages/navigation/NavigationPage.vue';

void mountProtectedPage({
  component: NavigationPage,
  currentPath: '/nav',
  title: '网站导航'
});
