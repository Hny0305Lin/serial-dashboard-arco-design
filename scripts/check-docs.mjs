import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PNPM_BIN = 'pnpm';

function getPnpmEnv() {
  const cacheRoot = path.join(repoRoot, '.cache');
  const env = {
    ...process.env,
    LOCALAPPDATA: cacheRoot,
    APPDATA: cacheRoot,
    TMP: cacheRoot,
    TEMP: cacheRoot
  };
  return { env, cacheRoot };
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.astro') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listMarkdownFiles(abs)));
      continue;
    }
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(abs);
  }
  return out;
}

function stripCodeFences(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    if (inFence) {
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function decodeMarkdownLinkTarget(raw) {
  const s = raw.trim();
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1).trim();
  return s;
}

function parseLinks(md) {
  const text = stripCodeFences(md);
  const links = [];

  const mdLinkRe = /(?<image>!)?\[(?<text>[^\]]*)\]\((?<target>[^)]+)\)/g;
  for (const m of text.matchAll(mdLinkRe)) {
    if (m.groups?.image) continue;
    const target = decodeMarkdownLinkTarget(m.groups?.target ?? '');
    if (!target) continue;
    links.push(target);
  }

  const autolinkRe = /<(?<url>https?:\/\/[^ >]+)>/g;
  for (const m of text.matchAll(autolinkRe)) {
    const url = (m.groups?.url ?? '').trim();
    if (!url) continue;
    links.push(url);
  }

  return links;
}

function extractBashFences(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let inFence = false;
  let fenceLang = '';
  let buf = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceOpen = /^```(\S+)?$/.exec(trimmed);
    if (!inFence && fenceOpen) {
      inFence = true;
      fenceLang = String(fenceOpen[1] || '').toLowerCase();
      buf = [];
      continue;
    }
    if (inFence && trimmed === '```') {
      blocks.push({ lang: fenceLang, content: buf.join('\n') });
      inFence = false;
      fenceLang = '';
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }

  return blocks;
}

function extractPnpmRunScriptsFromBashBlocks(md) {
  const out = new Set();
  const blocks = extractBashFences(md).filter((b) => b.lang === 'bash' || b.lang === 'sh');
  for (const b of blocks) {
    for (const line of b.content.split(/\r?\n/)) {
      const m = /^\s*\$\s*pnpm\s+run\s+(?<name>[a-zA-Z0-9:_-]+)\b/.exec(line);
      const name = m?.groups?.name;
      if (name) out.add(name);
    }
  }
  return out;
}

function parseHeadings(md) {
  const lines = stripCodeFences(md).split(/\r?\n/);
  const headings = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].trim().replace(/\s+#\s*$/, '').trim();
    if (!text) continue;
    headings.push(text);
  }
  return headings;
}

function buildGitHubAnchors(headingTexts) {
  const used = new Map();
  const anchors = new Set();

  for (const raw of headingTexts) {
    let slug = raw
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-')
      .replace(/^-|-$/g, '');

    const prev = used.get(slug) ?? 0;
    used.set(slug, prev + 1);
    if (prev > 0) slug = `${slug}-${prev}`;
    anchors.add(slug);
  }

  return anchors;
}

