const { spawn, execSync, spawnSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { acquireInstanceLock } = require('./instance-lock');
const { normalizePort, isPortFree, findFreePort } = require('./port-guard');

const EXIT_PORT_IN_USE = 110;
const DEFAULT_REGISTRY = 'https://registry.npmmirror.com/';

function getNodeEnvConfigPath() {
  return path.resolve(__dirname, '..', 'node-env.json');
}

function buildNodeEnvTemplate() {
  return {
    __comment: [
      '这是 dev:all 的运行时环境配置模板（JSON 不支持真正的注释，所以用 __comment 字段承载说明）。',
      '适用于宝塔面板 Node.js 版本管理器：切换 Node 版本后，只需更新本文件，无需改代码。',
      '如何获取路径：宝塔面板 -> 软件商店 -> Node.js 版本管理器 -> 已安装版本，复制对应版本的 bin 目录下的可执行文件路径。',
      '示例：/www/server/nodejs/v22.21.1/bin/node  /www/server/nodejs/v22.21.1/bin/pnpm  /www/server/nodejs/v22.21.1/bin/npm',
      '建议把 envPath 配成 bin 目录，例如：/www/server/nodejs/v22.21.1/bin',
    ].join('\n'),
    registry: DEFAULT_REGISTRY,
    nodePath: '',
    pnpmPath: '',
    npmPath: '',
    envPath: '',
    NODE_HOME: '',
    PNPM_HOME: '',
    NPM_CONFIG_CACHE: '',
    NPM_CONFIG_INIT_MODULE: '',
  };
}

function ensureNodeEnvConfigFile(configPath) {
  if (fs.existsSync(configPath)) return false;
  const template = buildNodeEnvTemplate();
  try {
    fs.writeFileSync(configPath, JSON.stringify(template, null, 2) + os.EOL, 'utf8');
    return true;
  } catch (e) {
    console.warn(`[dev:all] 未找到 node-env.json，且无法自动写入模板：${String(e?.message || e)}`);
    return false;
  }
}

function isExecutable(filePath) {
  try {
    if (process.platform === 'win32') return fs.existsSync(filePath);
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  const p = String(dirPath || '').trim();
  if (!p) return;
  try {
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (!st.isDirectory()) throw new Error('不是目录');
      return;
    }
    fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    throw new Error(`node-env.json 配置错误：目录不可用：${p}（${String(e?.message || e)}）`);
  }
}

function normalizeRegistry(registry, configPath) {
  const v = String(registry || '').trim();
  if (!v) return DEFAULT_REGISTRY;
  if (v.includes('`')) {
    throw new Error(
      `node-env.json 配置错误：registry 里包含反引号 \`，请只填写纯 URL。\n` +
      `示例：https://registry.npmmirror.com/\n` +
      `文件：${configPath}`,
    );
  }
  if (!/^https?:\/\//i.test(v)) {
    throw new Error(
      `node-env.json 配置错误：registry 必须以 http:// 或 https:// 开头：${v}\n` +
      `示例：https://registry.npmmirror.com/\n` +
      `文件：${configPath}`,
    );
  }
  return v;
}

function applyEnvPath(extraPath) {
  const v = String(extraPath || '').trim();
  if (!v) return;
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const cur = String(process.env.PATH || '');
  if (!cur) {
    process.env.PATH = v;
    return;
  }
  if (cur.split(delimiter).includes(v)) return;
  process.env.PATH = `${v}${delimiter}${cur}`;
}

function loadNodeEnvConfig() {
  const configPath = getNodeEnvConfigPath();
  const created = ensureNodeEnvConfigFile(configPath);
  if (created) {
    console.warn(`[dev:all] 未找到 node-env.json，已自动生成模板：${configPath}`);
    console.warn('[dev:all] 请按实际环境填写后重新运行；本次将使用系统默认环境。');
    return { configPath, createdTemplate: created, config: null };
  }
  if (!fs.existsSync(configPath)) {
    console.warn(`[dev:all] 未找到 node-env.json（路径：${configPath}），将使用系统默认环境。`);
    return { configPath, createdTemplate: created, config: null };
  }
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    throw new Error(`读取 node-env.json 失败：${String(e?.message || e)}（路径：${configPath}）`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`解析 node-env.json 失败：请确认是合法 JSON（路径：${configPath}）`);
  }
  const config = cfg && typeof cfg === 'object' ? cfg : null;
  if (!config) {
    throw new Error(`node-env.json 内容无效：期望为 JSON 对象（路径：${configPath}）`);
  }
  return { configPath, createdTemplate: created, config };
}

