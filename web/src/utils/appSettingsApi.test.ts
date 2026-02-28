import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchRemoteAppSettings, pushRemoteAppSettings } from './appSettingsApi';

describe('appSettingsApi', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = origFetch as any;
  });

  it('fetchRemoteAppSettings: ok 响应返回规范化数据', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: {
            schemaVersion: 1,
            updatedAt: 1,
            sendEncoding: 'utf8',
            serialFilter: { enabled: true, vendorId: '19d1', productId: '0001', interfaceId: '02' },
            autoSend: { enabled: false, content: '00', encoding: 'hex' },
          },
        }),
      } as any;
    }) as any;

    const out = await fetchRemoteAppSettings();
    expect(out?.sendEncoding).toBe('utf8');
    expect(out?.serialFilter.vendorId).toBe('19D1');
  });

  it('fetchRemoteAppSettings: 非 ok 返回 null', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false }) as any) as any;
    const out = await fetchRemoteAppSettings();
    expect(out).toBeNull();
  });

  it('pushRemoteAppSettings: 返回 ok 状态', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true }) as any) as any;
    const ok = await pushRemoteAppSettings({
      schemaVersion: 1,
      updatedAt: 1,
      sendEncoding: 'hex',
      serialFilter: { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' },
      autoSend: { enabled: false, content: '00', encoding: 'hex' },
    });
    expect(ok).toBe(true);
  });
});
