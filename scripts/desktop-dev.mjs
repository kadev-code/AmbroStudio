import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const viteEntry = resolve(projectRoot, 'node_modules/vite/bin/vite.js');
const electronEntry = resolve(projectRoot, 'node_modules/electron/cli.js');
const desktopEntry = resolve(projectRoot, 'desktop-dist/desktop/main.js');
const devUrl = 'http://localhost:3000';

const vite = spawn(process.execPath, [viteEntry, '--host', 'localhost', '--port', '3000'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

async function waitForVite() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(devUrl);
      if (response.ok) return;
    } catch {
      // O servidor ainda está iniciando.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('VITE_DEV_SERVER_TIMEOUT');
}

function stopVite() {
  if (!vite.killed) vite.kill();
}

try {
  await waitForVite();
  const electron = spawn(
    process.execPath,
    [electronEntry, desktopEntry, `--dev-url=${devUrl}`],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  electron.on('exit', (code) => {
    stopVite();
    process.exitCode = code ?? 0;
  });
  process.on('SIGINT', () => {
    electron.kill();
    stopVite();
  });
} catch (error) {
  stopVite();
  console.error(error instanceof Error ? error.message : 'DESKTOP_DEV_FAILED');
  process.exitCode = 1;
}
