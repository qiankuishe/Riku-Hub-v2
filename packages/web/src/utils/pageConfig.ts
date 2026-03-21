export const DEFAULT_APP_ROUTE = '/riku/nav';
export const LOGIN_PATH = '/riku/login';

export interface AppSectionItem {
  key: string;
  label: string;
  to: string;
  title: string;
  subtitle: string;
}

export const APP_SECTION_ITEMS: AppSectionItem[] = [
  { key: 'navigation', label: '网站导航', to: '/riku/nav', title: '网站导航', subtitle: '' },
  { key: 'snippets', label: '剪贴板', to: '/riku/snippets', title: '剪贴板', subtitle: '' },
  { key: 'notes', label: '笔记', to: '/riku/notes', title: '笔记', subtitle: '' },
  { key: 'images', label: '图床', to: '/riku/images', title: '图床', subtitle: '' },
  { key: 'subscriptions', label: '订阅聚合', to: '/riku/subscriptions', title: '订阅聚合', subtitle: '' },
  { key: 'logs', label: '运行日志', to: '/riku/logs', title: '运行日志', subtitle: '' },
  { key: 'settings', label: '系统设置', to: '/riku/settings', title: '系统设置', subtitle: '' }
];

const APP_SECTION_PATHS = new Set(APP_SECTION_ITEMS.map((item) => item.to));
const APP_ROUTE_ALIASES: Record<string, string> = {
  '/navigation': '/riku/nav',
  '/nav': '/riku/nav',
  '/clipboard': '/riku/snippets',
  '/snippets': '/riku/snippets',
  '/images': '/riku/images',
  '/notes': '/riku/notes',
  '/subscriptions': '/riku/subscriptions',
  '/logs': '/riku/logs',
  '/settings': '/riku/settings'
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
