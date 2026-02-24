const { spawn } = require('child_process');

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[dev:all] ${name} exited with signal ${signal}`);
    } else {
      console.log(`[dev:all] ${name} exited with code ${code}`);
    }
  });
  return child;
}

const backend = run('backend', 'pnpm', ['dev']);
const web = run('web', 'pnpm', ['-C', 'web', 'dev']);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { backend.kill(); } catch (e) {}
  try { web.kill(); } catch (e) {}
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

backend.on('exit', () => {
  shutdown();
});
web.on('exit', () => {
  shutdown();
});

