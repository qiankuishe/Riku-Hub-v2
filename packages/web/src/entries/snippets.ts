import { mountProtectedPage } from '../composables/usePageMount';
import SnippetsPage from '../pages/snippets/SnippetsPage.vue';

void mountProtectedPage({
  component: SnippetsPage,
  currentPath: '/snippets',
  title: '剪贴板'
});
