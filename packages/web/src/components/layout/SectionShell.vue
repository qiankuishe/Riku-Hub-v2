<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import AppTopbar from './AppTopbar.vue';
import MainSidebar from './MainSidebar.vue';
import MobileNavDrawer from './MobileNavDrawer.vue';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { getCurrentFullPath, getCurrentSearchParams, isAppRoutePath } from '../../utils/pageConfig';
import { readAppRouteScroll, rememberAppRouteScroll } from '../../utils/routeMemory';

const props = defineProps<{
  currentPath: string;
  title: string;
  subtitle?: string;
}>();

const uiStore = useUiStore();
const secondaryTitle = computed(() => uiStore.secondaryNavTitle || props.title);
const RESTORE_SCROLL_WINDOW_MS = 5000;
let scrollFrame = 0;
let restoreRunId = 0;
let initialHistoryScrollRestoration: History['scrollRestoration'] | null = null;

function shouldRestoreScrollPosition(path = getCurrentFullPath()) {
  const searchParams = getCurrentSearchParams();
  return isAppRoutePath(path) && !window.location.hash && !searchParams.get('focus');
}

function persistRouteScroll(path = getCurrentFullPath()) {
  if (!isAppRoutePath(path)) {
    return;
  }

  rememberAppRouteScroll(path, window.scrollY);
}

function handleWindowScroll() {
  if (scrollFrame) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0;
    persistRouteScroll();
  });
}

function handlePageHide() {
  persistRouteScroll();
}

function handlePageShow() {
  void restoreRouteScroll();
}

async function restoreRouteScroll(path = getCurrentFullPath()) {
  if (!isAppRoutePath(path)) {
    return;
  }

  const targetTop = readAppRouteScroll(path);
  if (targetTop <= 0 || !shouldRestoreScrollPosition(path)) {
    return;
  }

  const runId = ++restoreRunId;
  await nextTick();

  const startedAt = Date.now();
  const apply = () => {
    if (runId !== restoreRunId) {
      return;
    }

    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    const nextTop = Math.min(targetTop, maxTop);
    if (Math.abs(window.scrollY - nextTop) > 2) {
      window.scrollTo(0, nextTop);
    }

    const hasEnoughHeight = maxTop >= targetTop - 2;
    const restored = Math.abs(window.scrollY - nextTop) <= 2;
    if ((hasEnoughHeight && restored) || Date.now() - startedAt >= RESTORE_SCROLL_WINDOW_MS) {
      return;
    }

    window.setTimeout(apply, hasEnoughHeight ? 220 : 120);
  };

  apply();
}

function syncExpandedSection() {
  if (uiStore.secondaryNavItems.length) {
    uiStore.expandSidebarSection(props.currentPath);
    return;
  }

  if (uiStore.expandedSidebarSection === props.currentPath) {
    uiStore.expandSidebarSection('');
  }
}

function navigateTo(path: string, replace = false) {
  if (replace) {
    window.location.replace(path);
    return;
  }

  window.location.assign(path);
}

function handleSecondarySelect(item: SecondaryNavItem) {
  uiStore.closeMobileNav();
  if (item.to) {
    navigateTo(item.to);
    return;
  }

  if (item.targetId) {
    uiStore.setSecondaryNavActive(item.key);
    document.getElementById(item.targetId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

watch(
  () => [props.currentPath, uiStore.secondaryNavItems.length],
  () => {
    syncExpandedSection();
  },
  { immediate: true }
);

onMounted(() => {
  if ('scrollRestoration' in window.history) {
    initialHistoryScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  window.addEventListener('scroll', handleWindowScroll, { passive: true });
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  syncExpandedSection();
  void restoreRouteScroll();
});

onUnmounted(() => {
  persistRouteScroll();
  window.removeEventListener('scroll', handleWindowScroll);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  if (scrollFrame) {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  restoreRunId += 1;
  if (initialHistoryScrollRestoration) {
    window.history.scrollRestoration = initialHistoryScrollRestoration;
  }
});
</script>

<template>
  <div class="app-shell">
    <transition name="toast-fade">
      <div v-if="uiStore.toastMessage" class="top-toast">
        {{ uiStore.toastMessage }}
      </div>
    </transition>

    <MainSidebar
      class="desktop-only"
      :current-path="currentPath"
      :secondary-items="uiStore.secondaryNavItems"
      :secondary-active-key="uiStore.secondaryNavActiveKey"
      @select-secondary="handleSecondarySelect"
    />

    <div class="app-shell-main">
      <div class="app-shell-main-inner">
        <AppTopbar :title="title" :subtitle="subtitle ?? ''" @menu="uiStore.openMobileNav" />

        <main class="page-content">
          <slot />
        </main>
      </div>
    </div>

    <MobileNavDrawer
      :open="uiStore.mobileNavOpen"
      :current-path="currentPath"
      :secondary-title="secondaryTitle"
      :secondary-items="uiStore.secondaryNavItems"
      :secondary-active-key="uiStore.secondaryNavActiveKey"
      @close="uiStore.closeMobileNav"
      @select-secondary="handleSecondarySelect"
    />
  </div>
</template>
