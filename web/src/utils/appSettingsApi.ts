import { getApiBaseUrl } from './net';
import { normalizeAppSettings, type AppSettingsV1 } from './appSettings';

export async function fetchRemoteAppSettings(signal?: AbortSignal): Promise<AppSettingsV1 | null> {
  const url = `${getApiBaseUrl()}/settings`;
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) return null;
  const json = await res.json();
  const data = json && typeof json === 'object' ? (json as any).data : null;
  if (!data) return null;
  return normalizeAppSettings(data);
}

export async function pushRemoteAppSettings(settings: AppSettingsV1, signal?: AbortSignal): Promise<boolean> {
  const url = `${getApiBaseUrl()}/settings`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: settings }),
    signal,
  });
  return res.ok;
}
