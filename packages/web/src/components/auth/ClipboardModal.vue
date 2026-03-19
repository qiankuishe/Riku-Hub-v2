<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { LoginClipboardNode } from './types';

const props = defineProps<{
  item: LoginClipboardNode | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const copying = ref(false);
const copied = ref(false);

async function handleCopy() {
  if (!props.item || copying.value) {
    return;
  }
  copying.value = true;
  copied.value = false;
  try {
    await navigator.clipboard.writeText(props.item.content);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } finally {
    copying.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<template>
  <div v-if="item" class="clipboard-modal-overlay" @click="close">
    <div class="clipboard-modal-content" @click.stop>
      <div class="clipboard-modal-header">
        <div>
          <h3 class="clipboard-modal-title">{{ item.title || item.nodeLabel }}</h3>
          <p class="clipboard-modal-meta">{{ item.nodeLabel }}</p>
        </div>
        <button class="clipboard-modal-close" type="button" @click="close">
          <Icon icon="carbon:close" />
        </button>
      </div>

      <pre class="clipboard-modal-body">{{ item.content }}</pre>

      <div class="clipboard-modal-footer">
        <button class="clipboard-copy-btn" type="button" :disabled="copying" @click="handleCopy">
          <Icon :icon="copied ? 'carbon:checkmark' : 'carbon:copy'" />
          <span>{{ copied ? '已复制' : copying ? '复制中...' : '复制内容' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clipboard-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(4px);
}

.clipboard-modal-content {
  width: min(92vw, 680px);
  max-height: 82vh;
  overflow: auto;
  border: 1px solid #d1d5db;
  border-radius: 18px;
  background: #ffffff;
  color: #1d1d1f;
  padding: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.clipboard-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.clipboard-modal-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 650;
}

.clipboard-modal-meta {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
}

.clipboard-modal-close {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  background: #f9fafb;
  color: #4b5563;
}

.clipboard-modal-body {
  margin: 14px 0 0;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f9fafb;
  color: #111827;
  padding: 12px;
  max-height: 48vh;
  overflow: auto;
  font-size: 13px;
  line-height: 1.72;
  white-space: pre-wrap;
  word-break: break-word;
}

.clipboard-modal-footer {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.clipboard-copy-btn {
  border: 1px solid #111111;
  border-radius: 10px;
  background: #111111;
  color: #ffffff;
  padding: 9px 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.clipboard-copy-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}
</style>
