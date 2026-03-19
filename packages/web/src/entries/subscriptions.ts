import { mountProtectedPage } from '../composables/usePageMount';
import SubscriptionsPage from '../pages/subscriptions/SubscriptionsPage.vue';

void mountProtectedPage({
  component: SubscriptionsPage,
  currentPath: '/subscriptions',
  title: '订阅聚合'
});
