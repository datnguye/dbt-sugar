import { spawn } from 'node:child_process';

export function openBrowser(url, platform = process.platform, run = spawn) {
  const [command, args] =
    platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = run(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    return false;
  }
  return true;
}
