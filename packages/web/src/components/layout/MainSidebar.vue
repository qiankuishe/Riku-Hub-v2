<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { restartCurrentSection } from '../../utils/localCacheReset';
import { APP_NAV_ITEMS } from './nav';

const uiStore = useUiStore();

const props = defineProps<{
  currentPath: string;
  secondaryItems: SecondaryNavItem[];
  secondaryActiveKey: string;
}>();

const emit = defineEmits<{
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
}

function handleBrandClick() {
  restartCurrentSection();
}

watch(
  () => [props.currentPath, uiStore.expandedSidebarSection, props.secondaryItems.length],
  async ([currentPath, expandedSection, secondaryCount]) => {
    const path = String(currentPath);
    const section = String(expandedSection || '');
    const count = Number(secondaryCount);
    if (!count || !section || !path.startsWith(section)) {
      return;
    }
    await revealGroup(section);
  }
);
</script>

<template>
  <aside class="main-sidebar">
    <div class="sidebar-brand-wrap">
      <!-- Brand -->
      <button class="sidebar-brand sidebar-brand-button" type="button" title="冷启动当前页面" @click="handleBrandClick">
        <img src="/logo.png" alt="Riku-Hub" class="sidebar-logo" />
        <span class="sidebar-brand-name">Riku-Hub</span>
      </button>
    </div>

    <nav :ref="setNavRef" class="sidebar-nav">
      <div
        v-for="item in APP_NAV_ITEMS"
        :key="item.to"
        :ref="(element) => setGroupRef(item.to, element)"
        class="sidebar-group"
      >
        <!-- Primary nav item -->
        <button
          type="button"
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item-active': isCurrent(item.to) }"
          :title="item.label"
          @click="handlePrimaryClick(item.to)"
        >
          <span class="sidebar-nav-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path :d="item.icon" />
            </svg>
          </span>
          <span class="sidebar-nav-label">{{ item.label }}</span>
          <span
            v-if="isCurrent(item.to) && secondaryItems.length"
            class="sidebar-nav-chevron"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
              <path
                v-if="uiStore.expandedSidebarSection === item.to"
                d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"
              />
              <path v-else d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
            </svg>
          </span>
        </button>

        <!-- Sub-items -->
        <div
          v-if="isCurrent(item.to) && secondaryItems.length && uiStore.expandedSidebarSection === item.to"
          class="sidebar-submenu"
        >
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
      </div>
    </nav>

  </aside>
</template>
