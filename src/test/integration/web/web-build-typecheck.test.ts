import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

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

test('ForwardingWidget has no implicit any parameters (type safety)', () => {
  const repoRoot = findRepoRoot(__dirname);
  const webRoot = path.join(repoRoot, 'web');
  const configPath = path.join(webRoot, 'tsconfig.json');
  assert.ok(fs.existsSync(configPath), 'web tsconfig.json not found');

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.ok(!read.error, ts.flattenDiagnosticMessageText(read.error?.messageText || '', '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, webRoot);

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const targetFile = path.join(webRoot, 'src', 'components', 'Monitor', 'ForwardingWidget.tsx');
  const bad = diagnostics.filter((d) => {
    const fileName = d.file?.fileName ? path.normalize(d.file.fileName) : '';
    if (path.normalize(targetFile) !== fileName) return false;
    return d.code === 7006 || d.code === 7031;
  });

  if (bad.length > 0) {
    const msg = bad
      .map((d) => {
        const fileName = d.file?.fileName || '';
        const pos = d.file && typeof d.start === 'number' ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        const loc = pos ? `${pos.line + 1}:${pos.character + 1}` : '';
        const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        return `${fileName}${loc ? `:${loc}` : ''} ts(${d.code}): ${text}`;
      })
      .join('\n');
    assert.fail(msg);
  }
});
