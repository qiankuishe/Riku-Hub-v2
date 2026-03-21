<script setup lang="ts">
import { Icon } from '@iconify/vue';
import UiButton from '../ui/UiButton.vue';

defineProps<{
  title: string;
  subtitle: string;
}>();

const emit = defineEmits<{
  menu: [];
}>();
</script>

<template>
  <header class="topbar">
    <div class="topbar-title">
      <UiButton class="menu-button" text size="small" @click="emit('menu')">
        <Icon icon="carbon:menu" />
        菜单
      </UiButton>
    </div>
  </header>
</template>