function applyNodeEnv(config, configPath) {
  if (!config) return;
  if (typeof config.envPath === 'string' && config.envPath.trim()) applyEnvPath(config.envPath);
  process.env.npm_config_registry = normalizeRegistry(config.registry, configPath);
  if (typeof config.NODE_HOME === 'string' && config.NODE_HOME.trim()) process.env.NODE_HOME = config.NODE_HOME.trim();
  if (typeof config.PNPM_HOME === 'string' && config.PNPM_HOME.trim()) process.env.PNPM_HOME = config.PNPM_HOME.trim();
  if (typeof config.NPM_CONFIG_CACHE === 'string' && config.NPM_CONFIG_CACHE.trim()) process.env.npm_config_cache = config.NPM_CONFIG_CACHE.trim();
  if (typeof config.NPM_CONFIG_INIT_MODULE === 'string' && config.NPM_CONFIG_INIT_MODULE.trim()) process.env.npm_config_init_module = config.NPM_CONFIG_INIT_MODULE.trim();

  ensureDir(config.NODE_HOME);
  ensureDir(config.PNPM_HOME);
  ensureDir(config.envPath);
  ensureDir(config.NPM_CONFIG_CACHE);

  if (config.NPM_CONFIG_INIT_MODULE && !fs.existsSync(String(config.NPM_CONFIG_INIT_MODULE))) {
    throw new Error(
      `node-env.json 配置错误：NPM_CONFIG_INIT_MODULE 文件不存在：${String(config.NPM_CONFIG_INIT_MODULE)}。\n` +
      `请在宝塔面板 Node.js 版本管理器中确认 init-module 路径并更新 ${configPath}`,
    );
  }

  const nodeDir = typeof config.nodePath === 'string' ? path.dirname(config.nodePath) : '';
  const pnpmDir = typeof config.pnpmPath === 'string' ? path.dirname(config.pnpmPath) : '';
  const npmDir = typeof config.npmPath === 'string' ? path.dirname(config.npmPath) : '';
  applyEnvPath(npmDir);
  applyEnvPath(pnpmDir);
  applyEnvPath(nodeDir);

  if (config.nodePath && !isExecutable(config.nodePath)) {
    throw new Error(
      `node-env.json 配置错误：nodePath 不存在或不可执行：${String(config.nodePath)}。\n` +
      `请在宝塔面板 Node.js 版本管理器中复制实际 node 路径并更新 ${configPath}`,
    );
  }
  if (config.pnpmPath && !isExecutable(config.pnpmPath)) {
    throw new Error(
      `node-env.json 配置错误：pnpmPath 不存在或不可执行：${String(config.pnpmPath)}。\n` +
      `请在宝塔面板 Node.js 版本管理器中复制实际 pnpm 路径并更新 ${configPath}`,
    );
  }
  if (config.npmPath && !isExecutable(config.npmPath)) {
    throw new Error(
      `node-env.json 配置错误：npmPath 不存在或不可执行：${String(config.npmPath)}。\n` +
      `请在宝塔面板 Node.js 版本管理器中复制实际 npm 路径并更新 ${configPath}`,
    );
  }
}

function getPnpmInvoker(config) {
  if (process.platform === 'win32') {
    const pnpmCmd = (typeof config?.pnpmPath === 'string' && config.pnpmPath.trim()) ? config.pnpmPath.trim() : 'pnpm';
    return { command: pnpmCmd, args: [] };
  }

  const nodePath = (typeof config?.nodePath === 'string' && config.nodePath.trim()) ? config.nodePath.trim() : '';
  const pnpmPath = (typeof config?.pnpmPath === 'string' && config.pnpmPath.trim()) ? config.pnpmPath.trim() : '';
  if (nodePath && pnpmPath) return { command: nodePath, args: [pnpmPath] };
  if (pnpmPath) return { command: pnpmPath, args: [] };
  return { command: 'pnpm', args: [] };
}

