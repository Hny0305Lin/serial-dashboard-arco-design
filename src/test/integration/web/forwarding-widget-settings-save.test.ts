import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function findRepoRoot(fromDir: string) {
  let dir = fromDir;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    const scriptsDir = path.join(dir, 'scripts');
    const webPkg = path.join(dir, 'web', 'package.json');
    if (fs.existsSync(pkg) && fs.existsSync(scriptsDir) && fs.existsSync(webPkg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`repo root not found from ${fromDir}`);
}

function loadCjsExportsFromTsFile(filePath: string): any {
  const src = fs.readFileSync(filePath, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true
    },
    fileName: filePath
  });
  const mod = { exports: {} as any };
  const context = vm.createContext({
    module: mod,
    exports: mod.exports,
    require,
    __dirname: path.dirname(filePath),
    __filename: filePath
  });
  vm.runInContext(out.outputText, context, { filename: filePath });
  return mod.exports;
}

function normalizePath(p?: string) {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

test('ForwardingWidget 保存：未打开「渠道」Tab 时不应清空 channels', () => {
  const repoRoot = findRepoRoot(__dirname);
  const filePath = path.join(repoRoot, 'web', 'src', 'components', 'Monitor', 'forwardingConfigDraft.ts');
  const { buildForwardingNextConfigForWidget } = loadCjsExportsFromTsFile(filePath);

  const base = {
    version: 1,
    enabled: true,
    sources: [],
    channels: [
      { id: 'a', ownerWidgetId: 'w1', enabled: true, name: 'A' },
      { id: 'b', ownerWidgetId: 'w2', enabled: true, name: 'B' }
    ]
  };

  const { next } = buildForwardingNextConfigForWidget({
    base,
    widgetId: 'w1',
    values: { enabled: true },
    normalizePath
  });

  assert.equal(next.channels.length, 2);
  assert.ok(next.channels.some((c: any) => c.id === 'a' && c.ownerWidgetId === 'w1'));
  assert.ok(next.channels.some((c: any) => c.id === 'b' && c.ownerWidgetId === 'w2'));
});

test('ForwardingWidget 保存：未打开「数据源」Tab 时不应丢失 sources（含串口端口）', () => {
  const repoRoot = findRepoRoot(__dirname);
  const filePath = path.join(repoRoot, 'web', 'src', 'components', 'Monitor', 'forwardingConfigDraft.ts');
  const { buildForwardingNextConfigForWidget } = loadCjsExportsFromTsFile(filePath);

  const base = {
    version: 1,
    enabled: true,
    sources: [
      { ownerWidgetId: 'w1', enabled: true, portPath: 'COM3', framing: { mode: 'line' }, parse: { mode: 'json' } },
      { ownerWidgetId: 'w2', enabled: true, portPath: 'COM7', framing: { mode: 'line' }, parse: { mode: 'json' } }
    ],
    channels: []
  };

  const { next } = buildForwardingNextConfigForWidget({
    base,
    widgetId: 'w1',
    values: { enabled: true },
    normalizePath
  });

  assert.equal(next.sources.length, 2);
  const s1 = next.sources.find((s: any) => String(s.ownerWidgetId) === 'w1');
  assert.equal(s1.portPath, 'COM3');
});

test('ForwardingWidget 保存：显式提交空 channels 表示清空 owned channels（不会影响 others）', () => {
  const repoRoot = findRepoRoot(__dirname);
  const filePath = path.join(repoRoot, 'web', 'src', 'components', 'Monitor', 'forwardingConfigDraft.ts');
  const { buildForwardingNextConfigForWidget } = loadCjsExportsFromTsFile(filePath);

  const base = {
    version: 1,
    enabled: true,
    sources: [],
    channels: [
      { id: 'a', ownerWidgetId: 'w1', enabled: true, name: 'A' },
      { id: 'b', ownerWidgetId: 'w2', enabled: true, name: 'B' }
    ]
  };

  const { next } = buildForwardingNextConfigForWidget({
    base,
    widgetId: 'w1',
    values: { enabled: false, channels: [] },
    normalizePath
  });

  assert.equal(next.channels.length, 1);
  assert.equal(next.channels[0].id, 'b');
});
