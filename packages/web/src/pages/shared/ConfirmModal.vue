<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }>(),
  {
    confirmText: '确认',
    cancelText: '取消',
    danger: true
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="title"
    width="460px"
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    align-center
    @close="emit('close')"
    @update:model-value="(value) => !value && emit('close')"
  >
    <p class="text-sm text-gray-600 leading-6">{{ message }}</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <ElButton @click="emit('close')">{{ cancelText }}</ElButton>
        <ElButton :type="danger ? 'danger' : 'primary'" @click="emit('confirm')">{{ confirmText }}</ElButton>
      </div>
    </template>
  </ElDialog>
</template>
