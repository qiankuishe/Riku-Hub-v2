<script setup lang="ts">
import { ElButton } from 'element-plus';
import { computed } from 'vue';

defineOptions({
  inheritAttrs: false
});

type UiButtonVariant = 'default' | 'primary' | 'danger' | 'text' | 'text-danger' | 'icon' | 'icon-danger';

const props = withDefaults(
  defineProps<{
    variant?: UiButtonVariant;
    size?: 'large' | 'default' | 'small';
  }>(),
  {
    variant: 'default',
    size: 'small'
  }
);

const buttonType = computed(() => {
  if (props.variant === 'primary') {
    return 'primary';
  }
  if (props.variant === 'danger' || props.variant === 'text-danger' || props.variant === 'icon-danger') {
    return 'danger';
  }
  return 'default';
});

const isText = computed(() => props.variant === 'text' || props.variant === 'text-danger');
const isCircle = computed(() => props.variant === 'icon' || props.variant === 'icon-danger');
</script>

<template>
  <ElButton
    v-bind="$attrs"
    :size="props.size"
    :type="buttonType"
    :text="isText"
    :circle="isCircle"
    class="ui-button"
    :class="`ui-button--${props.variant}`"
  >
    <slot />
  </ElButton>
</template>
