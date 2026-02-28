const net = require('node:net');

function normalizePort(value, fallback) {
  const n = Number(String(value ?? '').trim());
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return fallback;
}

async function isPortFree(port, host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort, options = {}) {
  const host = options.host || '127.0.0.1';
  const maxTries = options.maxTries ?? 20;
  const base = normalizePort(startPort, 0);
  if (base <= 0) throw new Error('Invalid startPort');
  for (let i = 0; i < maxTries; i++) {
    const p = base + i;
    const ok = await isPortFree(p, host);
    if (ok) return p;
  }
  throw new Error(`No free port found from ${base} within ${maxTries} tries`);
}

module.exports = {
  normalizePort,
  isPortFree,
  findFreePort,
};
