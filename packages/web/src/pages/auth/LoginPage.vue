<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { authApi } from '../../api';
import { resolveAppRoute } from '../../utils/routeMemory';

const loginForm = ref({
  username: '',
  password: ''
});
const loading = ref(false);
const showPassword = ref(false);

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

onMounted(() => {
  // 登录检查已在 mountLoginPage 中完成
});
</script>

<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-card">
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
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.login-container {
  width: 100%;
  max-width: 430px;
}

.login-card {
  border-radius: 18px;
  background: #ffffff;
  color: #1d1d1f;
  padding: 32px;
  box-shadow: 0 22px 65px rgba(0, 0, 0, 0.25);
}

.login-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
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
  font-weight: 600;
}

.login-subtitle {
  margin: 4px 0 0;
  color: #6e6e73;
  font-size: 13px;
}

.login-form {
  display: grid;
  gap: 16px;
}

.input-label {
  display: grid;
  gap: 8px;
  color: #4b5563;
  font-size: 13px;
  font-weight: 500;
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
  font-size: 18px;
}

.login-input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  padding: 12px 12px 12px 40px;
  color: #111827;
  background: #ffffff;
  font-size: 14px;
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
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.password-toggle:hover {
  color: #111827;
}

.login-submit-button {
  margin-top: 8px;
  border: 1px solid #111111;
  border-radius: 12px;
  background: #111111;
  color: #ffffff;
  padding: 12px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
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

@media (max-width: 480px) {
  .login-card {
    padding: 24px;
  }
}
</style>
