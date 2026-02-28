import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMixedBytes } from '../../../core/mixedEncoding';

test('decodeMixedBytes: 标准 AT 响应保持原样', () => {
  const buf = Buffer.from('+SOCSQ: 1,2,3\r\nOK\r\n', 'utf8');
  const r = decodeMixedBytes(buf);
  assert.equal(r.text, '+SOCSQ: 1,2,3\r\nOK\r\n');
  assert.equal(r.stats.invalidBytes, 0);
  assert.equal(r.stats.controlBytes, 0);
});

test('decodeMixedBytes: 控制字符按配置转义', () => {
  const buf = Buffer.from([0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x4f, 0x4b]);
  const r = decodeMixedBytes(buf, { controlStrategy: 'escape' });
  assert.ok(r.text.includes('\\u001B'));
  assert.ok(r.text.endsWith('OK'));
});

test('decodeMixedBytes: 高字节位数据可按策略保留', () => {
  const buf = Buffer.from([0x41, 0xff, 0x42]);
  const r = decodeMixedBytes(buf, { invalidByteStrategy: 'escape' });
  assert.equal(r.text, 'A\\xFFB');
  assert.equal(r.stats.invalidBytes, 1);
});

test('decodeMixedBytes: 真实样本中保留 +SOCSQ 与中文并避免替换字符', () => {
  const rawBytesBase64 =
    'JS4qcwAAAAA+AAAAVy91c2VyLnV0aWxfbm90aWZ5LnBvbGwJbW9iaWxlLnN0YXR1cwk1Cee9kee7nOW3suazqOWGjCzmvKvmuLgAAH5+ITQEAAAAAABMatIIK1NPQ1NROiAlZCwlZCwlZAAAAACl////9////xkAAAB+frVSBAAAAAAATOpz';
  const buf = Buffer.from(rawBytesBase64, 'base64');
  const r = decodeMixedBytes(buf);
  assert.ok(r.text.includes('+SOCSQ:'), 'should keep +SOCSQ token');
  assert.ok(r.text.includes('网络已注册,漫游'), 'should keep UTF-8 chinese');
  assert.ok(!r.text.includes('�'), 'should not produce replacement char');
  assert.ok(r.stats.invalidBytes > 0 || r.stats.binaryBytes > 0, 'should detect non-text bytes');
});

test('decodeMixedBytes: 破损 UTF-8 不抛异常且可观察', () => {
  const buf = Buffer.from([0xe4, 0xb8, 0x41]);
  const r = decodeMixedBytes(buf);
  assert.ok(r.text.includes('\\xE4'));
  assert.ok(r.text.includes('\\xB8'));
  assert.ok(r.text.endsWith('A'));
});

test('decodeMixedBytes: 输出可被截断避免日志爆炸', () => {
  const buf = Buffer.alloc(200_000, 0x00);
  const r = decodeMixedBytes(buf, { maxOutputChars: 2000 });
  assert.ok(r.text.startsWith('<bin:200000B:'), 'should summarize binary runs');
  assert.ok(r.text.length < 2000, 'should keep output bounded');
});
