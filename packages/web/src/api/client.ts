import { buildLoginRedirectUrl } from '../utils/routeMemory';

export interface RequestOptions extends RequestInit {
  skipAuthRedirect?: boolean;
}

export async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers
  });

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
    window.location.href = buildLoginRedirectUrl();
  }

  if (!response.ok) {
    const fallback = raw.trim().slice(0, 180);
    throw new Error(data.error || fallback || `请求失败 (${response.status})`);
  }

  return data;
}
