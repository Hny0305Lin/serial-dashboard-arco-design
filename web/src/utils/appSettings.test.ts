import { describe, it, expect } from 'vitest';
import { normalizeAppSettings, getDefaultAppSettings } from './appSettings';

describe('normalizeAppSettings', () => {
  it('缺省输入返回默认值', () => {
    const d = getDefaultAppSettings();
    const out = normalizeAppSettings(null);
    expect(out.schemaVersion).toBe(1);
    expect(out.sendEncoding).toBe(d.sendEncoding);
    expect(out.serialFilter.vendorId).toBe(d.serialFilter.vendorId);
  });

  it('清洗 VID/PID/MI 并规范化编码', () => {
    const out = normalizeAppSettings({
      sendEncoding: 'utf8',
      serialFilter: { enabled: 1, vendorId: '0x19d1 ', productId: '00-01', interfaceId: 'mi_02' },
      autoSend: { enabled: true, content: 123, encoding: 'utf8' },
      updatedAt: 100,
    });
    expect(out.sendEncoding).toBe('utf8');
    expect(out.serialFilter.enabled).toBe(true);
    expect(out.serialFilter.vendorId).toBe('19D1');
    expect(out.serialFilter.productId).toBe('0001');
    expect(out.serialFilter.interfaceId).toBe('02');
    expect(out.autoSend.content).toBe('123');
    expect(out.autoSend.encoding).toBe('utf8');
    expect(out.updatedAt).toBe(100);
  });

  it('非法输入回退到默认值', () => {
    const out = normalizeAppSettings({
      sendEncoding: 'bad',
      serialFilter: { enabled: false, vendorId: '----', productId: '', interfaceId: null },
      autoSend: { enabled: false, content: null, encoding: 'bad' },
    });
    expect(out.sendEncoding).toBe('hex');
    expect(out.serialFilter.vendorId).toBe('19D1');
    expect(out.serialFilter.productId).toBe('0001');
    expect(out.serialFilter.interfaceId).toBe('02');
    expect(out.autoSend.encoding).toBe('hex');
  });
});
