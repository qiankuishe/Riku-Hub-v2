export function isPublicCompatPath(pathname: string): boolean {
  return [
    '/api/auth/register',
    '/api/auth/me',
    '/api/nav',
    '/api/nav/categories',
    '/api/nav/links',
    '/api/sub',
    '/api/sub/sources',
    '/api/sub/articles',
    '/api/clipboard',
    '/api/settings',
    '/api/settings/stats'
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
