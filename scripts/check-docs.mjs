import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PNPM_BIN = 'pnpm';

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
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
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

    if (hashPart) {
      const anchors = allAnchorsByFile.get(resolved) ?? new Set();
      if (anchors.size === 0) {
        ok = false;
        fail(`[anchor file not markdown] ${path.relative(repoRoot, mdFileAbs)} -> ${target}`);
        continue;
      }
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
      try {
        const res = await fetchWithTimeout(current, 12_000);
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

async function runWithTimeout(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: repoRoot, stdio: 'inherit', shell: true });
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      try {
        child.kill();
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 1500);
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

async function checkPnpmScriptsReferencedInReadme() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};

  const readmeAbs = path.join(repoRoot, 'README.md');
  const md = await fs.readFile(readmeAbs, 'utf8');

  const found = new Set();
  for (const m of md.matchAll(/\bpnpm\s+run\s+(?<name>[a-zA-Z0-9:_-]+)\b/g)) {
    const name = m.groups?.name;
    if (name) found.add(name);
  }

  let ok = true;
  for (const name of [...found].sort()) {
    if (!scripts[name]) {
      ok = false;
      fail(`[script missing] README references "pnpm run ${name}" but package.json has no such script`);
    }
  }

  const longRunning = new Set(['dev', 'dev:web', 'dev:all', 'start']);
  for (const name of [...found].sort()) {
    if (!scripts[name]) continue;
    process.stdout.write(`\n[run] pnpm run ${name}\n`);
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

  const mdFiles = await listMarkdownFiles(repoRoot);
  const anchorsByFile = new Map();
  for (const abs of mdFiles) {
    const md = await fs.readFile(abs, 'utf8');
    const anchors = buildGitHubAnchors(parseHeadings(md));
    anchorsByFile.set(abs, anchors);
  }

  process.stdout.write('\n[lint] markdownlint-cli2\n');
  const lintCode = await run(PNPM_BIN, ['dlx', 'markdownlint-cli2', 'README.md', 'PROJECT.md', 'docs/**/*.md']);
  if (lintCode !== 0) fail(`[markdownlint] failed with code ${lintCode}`);

  process.stdout.write('\n[check] internal links\n');
  for (const abs of mdFiles) {
    await checkInternalLinks(abs, anchorsByFile);
  }

  process.stdout.write('\n[check] external links\n');
  await checkExternalLinks(mdFiles);

  process.stdout.write('\n[check] pnpm scripts referenced in README\n');
  await checkPnpmScriptsReferencedInReadme();

  if (process.exitCode) {
    process.stdout.write('\n[docs] FAILED\n');
    process.exit(process.exitCode);
  }
  process.stdout.write('\n[docs] OK\n');
}

await main();
