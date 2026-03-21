<script setup lang="ts">
import { ElDialog } from 'element-plus';
import UiButton from '../../components/ui/UiButton.vue';

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
        <UiButton @click="emit('close')">{{ cancelText }}</UiButton>
        <UiButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">{{ confirmText }}</UiButton>
      </div>
    </template>
  </ElDialog>
</template>
