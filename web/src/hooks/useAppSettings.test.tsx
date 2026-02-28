import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAppSettings } from './useAppSettings';

vi.mock('../utils/appSettingsApi', () => {
  return {
    fetchRemoteAppSettings: vi.fn(async () => null),
    pushRemoteAppSettings: vi.fn(async () => true),
  };
});

import { pushRemoteAppSettings } from '../utils/appSettingsApi';
import { fetchRemoteAppSettings } from '../utils/appSettingsApi';

function Harness(props: { onUpdate: (v: any) => void }) {
  const api = useAppSettings();
  useEffect(() => {
    props.onUpdate(api);
  }, [api.settings, api.syncState]);
  return null;
}

describe('useAppSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.mocked(fetchRemoteAppSettings).mockResolvedValue(null);
    vi.mocked(pushRemoteAppSettings).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('setSendEncoding 会写入本地并触发远端同步', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);

    let latest: any = null;
    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
    });

    await act(async () => {
      latest.setSendEncoding('utf8');
    });

    expect(localStorage.getItem('wsc.appSettings.v1')).toContain('"sendEncoding":"utf8"');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(pushRemoteAppSettings).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('远端配置更新更晚时会覆盖本地', async () => {
    localStorage.setItem(
      'wsc.appSettings.v1',
      JSON.stringify({ schemaVersion: 1, updatedAt: 100, sendEncoding: 'hex', serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' }, autoSend: { enabled: false, content: '00', encoding: 'hex' } })
    );
    vi.mocked(fetchRemoteAppSettings).mockResolvedValue({
      schemaVersion: 1,
      updatedAt: 200,
      sendEncoding: 'utf8',
      serialFilter: { enabled: true, vendorId: '1234', productId: '0001', interfaceId: '02' },
      autoSend: { enabled: false, content: '00', encoding: 'hex' },
    });

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let latest: any = null;

    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latest.settings.sendEncoding).toBe('utf8');
    expect(localStorage.getItem('wsc.appSettings.v1')).toContain('"vendorId":"1234"');

    await act(async () => {
      root.unmount();
    });
  });

  it('本地配置更新更晚时会触发回推', async () => {
    localStorage.setItem(
      'wsc.appSettings.v1',
      JSON.stringify({ schemaVersion: 1, updatedAt: 300, sendEncoding: 'hex', serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' }, autoSend: { enabled: false, content: '00', encoding: 'hex' } })
    );
    vi.mocked(fetchRemoteAppSettings).mockResolvedValue({
      schemaVersion: 1,
      updatedAt: 200,
      sendEncoding: 'utf8',
      serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' },
      autoSend: { enabled: false, content: '00', encoding: 'hex' },
    });

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);

    await act(async () => {
      root.render(<Harness onUpdate={() => { }} />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(pushRemoteAppSettings).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('远端拉取失败会进入 error', async () => {
    vi.mocked(fetchRemoteAppSettings).mockRejectedValueOnce(new Error('x'));
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let latest: any = null;

    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.syncState).toBe('error');

    await act(async () => {
      root.unmount();
    });
  });

  it('远端回推失败会进入 error', async () => {
    vi.mocked(pushRemoteAppSettings).mockResolvedValueOnce(false);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let latest: any = null;

    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
    });

    await act(async () => {
      latest.setAutoSend({ enabled: true, content: '00', encoding: 'hex' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(latest.syncState).toBe('error');

    await act(async () => {
      root.unmount();
    });
  });

  it('远端回推抛错会进入 error', async () => {
    vi.mocked(pushRemoteAppSettings).mockRejectedValueOnce(new Error('x'));
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let latest: any = null;

    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
    });

    await act(async () => {
      latest.setSerialFilter({ enabled: true, vendorId: '19D1', productId: '0001', interfaceId: '02' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(latest.syncState).toBe('error');

    await act(async () => {
      root.unmount();
    });
  });

  it('远端与本地 updatedAt 相等时保持本地', async () => {
    localStorage.setItem(
      'wsc.appSettings.v1',
      JSON.stringify({ schemaVersion: 1, updatedAt: 100, sendEncoding: 'hex', serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' }, autoSend: { enabled: false, content: '00', encoding: 'hex' } })
    );
    vi.mocked(fetchRemoteAppSettings).mockResolvedValue({
      schemaVersion: 1,
      updatedAt: 100,
      sendEncoding: 'utf8',
      serialFilter: { enabled: true, vendorId: '1234', productId: '0001', interfaceId: '02' },
      autoSend: { enabled: false, content: '00', encoding: 'hex' },
    });

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let latest: any = null;

    await act(async () => {
      root.render(<Harness onUpdate={(v) => (latest = v)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.settings.sendEncoding).toBe('hex');

    await act(async () => {
      root.unmount();
    });
  });
});
