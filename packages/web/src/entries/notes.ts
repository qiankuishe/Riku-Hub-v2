import { mountProtectedPage } from '../composables/usePageMount';
import NotesPage from '../pages/notes/NotesPage.vue';

void mountProtectedPage({
  component: NotesPage,
  currentPath: '/riku/notes',
  title: '笔记'
});
