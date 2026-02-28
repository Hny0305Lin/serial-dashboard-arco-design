import { getDefaultAppSettings, normalizeAppSettings, type AppSettingsV1 } from './appSettings';

const KEY = 'wsc.appSettings.v1';

function canUseDOMStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const t = '__wsc_test__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}

function safeParseJson(v: string | null): any | null {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function migrateFromLegacyKeys(): AppSettingsV1 | null {
  if (!canUseDOMStorage()) return null;
  const legacySendEncoding = window.localStorage.getItem('sendEncoding');
  const legacySerialFilter = safeParseJson(window.localStorage.getItem('serialFilterConfig'));
  const legacyAutoSend = safeParseJson(window.localStorage.getItem('autoSendConfig'));

  if (!legacySendEncoding && !legacySerialFilter && !legacyAutoSend) return null;

  const base = getDefaultAppSettings();
  const merged = normalizeAppSettings({
    ...base,
    sendEncoding: legacySendEncoding ?? base.sendEncoding,
    serialFilter: legacySerialFilter ?? base.serialFilter,
    autoSend: legacyAutoSend ?? base.autoSend,
    updatedAt: Date.now(),
  });
  saveAppSettings(merged);
  return merged;
}

export function loadAppSettings(): AppSettingsV1 {
  if (!canUseDOMStorage()) return getDefaultAppSettings();
  const raw = window.localStorage.getItem(KEY);
  const parsed = safeParseJson(raw);
  if (parsed) return normalizeAppSettings(parsed);
  const migrated = migrateFromLegacyKeys();
  if (migrated) return migrated;
  const d = getDefaultAppSettings();
  saveAppSettings(d);
  return d;
}

export function saveAppSettings(next: AppSettingsV1): void {
  if (!canUseDOMStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
  }
}

export function updateAppSettings(patch: Partial<Omit<AppSettingsV1, 'schemaVersion'>>): AppSettingsV1 {
  const cur = loadAppSettings();
  const next = normalizeAppSettings({ ...cur, ...patch, updatedAt: Date.now() });
  saveAppSettings(next);
  return next;
}
