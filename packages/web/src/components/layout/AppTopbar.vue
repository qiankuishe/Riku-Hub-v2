<script setup lang="ts">
import { ElButton } from 'element-plus';
import { Icon } from '@iconify/vue';

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
      <ElButton class="menu-button" text size="small" @click="emit('menu')">
        <Icon icon="carbon:menu" />
        菜单
      </ElButton>
      <div>
        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
    </div>
  </header>
</template>
