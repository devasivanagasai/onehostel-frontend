/** True when `route` is `base` or a page under it ("/fees", "/fees/123", "/fees?tab=charges"). */
export function matchesRoute(route: string, base: string): boolean {
  const path = route.split(/[?#]/)[0];
  return path === base || path.startsWith(base + '/');
}
