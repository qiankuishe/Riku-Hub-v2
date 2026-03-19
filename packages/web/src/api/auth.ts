import { request } from './client';

export const authApi = {
  login: (username: string, password: string) =>
    request<{ success: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuthRedirect: true
    }),
  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', {
      method: 'POST'
    }),
  check: () => request<{ authenticated: boolean }>('/api/auth/check', { skipAuthRedirect: true })
};
