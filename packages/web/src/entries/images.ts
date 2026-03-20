import { mountProtectedPage } from '../composables/usePageMount';
import ImagesPage from '../pages/images/ImagesPage.vue';

void mountProtectedPage({
  component: ImagesPage,
  currentPath: '/images',
  title: '图床'
});
