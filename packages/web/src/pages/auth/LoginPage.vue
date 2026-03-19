<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { authApi, snippetsApi, type PublicClipboardItem } from '../../api';
import { resolveAppRoute } from '../../utils/routeMemory';
import ThreeScene from '../../components/auth/ThreeScene.vue';
import NodeTracker from '../../components/auth/NodeTracker.vue';
import ClipboardModal from '../../components/auth/ClipboardModal.vue';
import type { LoginClipboardNode, NodeProjection, SceneNode } from '../../components/auth/types';

const loginForm = ref({
  username: '',
  password: ''
});
const loading = ref(false);
const showPassword = ref(false);
const loginModalVisible = ref(false);
const clipboardNodes = ref<LoginClipboardNode[]>([]);
const projections = ref<NodeProjection[]>([]);
const selectedNode = ref<LoginClipboardNode | null>(null);
const toastMessage = ref('');

const blobX = ref(window.innerWidth / 2);
const blobY = ref(window.innerHeight / 2);

let autoShowTimer = 0;
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
      showToast('暂无公开节点，仍可直接登录');
    }
  } catch (error) {
    clipboardNodes.value = [];
    showToast(error instanceof Error ? error.message : '公开节点加载失败，仍可直接登录');
  }
}

function openLoginModal() {
  loginModalVisible.value = true;
}

function closeLoginModal() {
  loginModalVisible.value = false;
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

async function handleLogin() {
  if (!loginForm.value.username.trim() || !loginForm.value.password.trim()) {
    ElMessage.error('请输入用户名和密码');
    return;
  }

  loading.value = true;
  try {
    await authApi.login(loginForm.value.username.trim(), loginForm.value.password);
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    window.location.replace(resolveAppRoute(redirect));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // 优先检查登录状态，如果已登录则直接跳转，避免加载3D资源
  try {
    await authApi.check();
    // 已登录，直接跳转到后台
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    window.location.replace(resolveAppRoute(redirect));
    return; // 阻止后续代码执行，不加载3D场景
  } catch {
    // 未登录，继续正常流程
  }

  await loadPublicClipboard();

  autoShowTimer = window.setTimeout(() => {
    loginModalVisible.value = true;
  }, 5000);

  window.addEventListener('mousemove', onMouseMove);
});

onUnmounted(() => {
  if (autoShowTimer) {
    window.clearTimeout(autoShowTimer);
  }
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  window.removeEventListener('mousemove', onMouseMove);
});
</script>

<template>
  <div class="login-scene-page">
    <div class="tracker-blob" :style="{ left: `${blobX}px`, top: `${blobY}px` }" />

    <ThreeScene :nodes="sceneNodes" @project="onSceneProject" @error="onSceneError" />
    <NodeTracker :nodes="clipboardNodes" :projections="projections" @select="selectedNode = $event" />

    <main class="login-main">
      <div class="login-top-actions">
        <button class="login-open-button" type="button" @click="openLoginModal">
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

    <div v-if="loginModalVisible" class="login-modal-overlay" @click="closeLoginModal">
      <div class="login-modal-content" @click.stop>
        <div class="login-header">
          <img src="/logo.png" alt="Riku-Hub" class="login-logo" />
          <div>
            <h2 class="login-title">Riku-Hub</h2>
            <p class="login-subtitle">登录后继续使用</p>
          </div>
        </div>

        <form class="login-form" @submit.prevent="handleLogin">
          <label class="input-label">
            <span>用户名</span>
            <div class="input-wrapper">
              <Icon icon="carbon:user" class="input-icon" />
              <input v-model="loginForm.username" class="login-input" autocomplete="username" placeholder="请输入用户名" />
            </div>
          </label>

          <label class="input-label">
            <span>密码</span>
            <div class="input-wrapper">
              <Icon icon="carbon:password" class="input-icon" />
              <input
                v-model="loginForm.password"
                class="login-input with-toggle"
                autocomplete="current-password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="请输入密码"
              />
              <button type="button" class="password-toggle" @click="showPassword = !showPassword">
                <Icon :icon="showPassword ? 'carbon:view-off' : 'carbon:view'" />
              </button>
            </div>
          </label>

          <button class="login-submit-button" type="submit" :disabled="loading">
            <Icon icon="carbon:login" />
            <span>{{ loading ? '登录中...' : '登录' }}</span>
          </button>
        </form>
      </div>
    </div>

    <ClipboardModal :item="selectedNode" @close="selectedNode = null" />
  </div>
</template>

<style scoped>
.login-scene-page {
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

.login-main {
  position: relative;
  z-index: 20;
  min-height: 100vh;
  pointer-events: none;
}

.login-top-actions {
  position: absolute;
  top: 24px;
  right: 28px;
  pointer-events: auto;
}

.login-open-button {
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  color: #111111;
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 600;
  transition: all 160ms ease;
}

.login-open-button:hover {
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

.login-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.login-modal-content {
  width: min(92vw, 430px);
  border-radius: 18px;
  background: #ffffff;
  color: #1d1d1f;
  padding: 28px;
  box-shadow: 0 22px 65px rgba(0, 0, 0, 0.55);
}

.login-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.login-logo {
  width: 62px;
  height: 62px;
  border-radius: 12px;
  object-fit: contain;
}

.login-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
}

.login-subtitle {
  margin: 4px 0 0;
  color: #6e6e73;
  font-size: 13px;
}

.login-form {
  display: grid;
  gap: 14px;
}

.input-label {
  display: grid;
  gap: 6px;
  color: #4b5563;
  font-size: 13px;
}

.input-wrapper {
  position: relative;
}

.input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
}

.login-input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  padding: 11px 12px 11px 38px;
  color: #111827;
  background: #ffffff;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.login-input:focus {
  border-color: #111111;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08);
}

.login-input.with-toggle {
  padding-right: 42px;
}

.password-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: #9ca3af;
}

.password-toggle:hover {
  color: #111827;
}

.login-submit-button {
  margin-top: 2px;
  border: 1px solid #111111;
  border-radius: 12px;
  background: #111111;
  color: #ffffff;
  padding: 11px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 600;
  transition: all 160ms ease;
}

.login-submit-button:hover:enabled {
  background: #000000;
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.22);
}

.login-submit-button:disabled {
  opacity: 0.68;
  cursor: wait;
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
