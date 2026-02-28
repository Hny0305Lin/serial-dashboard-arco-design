import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAppSettings } from './appSettingsStorage';

describe('appSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
  });

  it('首次加载会写入新 key', () => {
    const s = loadAppSettings();
    expect(s.schemaVersion).toBe(1);
    expect(localStorage.getItem('wsc.appSettings.v1')).toBeTruthy();
  });

  it('可从旧 key 迁移', () => {
    localStorage.setItem('sendEncoding', 'utf8');
    localStorage.setItem('serialFilterConfig', JSON.stringify({ enabled: true, vendorId: '19d1', productId: '0001', interfaceId: '02' }));
    localStorage.setItem('autoSendConfig', JSON.stringify({ enabled: true, content: 'AA', encoding: 'hex' }));

    const s = loadAppSettings();
    expect(s.sendEncoding).toBe('utf8');
    expect(s.serialFilter.enabled).toBe(true);
    expect(s.autoSend.enabled).toBe(true);
    expect(localStorage.getItem('wsc.appSettings.v1')).toBeTruthy();
  });

  it('新 key 解析失败会回退到默认值并重写', () => {
    localStorage.setItem('wsc.appSettings.v1', '{bad json');
    const s = loadAppSettings();
    expect(s.schemaVersion).toBe(1);
    expect(s.sendEncoding).toBe('hex');
    expect(localStorage.getItem('wsc.appSettings.v1')).toContain('"schemaVersion":1');
  });

  it('localStorage 不可用时返回默认值', () => {
    const origSetItem = localStorage.setItem.bind(localStorage);
    (localStorage as any).setItem = () => {
      throw new Error('quota');
    };
    const s = loadAppSettings();
    expect(s.schemaVersion).toBe(1);
    (localStorage as any).setItem = origSetItem;
  });
});
