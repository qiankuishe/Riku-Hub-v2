<script setup lang="ts">
import { ElButton } from 'element-plus';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    size?: 'large' | 'default' | 'small';
  }>(),
  {
    size: 'small'
  }
);
</script>

<template>
  <ElButton v-bind="$attrs" :size="props.size">
    <slot />
  </ElButton>
</template>
