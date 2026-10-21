import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

if (process.platform === 'win32') {
  throw new Error('Run Firestore rules tests in WSL or Linux/macOS; the npm.cmd launcher is not supported.');
}

// Deliberately do not inherit service-account paths, real Firebase project IDs,
// API keys, or CLI tokens. The demo project cannot reach production resources.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:FIREBASE|FIRESTORE|GCLOUD|GOOGLE|GCP|CLOUDSDK|NEXT_PUBLIC_FIREBASE)/i.test(key),
));
env.CI = 'true';
env.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true';

const result = spawnSync('npm', [
  'exec', '--yes', '--package=firebase-tools@15.34.0', '--',
  'firebase', 'emulators:exec',
  '--project', 'demo-founders-security',
  '--config', 'firebase.json',
  '--only', 'firestore',
  'node --test scripts/security/firestore-rules.test.mjs',
], { cwd: root, env, stdio: 'inherit', timeout: 300_000, detached: true });

if (result.error) {
  // npm may have spawned CLI/Java descendants. Terminate this isolated process
  // group on timeout instead of leaving an emulator listening after failure.
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  }
  throw new Error('Unable to run the isolated Firestore emulator tests.', { cause: result.error });
}
process.exitCode = result.status ?? 1;
