<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ElButton } from 'element-plus';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { restartCurrentSection } from '../../utils/localCacheReset';
import { APP_NAV_ITEMS, APP_REPO_URL, APP_VERSION } from './nav';

const uiStore = useUiStore();

const props = defineProps<{
  open: boolean;
  currentPath: string;
  secondaryTitle: string;
  secondaryItems: SecondaryNavItem[];
  secondaryActiveKey: string;
}>();

const emit = defineEmits<{
  close: [];
  selectSecondary: [item: SecondaryNavItem];
}>();

const groupRefs = ref<Record<string, HTMLElement | null>>({});
const navRef = ref<HTMLElement | null>(null);

function isCurrent(itemTo: string) {
  return props.currentPath.startsWith(itemTo);
}

function setGroupRef(itemTo: string, element: unknown) {
  groupRefs.value[itemTo] = element instanceof HTMLElement ? element : null;
}

function setNavRef(element: unknown) {
  navRef.value = element instanceof HTMLElement ? element : null;
}

function handleNavWheel(event: WheelEvent) {
  const nav = navRef.value;
  if (!nav) {
    return;
  }
  const canScroll = nav.scrollHeight > nav.clientHeight;
  if (!canScroll) {
    return;
  }

  const atTop = event.deltaY < 0 && nav.scrollTop <= 0;
  const atBottom = event.deltaY > 0 && nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1;
  if (atTop || atBottom) {
    return;
  }

  event.preventDefault();
  nav.scrollTop += event.deltaY;
}

async function revealGroup(itemTo: string) {
  await nextTick();
  const nav = navRef.value;
  const group = groupRefs.value[itemTo];
  if (!nav || !group) {
    return;
  }

  const navRect = nav.getBoundingClientRect();
  const groupRect = group.getBoundingClientRect();
  const topPadding = 10;
  const bottomPadding = 12;
  const isAbove = groupRect.top < navRect.top + topPadding;
  const isBelow = groupRect.bottom > navRect.bottom - bottomPadding;

  if (!isAbove && !isBelow) {
    return;
  }

  const delta = isAbove
    ? groupRect.top - navRect.top - topPadding
    : groupRect.bottom - navRect.bottom + bottomPadding;

  nav.scrollTo({
    top: nav.scrollTop + delta,
    behavior: 'smooth'
  });
}

async function handlePrimaryClick(itemTo: string) {
  if (isCurrent(itemTo) && props.secondaryItems.length) {
    const willCollapse = uiStore.expandedSidebarSection === itemTo;
    uiStore.toggleSidebarSection(itemTo);
    if (!willCollapse) {
      await revealGroup(itemTo);
    }
    return;
  }

  if (!isCurrent(itemTo)) {
    window.location.assign(itemTo);
  }

  emit('close');
}

function handleBrandClick() {
  restartCurrentSection();
}

watch(
  () => [props.currentPath, uiStore.expandedSidebarSection, props.secondaryItems.length, props.open],
  async ([currentPath, expandedSection, secondaryCount, open]) => {
    const path = String(currentPath);
    const section = String(expandedSection || '');
    const count = Number(secondaryCount);
    const drawerOpen = Boolean(open);
    if (!drawerOpen || !count || !section || !path.startsWith(section)) {
      return;
    }
    await revealGroup(section);
  }
);
</script>

<template>
  <transition name="drawer-fade">
    <div v-if="open" class="mobile-drawer-backdrop" @click.self="emit('close')">
      <aside class="mobile-drawer">
        <div class="mobile-drawer-head">
          <button class="sidebar-brand sidebar-brand-button" type="button" title="冷启动当前页面" @click="handleBrandClick">
            <img src="/logo.png" alt="Riku-Hub" class="sidebar-logo" />
            <strong>Riku-Hub</strong>
          </button>
          <ElButton text size="small" @click="emit('close')">收起</ElButton>
        </div>

        <nav :ref="setNavRef" class="sidebar-nav" @wheel="handleNavWheel">
          <div
            v-for="item in APP_NAV_ITEMS"
            :key="item.to"
            :ref="(element) => setGroupRef(item.to, element)"
            class="sidebar-group"
          >
            <button
              class="sidebar-link sidebar-link-button"
              type="button"
              :class="{ 'sidebar-link-active': isCurrent(item.to) }"
              @click="handlePrimaryClick(item.to)"
            >
              <div class="sidebar-link-copy">
                <span>{{ item.label }}</span>
              </div>
              <span v-if="isCurrent(item.to) && secondaryItems.length" class="sidebar-link-chevron">
                {{ uiStore.expandedSidebarSection === item.to ? '▾' : '▸' }}
              </span>
            </button>

            <section
              v-if="isCurrent(item.to) && secondaryItems.length && uiStore.expandedSidebarSection === item.to"
              class="mobile-secondary-nav"
            >
              <div class="mobile-secondary-nav-head">{{ secondaryTitle }}</div>
              <div class="mobile-secondary-nav-list">
                <button
                  v-for="subItem in secondaryItems"
                  :key="subItem.key"
                  type="button"
                  class="sidebar-submenu-link"
                  :class="{ 'sidebar-submenu-link-active': secondaryActiveKey === subItem.key }"
                  @click="emit('selectSecondary', subItem)"
                >
                  <span>{{ subItem.label }}</span>
                  <small v-if="subItem.badge">{{ subItem.badge }}</small>
                </button>
              </div>
            </section>
          </div>
        </nav>

        <div class="sidebar-footer">
          <a class="sidebar-repo-link" :href="APP_REPO_URL" target="_blank" rel="noreferrer" title="打开 GitHub 仓库">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12A11.5 11.5 0 0 0 8.36 22.92c.58.1.79-.25.79-.56l-.01-2.18c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.27-5.23-5.68 0-1.26.45-2.28 1.19-3.08-.12-.3-.52-1.5.11-3.12 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.49 3.19-1.18 3.19-1.18.64 1.62.24 2.82.12 3.12.74.8 1.19 1.82 1.19 3.08 0 4.42-2.68 5.39-5.24 5.67.41.36.77 1.08.77 2.17l-.01 3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
            </svg>
          </a>
          <span class="sidebar-version">版本 {{ APP_VERSION }}</span>
        </div>
      </aside>
    </div>
  </transition>
</template>
