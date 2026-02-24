import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFrames, parseFrameToRecord } from '../../services/forwarding/frame';

test('extractFrames line lf', () => {
  const rule = { mode: 'line', lineDelimiter: 'lf', maxFrameBytes: 2048 } as any;
  const { frames, rest } = extractFrames(Buffer.alloc(0), Buffer.from('a\nb\nc', 'utf8'), rule);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].toString('utf8'), 'a');
  assert.equal(frames[1].toString('utf8'), 'b');
  assert.equal(rest.toString('utf8'), 'c');
});

test('extractFrames fixed', () => {
  const rule = { mode: 'fixed', fixedLengthBytes: 2, maxFrameBytes: 2048 } as any;
  const { frames, rest } = extractFrames(Buffer.alloc(0), Buffer.from([1, 2, 3, 4, 5]), rule);
  assert.deepEqual(frames.map(b => Array.from(b)), [[1, 2], [3, 4]]);
  assert.deepEqual(Array.from(rest), [5]);
});

test('extractFrames aa55', () => {
  const rule = { mode: 'aa55', maxFrameBytes: 2048 } as any;
  const payload = Buffer.from([0x01, 0x02]);
  const len = Buffer.from([payload.length]);
  const cmd = Buffer.from([0x10]);
  const header = Buffer.from([0xaa]);
  const footer = Buffer.from([0x55]);
  const checksumVal = (0xaa + payload.length + 0x10 + payload[0] + payload[1]) & 0xff;
  const checksum = Buffer.from([checksumVal]);
  const pkt = Buffer.concat([header, len, cmd, payload, checksum, footer]);
  const { frames } = extractFrames(Buffer.alloc(0), pkt, rule);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].toString('hex'), pkt.toString('hex'));
});

test('parseFrameToRecord text-regex groups', () => {
  const frame = Buffer.from('DEV001,TEMP,23.5', 'utf8');
  const rec = parseFrameToRecord(frame, {
    portPath: 'COM3',
    parse: { mode: 'text-regex', regex: '(?<deviceId>[^,]+),(?<dataType>[^,]+),(?<payload>.*)', regexFlags: '' }
  });
  assert.ok(rec);
  assert.equal(rec!.deviceId, 'DEV001');
  assert.equal(rec!.dataType, 'TEMP');
  assert.equal(rec!.payloadText, '23.5');
  assert.equal(rec!.portPath, 'COM3');
  assert.ok(rec!.hash);
});
