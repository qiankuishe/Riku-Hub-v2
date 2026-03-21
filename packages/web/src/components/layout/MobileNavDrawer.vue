<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { restartCurrentSection } from '../../utils/localCacheReset';
import { APP_NAV_ITEMS } from './nav';
import UiButton from '../ui/UiButton.vue';

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
          <UiButton text size="small" @click="emit('close')">收起</UiButton>
        </div>

        <nav :ref="setNavRef" class="sidebar-nav">
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

      </aside>
    </div>
  </transition>
</template>
