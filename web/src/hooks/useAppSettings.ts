import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettingsV1, AutoSendConfig, DataEncoding, SerialFilterConfig } from '../utils/appSettings';
import { loadAppSettings, saveAppSettings, updateAppSettings } from '../utils/appSettingsStorage';
import { fetchRemoteAppSettings, pushRemoteAppSettings } from '../utils/appSettingsApi';

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettingsV1>(() => loadAppSettings());
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const pendingPushRef = useRef<AppSettingsV1 | null>(null);
  const pushTimerRef = useRef<number | null>(null);

  const schedulePush = useCallback((next: AppSettingsV1) => {
    pendingPushRef.current = next;
    if (pushTimerRef.current != null) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(async () => {
      const payload = pendingPushRef.current;
      pendingPushRef.current = null;
      pushTimerRef.current = null;
      if (!payload) return;
      try {
        setSyncState('syncing');
        const ok = await pushRemoteAppSettings(payload);
        setSyncState(ok ? 'idle' : 'error');
      } catch {
        setSyncState('error');
      }
    }, 500);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        setSyncState('syncing');
        const remote = await fetchRemoteAppSettings(ctrl.signal);
        if (!remote) {
          setSyncState('idle');
          return;
        }
        const local = loadAppSettings();
        if (remote.updatedAt > local.updatedAt) {
          saveAppSettings(remote);
          setSettings(remote);
          setSyncState('idle');
          return;
        }
        if (local.updatedAt > remote.updatedAt) {
          setSettings(local);
          schedulePush(local);
          return;
        }
        setSettings(local);
        setSyncState('idle');
      } catch {
        setSyncState('error');
      }
    })();
    return () => {
      ctrl.abort();
    };
  }, [schedulePush]);

  const setSendEncoding = useCallback((sendEncoding: DataEncoding) => {
    const next = updateAppSettings({ sendEncoding });
    setSettings(next);
    schedulePush(next);
  }, [schedulePush]);

  const setSerialFilter = useCallback((serialFilter: SerialFilterConfig) => {
    const next = updateAppSettings({ serialFilter });
    setSettings(next);
    schedulePush(next);
  }, [schedulePush]);

  const setAutoSend = useCallback((autoSend: AutoSendConfig) => {
    const next = updateAppSettings({ autoSend });
    setSettings(next);
    schedulePush(next);
  }, [schedulePush]);

  return {
    settings,
    syncState,
    setSendEncoding,
    setSerialFilter,
    setAutoSend,
  };
}
