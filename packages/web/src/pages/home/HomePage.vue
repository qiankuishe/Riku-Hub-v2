<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { snippetsApi, authApi, settingsApi, type PublicClipboardItem } from '../../api';
import ThreeScene from '../../components/auth/ThreeScene.vue';
import NodeTracker from '../../components/auth/NodeTracker.vue';
import ClipboardModal from '../../components/auth/ClipboardModal.vue';
import type { LoginClipboardNode, NodeProjection, SceneNode } from '../../components/auth/types';

const clipboardNodes = ref<LoginClipboardNode[]>([]);
const projections = ref<NodeProjection[]>([]);
const selectedNode = ref<LoginClipboardNode | null>(null);
const toastMessage = ref('');

const blobX = ref(window.innerWidth / 2);
const blobY = ref(window.innerHeight / 2);

let toastTimer = 0;

const NODE_LABELS = [
  'NODE_ALPHA_01',
  'NODE_BETA_02',
  'NODE_GAMMA_03',
  'NODE_DELTA_04',
  'NODE_EPSILON_05',
  'NODE_ZETA_06',
  'NODE_ETA_07',
  'NODE_THETA_08',
  'NODE_IOTA_09'
] as const;

const NODE_POSITIONS: Record<string, { x: number; y: number; z: number }> = {
  NODE_ALPHA_01: { x: 0, y: 3.5, z: 3.5 },
  NODE_BETA_02: { x: -3.5, y: -1.2, z: 4 },
  NODE_GAMMA_03: { x: 3.5, y: -2.2, z: 3 },
  NODE_DELTA_04: { x: -2.2, y: 2.2, z: 4.5 },
  NODE_EPSILON_05: { x: 2.2, y: 1.2, z: 3.5 },
  NODE_ZETA_06: { x: 0, y: -3.5, z: 4 },
  NODE_ETA_07: { x: -4.5, y: 0, z: 3 },
  NODE_THETA_08: { x: 4.5, y: 0, z: 4 },
  NODE_IOTA_09: { x: 0, y: 0, z: 5.5 }
};

const sceneNodes = computed<SceneNode[]>(() => {
  return clipboardNodes.value.map((node, index) => {
    const fallbackLabel = NODE_LABELS[index] ?? NODE_LABELS[NODE_LABELS.length - 1];
    const label = node.nodeLabel || fallbackLabel;
    const position = NODE_POSITIONS[label] ?? NODE_POSITIONS[fallbackLabel];
    return {
      id: node.id,
      label,
      speedLevel: node.speedLevel,
      basePosition: position
    };
  });
});

function getSpeedLevel(content: string) {
  const length = content.length;
  if (length > 1800) return 5;
  if (length > 900) return 4;
  if (length > 300) return 3;
  if (length > 90) return 2;
  return 1;
}

function normalizeClipboardItems(items: PublicClipboardItem[]) {
  return items.slice(0, 9).map((item, index) => {
    const fallbackLabel = NODE_LABELS[index] ?? NODE_LABELS[NODE_LABELS.length - 1];
    const nodeLabel = item.nodeLabel || fallbackLabel;
    return {
      id: item.id,
      title: item.title?.trim() || `节点 ${index + 1}`,
      content: item.content ?? '',
      nodeLabel,
      createdAt: item.createdAt,
      speedLevel: getSpeedLevel(item.content ?? '')
    } satisfies LoginClipboardNode;
  });
}

function showToast(message: string, duration = 2600) {
  toastMessage.value = message;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = '';
  }, duration);
}

async function loadPublicClipboard() {
  try {
    const data = await snippetsApi.getPublicClipboard();
    clipboardNodes.value = normalizeClipboardItems(data.items ?? []);
    if (clipboardNodes.value.length === 0) {
      showToast('暂无公开节点');
    }
  } catch (error) {
    clipboardNodes.value = [];
    showToast(error instanceof Error ? error.message : '公开节点加载失败');
  }
}