function getDefaultLockPath() {
  return path.join(os.tmpdir(), 'serialport-devall.lock');
}

function findListenerPids(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const lines = out.split(/\r?\n/);
      const pids = new Set();
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        if (!s.includes(`:${port}`)) continue;
        if (!s.toUpperCase().includes('LISTENING')) continue;
        const parts = s.split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid) pids.add(pid);
      }
      return [...pids];
    } catch (e) {
      return [];
    }
  }
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function killProcessTree(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${n} /T /F`, { stdio: 'ignore' });
    } catch (e) { }
    return;
  }
  try {
    process.kill(n, 'SIGTERM');
  } catch (e) { }
  try {
    execSync(`pkill -TERM -P ${n}`, { stdio: 'ignore' });
  } catch (e) { }
}

function run(name, command, args, extraEnv) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(extraEnv || {}) },
  });
  child.on('exit', (code, signal) => {
    if (signal) console.log(`[dev:all] ${name} exited with signal ${signal}`);
    else console.log(`[dev:all] ${name} exited with code ${code}`);
  });
  return child;
}

function runSync(name, command, args, extraEnv) {
  const out = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(extraEnv || {}) },
  });
  if (out.error) {
    throw out.error;
  }
  if (typeof out.status === 'number' && out.status !== 0) {
    throw new Error(`[dev:all] ${name} failed with code ${out.status}`);
  }
  return out;
}

function pathExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function getBinPath(projectDir, binName) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return path.join(projectDir, 'node_modules', '.bin', `${binName}${ext}`);
}

function ensureDepsInstalled(pnpm, opts) {
  const rootDir = path.resolve(__dirname, '..');
  const webDir = path.join(rootDir, 'web');
  const backendMode = String(opts?.backendMode || 'dev').trim();

  const missingDirs = [];
  if (!pathExists(path.join(rootDir, 'node_modules'))) missingDirs.push('node_modules（后端）');
  if (!pathExists(path.join(webDir, 'node_modules'))) missingDirs.push('web/node_modules（前端）');

  const missingBins = [];
  if (backendMode !== 'prod') {
    if (!pathExists(getBinPath(rootDir, 'nodemon'))) missingBins.push('nodemon（后端 dev 依赖）');
    if (!pathExists(getBinPath(rootDir, 'ts-node'))) missingBins.push('ts-node（后端 dev 依赖）');
  }
  if (!pathExists(getBinPath(webDir, 'astro'))) missingBins.push('astro（前端 dev 依赖）');

  if (!missingDirs.length && !missingBins.length) return true;

  const hints = [];
  hints.push('[dev:all] 依赖未安装或不完整，导致启动失败。');
  if (missingDirs.length) hints.push(`[dev:all] 缺少目录：${missingDirs.join('、')}`);
  if (missingBins.length) hints.push(`[dev:all] 缺少命令：${missingBins.join('、')}`);
  hints.push('[dev:all] 请先安装依赖：');
  hints.push(`[dev:all]   1) 在项目根目录执行：${[pnpm.command, ...pnpm.args, 'install'].join(' ')}`);
  hints.push(`[dev:all]   2) 在 web/ 目录执行：${[pnpm.command, ...pnpm.args, '-C', 'web', 'install'].join(' ')}`);
  console.error(hints.join(os.EOL));
  return false;
}

function getNodeInvoker(config) {
  const nodePath = (typeof config?.nodePath === 'string' && config.nodePath.trim()) ? config.nodePath.trim() : '';
  if (nodePath) return { command: nodePath, args: [] };
  return { command: 'node', args: [] };
}

function ensureBackendBuild(pnpm) {
  const rootDir = path.resolve(__dirname, '..');
  const distEntry = path.join(rootDir, 'dist', 'index.js');
  if (pathExists(distEntry)) return;
  runSync('backend:build', pnpm.command, [...pnpm.args, 'run', 'build']);
  if (!pathExists(distEntry)) {
    throw new Error(`[dev:all] backend build finished but dist entry not found: ${distEntry}`);
  }
}

async function main() {
  const lockFilePath = String(process.env.DEVALL_LOCK_PATH || '').trim() || getDefaultLockPath();
  let lock;
  try {
    lock = acquireInstanceLock(lockFilePath);
  } catch (e) {
    if (e && e.code === 'ELOCKED') {
      console.error(`[dev:all] Another dev:all instance is running (pid=${e.lockedPid}).`);
      process.exit(EXIT_PORT_IN_USE);
    }
    throw e;
  }

  const { configPath, config } = loadNodeEnvConfig();
  applyNodeEnv(config, configPath);
  if (!String(process.env.npm_config_registry || '').trim()) process.env.npm_config_registry = DEFAULT_REGISTRY;

  const pnpm = getPnpmInvoker(config);
  const backendMode = String(process.env.DEVALL_BACKEND_MODE || 'dev').trim();
  if (!ensureDepsInstalled(pnpm, { backendMode })) {
    lock.release();
    process.exit(1);
  }

  if (backendMode === 'prod') {
    ensureBackendBuild(pnpm);
  }

  const portMode = String(process.env.DEVALL_PORT_MODE || 'strict').trim();
  const requestedBackendPort = normalizePort(process.env.BACKEND_PORT || process.env.PORT, 9011);
  const requestedWebPort = normalizePort(process.env.WEB_PORT, 9010);

  let backendPort = requestedBackendPort;
  let webPort = requestedWebPort;

  if (portMode === 'increment') {
    backendPort = await findFreePort(requestedBackendPort, { maxTries: 50 });
    webPort = await findFreePort(requestedWebPort, { maxTries: 50 });
  } else {
    const backendOk = await isPortFree(backendPort);
    const webOk = await isPortFree(webPort);
    if (!backendOk || !webOk) {
      if (!backendOk) {
        const pids = findListenerPids(backendPort);
        console.error(`[dev:all] Backend port in use: ${backendPort}${pids.length ? ` (pid=${pids.join(',')})` : ''}`);
      }
      if (!webOk) {
        const pids = findListenerPids(webPort);
        console.error(`[dev:all] Web port in use: ${webPort}${pids.length ? ` (pid=${pids.join(',')})` : ''}`);
      }
      lock.release();
      process.exit(EXIT_PORT_IN_USE);
    }
  }

  if (String(process.env.DEVALL_DRY_RUN || '').trim() === '1') {
    console.log(`[dev:all] DRY_RUN ok. BACKEND_PORT=${backendPort} WEB_PORT=${webPort}`);
    lock.release();
    process.exit(0);
  }

  let shuttingDown = false;
  let backend;
  let web;

  function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (backend?.pid) killProcessTree(backend.pid);
    } catch (e) { }
    try {
      if (web?.pid) killProcessTree(web.pid);
    } catch (e) { }
    try {
      lock.release();
    } catch (e) { }
    if (typeof exitCode === 'number') process.exit(exitCode);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  if (backendMode === 'prod') {
    const node = getNodeInvoker(config);
    const backendEnv = {
      PORT: String(backendPort),
      BACKEND_PORT: String(backendPort),
      ...(String(process.env.NODE_ENV || '').trim() ? {} : { NODE_ENV: 'production' }),
    };
    backend = run('backend', node.command, [...node.args, path.join('dist', 'index.js')], backendEnv);
  } else {
    backend = run('backend', pnpm.command, [...pnpm.args, 'run', 'dev'], {
      PORT: String(backendPort),
      BACKEND_PORT: String(backendPort),
    });
  }

  web = run(
    'web',
    pnpm.command,
    [...pnpm.args, '-C', 'web', 'run', 'dev', '--', '--port', String(webPort)],
    {
      WEB_PORT: String(webPort),
      BACKEND_PORT: String(backendPort),
      PUBLIC_BACKEND_PORT: String(backendPort),
    },
  );

  backend.on('exit', () => shutdown(0));
  web.on('exit', () => shutdown(0));
}

main().catch((e) => {
  console.error('[dev:all] fatal:', e);
  process.exit(1);
});
