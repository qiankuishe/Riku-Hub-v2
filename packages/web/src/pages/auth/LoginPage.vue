<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElInput, ElMessage } from 'element-plus'
import { Icon } from '@iconify/vue'
import { authApi } from '../../api'
import { resolveAppRoute } from '../../utils/routeMemory'

const loginForm = ref({
  username: '',
  password: ''
})
const loading = ref(false)
const showPassword = ref(false)

async function handleLogin() {
  if (!loginForm.value.username.trim() || !loginForm.value.password.trim()) {
    ElMessage.error('请输入用户名和密码')
    return
  }

  loading.value = true
  try {
    await authApi.login(loginForm.value.username.trim(), loginForm.value.password)
    const redirect = new URLSearchParams(window.location.search).get('redirect')
    window.location.replace(resolveAppRoute(redirect))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex-center bg-gray-50">
    <div class="card max-w-sm w-full mx-4">
      <div class="flex items-center gap-4 mb-8">
        <img src="/logo.png" alt="Riku-Hub" class="w-16 h-16 rounded-xl" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Riku-Hub</h1>
          <p class="text-muted">登录后继续使用</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <el-input
          v-model="loginForm.username"
          placeholder="用户名"
          autocomplete="username"
          size="large"
        >
          <template #prefix>
            <Icon icon="carbon:user" />
          </template>
        </el-input>

        <el-input
          v-model="loginForm.password"
          :type="showPassword ? 'text' : 'password'"
          placeholder="密码"
          autocomplete="current-password"
          size="large"
        >
          <template #prefix>
            <Icon icon="carbon:password" />
          </template>
          <template #suffix>
            <Icon
              :icon="showPassword ? 'carbon:view-off' : 'carbon:view'"
              class="cursor-pointer"
              @click="showPassword = !showPassword"
            />
          </template>
        </el-input>

        <el-button
          type="primary"
          size="large"
          class="w-full"
          :loading="loading"
          native-type="submit"
        >
          <Icon icon="carbon:login" class="mr-2" />
          登录
        </el-button>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* 如果需要微调 Element Plus 样式，在这里写 */
</style>
