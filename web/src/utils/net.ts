export function getBackendPort(): number {
  const v = String((import.meta as any)?.env?.PUBLIC_BACKEND_PORT || (import.meta as any)?.env?.VITE_BACKEND_PORT || '').trim();
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  return 9011;
}

export function getApiBaseUrl(): string {
  const v = String((import.meta as any)?.env?.PUBLIC_API_BASE_URL || (import.meta as any)?.env?.VITE_API_BASE_URL || '').trim();
  if (v) return v.replace(/\/+$/, '');
  if (typeof window === 'undefined') return `http://localhost:${getBackendPort()}/api`;
  if (window.location.protocol === 'file:' || window.location.origin === 'null') return `http://localhost:${getBackendPort()}/api`;
  return `${window.location.origin}/api`;
}

export function getWsUrl(): string {
  const v = String((import.meta as any)?.env?.PUBLIC_WS_URL || (import.meta as any)?.env?.VITE_WS_URL || '').trim();
  if (v) return v;
  if (typeof window === 'undefined') return `ws://localhost:${getBackendPort()}/ws`;
  if (window.location.protocol === 'file:' || window.location.origin === 'null') return `ws://localhost:${getBackendPort()}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
