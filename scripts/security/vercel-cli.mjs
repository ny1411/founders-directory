import { existsSync } from 'node:fs';
import { join } from 'node:path';

// npm's Windows `vercel.cmd` shim is not an executable that Node's spawnSync
// can launch directly. Run the adjacent CLI JavaScript with Node instead, so
// JSON conditions remain individual arguments without a shell.
export function vercelInvocation({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return { command: 'vercel', prefix: [] };
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of pathValue.split(';').filter(Boolean)) {
    const shim = join(directory, 'vercel.cmd');
    const cli = join(directory, 'node_modules', 'vercel', 'dist', 'vc.js');
    if (exists(shim) && exists(cli)) return { command: execPath, prefix: [cli] };
  }
  throw new Error('Vercel CLI npm installation not found on PATH. Run `npm install -g vercel`, then reopen this terminal.');
}
