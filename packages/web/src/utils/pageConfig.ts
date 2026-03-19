export const DEFAULT_APP_ROUTE = '/nav';
export const LOGIN_PATH = '/login';

export interface AppSectionItem {
  key: string;
  label: string;
  to: string;
  title: string;
  subtitle: string;
}

export const APP_SECTION_ITEMS: AppSectionItem[] = [
  { key: 'navigation', label: '网站导航', to: '/nav', title: '网站导航', subtitle: '' },
  { key: 'snippets', label: '剪贴板', to: '/snippets', title: '剪贴板', subtitle: '' },
  { key: 'subscriptions', label: '订阅聚合', to: '/subscriptions', title: '订阅聚合', subtitle: '' },
  { key: 'notes', label: '笔记', to: '/notes', title: '笔记', subtitle: '' },
  { key: 'logs', label: '运行日志', to: '/logs', title: '运行日志', subtitle: '' },
  { key: 'settings', label: '系统设置', to: '/settings', title: '系统设置', subtitle: '' }
];

const APP_SECTION_PATHS = new Set(APP_SECTION_ITEMS.map((item) => item.to));
const APP_ROUTE_ALIASES: Record<string, string> = {
  '/navigation': '/nav',
  '/clipboard': '/snippets'
};

export function getPathname(route: string | null | undefined): string {
  if (typeof route !== 'string' || !route) {
    return '';
  }

  try {
    const pathname = new URL(route, 'https://riku-hub.local').pathname;
    return APP_ROUTE_ALIASES[pathname] ?? pathname;
  } catch {
    const pathname = route.split(/[?#]/, 1)[0] ?? '';
    return APP_ROUTE_ALIASES[pathname] ?? pathname;
  }
}

export function isAppRoutePath(route: string | null | undefined): route is string {
  return APP_SECTION_PATHS.has(getPathname(route));
}

export function getCurrentFullPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getCurrentSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function getAppSectionByPath(route: string | null | undefined) {
  const pathname = getPathname(route);
  return APP_SECTION_ITEMS.find((item) => item.to === pathname) ?? null;
}
