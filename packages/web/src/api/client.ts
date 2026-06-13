import { buildLoginRedirectUrl } from '../utils/routeMemory';

export interface RequestOptions extends RequestInit {
  skipAuthRedirect?: boolean;
  timeout?: number; // 超时时间（毫秒）
}

// 默认超时时间：30 秒
const DEFAULT_TIMEOUT = 30000;

// 全局标记防止401竞态条件
let isRedirectingToLogin = false;

export async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 创建超时 AbortController
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
      signal: options?.signal ?? controller.signal
    });

    clearTimeout(timeoutId);

    const raw = await response.text();
    const data = (() => {
      if (!raw) {
        return {} as { error?: string } & T;
      }
      try {
        return JSON.parse(raw) as { error?: string } & T;
      } catch {
        return {} as { error?: string } & T;
      }
    })();

    if (response.status === 401 && !options?.skipAuthRedirect) {
      // 防止竞态条件：多个401同时触发重定向
      if (isRedirectingToLogin) {
        throw new Error('会话已过期');
      }
      isRedirectingToLogin = true;

      // 会话已过期，显示提示并跳转登录页
      const message = data.error || '登录已过期，请重新登录';

      // 尝试使用全局 toast（如果可用）
      try {
        const { useUiStore } = await import('../stores/ui');
        const uiStore = useUiStore();
        uiStore.showToast(message);
      } catch {
        // 降级：使用原生 alert
        alert(message);
      }

      // 延迟跳转，让用户看到提示
      setTimeout(() => {
        window.location.href = buildLoginRedirectUrl();
      }, 1000);

      // 抛出错误，中断后续处理
      throw new Error('会话已过期');
    }

    if (!response.ok) {
      const fallback = raw.trim().slice(0, 180);
      throw new Error(data.error || fallback || `请求失败 (${response.status})`);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    // 检查是否为超时错误
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout / 1000}秒），请检查网络连接`);
    }

    throw error;
  }
}