async function checkInternalLinks(mdFileAbs, allAnchorsByFile) {
  const md = await fs.readFile(mdFileAbs, 'utf8');
  const links = parseLinks(md);
  const mdDir = path.dirname(mdFileAbs);

  let ok = true;

  for (const raw of links) {
    const target = raw.split(/\s+/)[0];
    if (!target) continue;

    if (target.startsWith('file://')) {
      try {
        const u = new URL(target);
        const local = fileURLToPath(u);
        if (!(await fileExists(local))) {
          ok = false;
          fail(`[file missing] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
        }
      } catch {
        ok = false;
        fail(`[file invalid] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
      }
      continue;
    }

    if (target.startsWith('mailto:') || target.startsWith('tel:')) continue;

    if (target.startsWith('#')) {
      const anchor = target.slice(1);
      const anchors = allAnchorsByFile.get(mdFileAbs) ?? new Set();
      if (!anchors.has(anchor)) {
        ok = false;
        fail(`[anchor missing] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
      }
      continue;
    }

    if (target.startsWith('http://') || target.startsWith('https://')) continue;

    const [filePart, hashPart] = target.split('#');
    const resolved = path.resolve(mdDir, filePart);

    if (!(await fileExists(resolved))) {
      ok = false;
      fail(`[file missing] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
      continue;
    }

    if (hashPart && resolved.toLowerCase().endsWith('.md')) {
      const anchors = allAnchorsByFile.get(resolved) ?? new Set();
      if (!anchors.has(hashPart)) {
        ok = false;
        fail(`[anchor missing] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
      }
    }
  }

  return ok;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function checkExternalLinks(allMdFiles) {
  const targets = new Set();
  for (const abs of allMdFiles) {
    const md = await fs.readFile(abs, 'utf8');
    for (const raw of parseLinks(md)) {
      const url = raw.split(/\s+/)[0];
      if (!url) continue;
      if (url.startsWith('http://') || url.startsWith('https://')) targets.add(url);
    }
  }

  const urls = [...targets].sort();
  const concurrency = 6;
  let idx = 0;
  let ok = true;

  async function worker() {
    while (idx < urls.length) {
      const current = urls[idx++];
      let host = '';
      try {
        host = new URL(current).hostname;
      } catch {
        ok = false;
        fail(`[external link] ${current} -> invalid url`);
        continue;
      }
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') continue;
      try {
        let res;
        try {
          res = await fetchWithTimeout(current, 20_000);
        } catch (e) {
          res = await fetchWithTimeout(current, 20_000);
        }
        if (res.status !== 200) {
          ok = false;
          fail(`[external link] ${current} -> status ${res.status}`);
        }
      } catch (e) {
        ok = false;
        fail(`[external link] ${current} -> error ${String(e)}`);
      }
      await sleep(50);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return ok;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: repoRoot, stdio: 'inherit', shell: true, ...opts });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runWithTimeout(bin, args, timeoutMs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: repoRoot, stdio: 'inherit', shell: true, ...opts });
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
        } catch { }
      } else {
        try {
          child.kill('SIGTERM');
        } catch { }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch { }
        }, 1500);
      }
      finished = true;
      resolve({ kind: 'timeout' });
    }, timeoutMs);

    child.on('close', (code) => {
      if (finished) return;
      clearTimeout(timer);
      finished = true;
      resolve({ kind: 'exit', code: code ?? 1 });
    });
  });
}

async function findFreeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function checkPnpmScriptsReferencedInReadme() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};

  const readmeAbs = path.join(repoRoot, 'README.md');
  const md = await fs.readFile(readmeAbs, 'utf8');

  const found = extractPnpmRunScriptsFromBashBlocks(md);

  let ok = true;
  for (const name of [...found].sort()) {
    if (!scripts[name]) {
      ok = false;
      fail(`[script missing] README references "pnpm run ${name}" but package.json has no such script`);
    }
  }

  const longRunning = new Set(['dev', 'dev:web', 'dev:all', 'start']);

  function weight(name) {
    if (name === 'build') return 10;
    if (name === 'test') return 20;
    if (name.startsWith('perf:')) return 30;
    if (name === 'diag:com') return 40;
    if (name === 'clean:serial-logs') return 50;
    if (name === 'start') return 60;
    if (name.startsWith('dev')) return 90;
    return 70;
  }

  const ordered = [...found].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));
  for (const name of ordered) {
    if (!scripts[name]) continue;
    process.stdout.write(`\n[run] pnpm run ${name}\n`);
    if (name === 'dev:all') {
      const lockPath = path.join(repoRoot, '.cache', `devall-${Date.now()}-${Math.random().toString(16).slice(2)}.lock`);
      const code = await run(PNPM_BIN, ['run', name], {
        env: {
          ...process.env,
          DEVALL_DRY_RUN: '1',
          DEVALL_PORT_MODE: 'increment',
          DEVALL_LOCK_PATH: lockPath,
        },
      });
      if (code !== 0) {
        ok = false;
        fail(`[script failed] pnpm run ${name} exited with code ${code}`);
      }
      continue;
    }

    if (name === 'start') {
      const port = await findFreeTcpPort();
      const dataDir = path.join(repoRoot, '.cache', `start-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      await fs.mkdir(dataDir, { recursive: true });
      const r = await runWithTimeout(PNPM_BIN, ['run', name], 8_000, {
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      });
      if (r.kind === 'exit' && r.code !== 0) {
        ok = false;
        fail(`[script failed] pnpm run ${name} exited with code ${r.code}`);
      }
      continue;
    }

    if (longRunning.has(name)) {
      const r = await runWithTimeout(PNPM_BIN, ['run', name], 8_000);
      if (r.kind === 'exit' && r.code !== 0) {
        ok = false;
        fail(`[script failed] pnpm run ${name} exited with code ${r.code}`);
      }
      continue;
    }

    const code = await run(PNPM_BIN, ['run', name]);
    if (code !== 0) {
      ok = false;
      fail(`[script failed] pnpm run ${name} exited with code ${code}`);
    }
  }

  return ok;
}

async function main() {
  process.stdout.write(`[docs] repoRoot=${repoRoot}\n`);

  const checkAll = process.argv.includes('--all');
  const skipExternal = process.argv.includes('--skip-external');
  const pnpmEnv = getPnpmEnv();
  await fs.mkdir(pnpmEnv.cacheRoot, { recursive: true });

  const mdFiles = checkAll ? await listMarkdownFiles(repoRoot) : [path.join(repoRoot, 'README.md')];
  const anchorsByFile = new Map();
  for (const abs of mdFiles) {
    const md = await fs.readFile(abs, 'utf8');
    const anchors = buildGitHubAnchors(parseHeadings(md));
    anchorsByFile.set(abs, anchors);
  }

  process.stdout.write('\n[lint] markdownlint-cli2\n');
  const lintTargets = checkAll ? ['README.md', 'PROJECT.md', 'docs/**/*.md'] : ['README.md'];
  const lintCode = await run(
    PNPM_BIN,
    ['dlx', 'markdownlint-cli2', '--config', '.markdownlint-cli2.jsonc', ...lintTargets],
    { env: pnpmEnv.env }
  );
  if (lintCode !== 0) fail(`[markdownlint] failed with code ${lintCode}`);

  process.stdout.write('\n[check] internal links\n');
  for (const abs of mdFiles) {
    await checkInternalLinks(abs, anchorsByFile);
  }

  process.stdout.write('\n[check] external links\n');
  if (skipExternal) process.stdout.write('[external link] skipped\n');
  else await checkExternalLinks(mdFiles);

  process.stdout.write('\n[check] pnpm scripts referenced in README\n');
  await checkPnpmScriptsReferencedInReadme();

  if (process.exitCode) {
    process.stdout.write('\n[docs] FAILED\n');
    process.exit(process.exitCode);
  }
  process.stdout.write('\n[docs] OK\n');
}

await main();
