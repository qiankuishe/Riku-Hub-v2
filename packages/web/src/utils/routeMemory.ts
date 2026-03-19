import { DEFAULT_APP_ROUTE, isAppRoutePath } from './pageConfig';
export { DEFAULT_APP_ROUTE, isAppRoutePath } from './pageConfig';

const LAST_APP_ROUTE_KEY = 'riku-hub:last-app-route';
const ROUTE_SCROLL_KEY_PREFIX = 'riku-hub:scroll:';

export function readLastAppRoute(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_ROUTE;
  }

  const stored = window.sessionStorage.getItem(LAST_APP_ROUTE_KEY);
  return isAppRoutePath(stored) ? stored : DEFAULT_APP_ROUTE;
}

export function rememberAppRoute(route: string) {
  if (typeof window === 'undefined' || !isAppRoutePath(route)) {
    return;
  }

  window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, route);
}

export function resolveAppRoute(route: string | null | undefined): string {
  return isAppRoutePath(route) ? route : readLastAppRoute();
}

export function readAppRouteScroll(route: string): number {
  if (typeof window === 'undefined' || !isAppRoutePath(route)) {
    return 0;
  }

  const raw = window.sessionStorage.getItem(`${ROUTE_SCROLL_KEY_PREFIX}${route}`);
  const value = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function rememberAppRouteScroll(route: string, top: number) {
  if (typeof window === 'undefined' || !isAppRoutePath(route)) {
    return;
  }

  const normalized = Math.max(0, Math.round(top));
  window.sessionStorage.setItem(`${ROUTE_SCROLL_KEY_PREFIX}${route}`, String(normalized));
}

export function buildLoginRedirectUrl(route?: string): string {
  if (typeof window === 'undefined') {
    return '/login';
  }

  const currentRoute = route ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!isAppRoutePath(currentRoute)) {
    return '/login';
  }

  rememberAppRoute(currentRoute);
  return `/login?redirect=${encodeURIComponent(currentRoute)}`;
}
