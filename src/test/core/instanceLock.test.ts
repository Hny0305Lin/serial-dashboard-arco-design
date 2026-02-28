import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { acquireInstanceLock } from '../../core/instanceLock';

function tmpFilePath(prefix: string) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `${prefix}-${id}.json`);
}

test('acquireInstanceLock is exclusive and releasable', () => {
  const lockPath = tmpFilePath('server-lock');
  const a = acquireInstanceLock(lockPath);
  assert.ok(fs.existsSync(lockPath));

  assert.throws(() => acquireInstanceLock(lockPath), (e: any) => e && e.code === 'ELOCKED');

  a.release();
  assert.ok(!fs.existsSync(lockPath));

  const b = acquireInstanceLock(lockPath);
  b.release();
});
