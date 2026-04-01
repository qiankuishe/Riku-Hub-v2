<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AppTopbar from './AppTopbar.vue';
import MainSidebar from './MainSidebar.vue';
import MobileNavDrawer from './MobileNavDrawer.vue';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { getCurrentFullPath, getCurrentSearchParams, isAppRoutePath } from '../../utils/pageConfig';
import {
  readAppRouteContainerScroll,
  readAppRouteScroll,
  rememberAppRouteContainerScroll,
  rememberAppRouteScroll
} from '../../utils/routeMemory';

const props = defineProps<{
  currentPath: string;
  title: string;
  subtitle?: string;
}>();

const uiStore = useUiStore();
const secondaryTitle = computed(() => uiStore.secondaryNavTitle || props.title);
const RESTORE_SCROLL_WINDOW_MS = 5000;
const APP_MAIN_SCROLL_KEY = 'app-main';
const PAGE_CONTENT_SCROLL_KEY = 'page-content';
let scrollFrame = 0;
let containerScrollFrame = 0;
let restoreRunId = 0;
let initialHistoryScrollRestoration: History['scrollRestoration'] | null = null;
const appMainRef = ref<HTMLElement | null>(null);
const pageContentRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);
const BACK_TO_TOP_THRESHOLD = 300;

function setAppMainRef(element: unknown) {
  appMainRef.value = element instanceof HTMLElement ? element : null;
}

function setPageContentRef(element: unknown) {
  pageContentRef.value = element instanceof HTMLElement ? element : null;
}

function shouldRestoreScrollPosition(path = getCurrentFullPath()) {
  const searchParams = getCurrentSearchParams();
  return isAppRoutePath(path) && !window.location.hash && !searchParams.get('focus');
}

function persistRouteScroll(path = getCurrentFullPath()) {
  if (!isAppRoutePath(path)) {
    return;
  }

  rememberAppRouteScroll(path, window.scrollY);
  if (appMainRef.value) {
    rememberAppRouteContainerScroll(path, APP_MAIN_SCROLL_KEY, appMainRef.value.scrollTop);
  }
  if (pageContentRef.value) {
    rememberAppRouteContainerScroll(path, PAGE_CONTENT_SCROLL_KEY, pageContentRef.value.scrollTop);
  }
}

function handleWindowScroll() {
  if (scrollFrame) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0;
    persistRouteScroll();
    // 更新返回顶部按钮显示状态
    showBackToTop.value = window.scrollY > BACK_TO_TOP_THRESHOLD;
  });
}

function handleContainerScroll() {
  if (containerScrollFrame) {
    return;
  }

  containerScrollFrame = window.requestAnimationFrame(() => {
    containerScrollFrame = 0;
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

  const windowTargetTop = readAppRouteScroll(path);
  const appMainTargetTop = readAppRouteContainerScroll(path, APP_MAIN_SCROLL_KEY);
  const pageContentTargetTop = readAppRouteContainerScroll(path, PAGE_CONTENT_SCROLL_KEY);
  if (
    !shouldRestoreScrollPosition(path) ||
    (windowTargetTop <= 0 && appMainTargetTop <= 0 && pageContentTargetTop <= 0)
  ) {
    return;
  }

  const runId = ++restoreRunId;
  await nextTick();

  const startedAt = Date.now();
  const apply = () => {
    if (runId !== restoreRunId) {
      return;
    }

    const windowState = applyWindowScroll(windowTargetTop);
    const appMainState = applyElementScroll(appMainRef.value, appMainTargetTop);
    const pageContentState = applyElementScroll(pageContentRef.value, pageContentTargetTop);

    const allDone =
      windowState.restored &&
      appMainState.restored &&
      pageContentState.restored &&
      (windowState.hasEnoughHeight || windowTargetTop <= 0) &&
      (appMainState.hasEnoughHeight || appMainTargetTop <= 0) &&
      (pageContentState.hasEnoughHeight || pageContentTargetTop <= 0);

    const pendingByHeight =
      (windowTargetTop > 0 && !windowState.hasEnoughHeight) ||
      (appMainTargetTop > 0 && !appMainState.hasEnoughHeight) ||
      (pageContentTargetTop > 0 && !pageContentState.hasEnoughHeight);

    if (allDone || Date.now() - startedAt >= RESTORE_SCROLL_WINDOW_MS) {
      return;
    }

    window.setTimeout(apply, pendingByHeight ? 120 : 220);
  };

  apply();
}

function applyWindowScroll(targetTop: number): { restored: boolean; hasEnoughHeight: boolean } {
  if (targetTop <= 0) {
    return { restored: true, hasEnoughHeight: true };
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
  const nextTop = Math.min(targetTop, maxTop);
  if (Math.abs(window.scrollY - nextTop) > 2) {
    window.scrollTo(0, nextTop);
  }

  return {
    restored: Math.abs(window.scrollY - nextTop) <= 2,
    hasEnoughHeight: maxTop >= targetTop - 2
  };
}

function applyElementScroll(
  element: HTMLElement | null,
  targetTop: number
): { restored: boolean; hasEnoughHeight: boolean } {
  if (!element || targetTop <= 0) {
    return { restored: true, hasEnoughHeight: true };
  }

  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const nextTop = Math.min(targetTop, maxTop);
  if (Math.abs(element.scrollTop - nextTop) > 2) {
    element.scrollTop = nextTop;
  }

  return {
    restored: Math.abs(element.scrollTop - nextTop) <= 2,
    hasEnoughHeight: maxTop >= targetTop - 2
  };
}

function syncExpandedSection() {
  // 默认折叠，不自动展开二级菜单
  // 用户需要手动点击才能展开
  
  // 如果当前展开的不是当前页面，则收起
  if (uiStore.expandedSidebarSection && !props.currentPath.startsWith(uiStore.expandedSidebarSection)) {
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

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

watch(
  () => props.currentPath,  // 只监听路径变化，不监听 secondaryNavItems
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
  appMainRef.value?.addEventListener('scroll', handleContainerScroll, { passive: true });
  pageContentRef.value?.addEventListener('scroll', handleContainerScroll, { passive: true });
  syncExpandedSection();
  void restoreRouteScroll();
});

onUnmounted(() => {
  persistRouteScroll();
  window.removeEventListener('scroll', handleWindowScroll);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  appMainRef.value?.removeEventListener('scroll', handleContainerScroll);
  pageContentRef.value?.removeEventListener('scroll', handleContainerScroll);
  if (scrollFrame) {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  if (containerScrollFrame) {
    window.cancelAnimationFrame(containerScrollFrame);
    containerScrollFrame = 0;
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

    <div :ref="setAppMainRef" class="app-shell-main">
      <div class="app-shell-main-inner">
        <AppTopbar :title="title" :subtitle="subtitle ?? ''" />

        <main :ref="setPageContentRef" class="page-content">
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

    <!-- 返回顶部按钮 -->
    <transition name="fade">
      <button
        v-if="showBackToTop"
        type="button"
        class="back-to-top-btn"
        @click="scrollToTop"
        aria-label="返回顶部"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </transition>
  </div>
</template>