async function checkAutoRedirect() {
  try {
    // Check if user is authenticated
    const authCheck = await authApi.check();
    if (!authCheck.authenticated) {
      return;
    }

    // Check if auto redirect is enabled
    const autoRedirectSetting = await settingsApi.getSetting('auto_redirect_to_dashboard');
    if (autoRedirectSetting.value === 'true') {
      // Redirect to dashboard
      window.location.href = '/riku/nav';
    }
  } catch (error) {
    // Silently fail - don't show errors for auto redirect check
    console.debug('Auto redirect check failed:', error);
  }
}

function goToLogin() {
  window.location.href = '/riku/login';
}

function onMouseMove(event: MouseEvent) {
  blobX.value = event.clientX;
  blobY.value = event.clientY;
}

function onSceneProject(next: NodeProjection[]) {
  projections.value = next;
}

function onSceneError(message: string) {
  showToast(message);
}

onMounted(async () => {
  await Promise.all([
    loadPublicClipboard(),
    checkAutoRedirect()
  ]);
  window.addEventListener('mousemove', onMouseMove);
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  window.removeEventListener('mousemove', onMouseMove);
});
</script>

<template>
  <div class="home-page">
    <div class="tracker-blob" :style="{ left: `${blobX}px`, top: `${blobY}px` }" />

    <ThreeScene :nodes="sceneNodes" @project="onSceneProject" @error="onSceneError" />
    <NodeTracker :nodes="clipboardNodes" :projections="projections" @select="selectedNode = $event" />

    <main class="home-main">
      <div class="home-top-actions">
        <button class="login-button" type="button" @click="goToLogin">
          登录
        </button>
      </div>

      <section class="hero-copy">
        <h1 class="hero-title">
          个人
          <br />
          <span class="hero-title-strong">知识中枢</span>
        </h1>
        <p class="hero-desc">一个现代化的知识管理系统，帮助你收集、整理和分享你的想法、笔记和代码片段。</p>
        <p class="hero-meta">活跃节点: {{ clipboardNodes.length }} / 数据密度: 98.7%</p>
      </section>
    </main>

    <transition name="toast-fade">
      <div v-if="toastMessage" class="top-toast">{{ toastMessage }}</div>
    </transition>

    <ClipboardModal :item="selectedNode" @close="selectedNode = null" />
  </div>
</template>

<style scoped>
.home-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  background: #000000;
  color: #ffffff;
}

.tracker-blob {
  position: absolute;
  z-index: 0;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.05) 0%, rgba(0, 0, 0, 0) 70%);
}

.home-main {
  position: relative;
  z-index: 20;
  min-height: 100vh;
  pointer-events: none;
}

.home-top-actions {
  position: absolute;
  top: 24px;
  right: 28px;
  pointer-events: auto;
}

.login-button {
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  color: #111111;
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 600;
  transition: all 160ms ease;
  cursor: pointer;
}

.login-button:hover {
  background: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24);
}

.hero-copy {
  position: absolute;
  top: 45%;
  left: 32px;
  transform: translateY(-50%);
  max-width: 540px;
}

.hero-title {
  margin: 0;
  font-size: clamp(42px, 8vw, 74px);
  line-height: 0.95;
  font-weight: 320;
  letter-spacing: -0.04em;
}

.hero-title-strong {
  font-weight: 700;
}

.hero-desc {
  margin-top: 24px;
  max-width: 420px;
  color: #d4d4d8;
  font-size: clamp(14px, 2.2vw, 18px);
  line-height: 1.7;
}

.hero-meta {
  margin-top: 14px;
  color: #71717a;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.top-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  background: rgba(255, 255, 255, 0.95);
  color: #111111;
  padding: 12px 24px;
  border-radius: 12px;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

@media (max-width: 900px) {
  .hero-copy {
    left: 18px;
    right: 18px;
    top: 56%;
    transform: translateY(-50%);
  }
}

@media (max-width: 1024px) and (orientation: portrait), (max-width: 768px) {
  .hero-copy {
    display: none !important;
  }
}
</style>
