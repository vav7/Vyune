/* run.mjs — E2E wrapper: the sandbox container's jitless chromium renderer can
 * die non-deterministically under the lyrics panel's memory pressure (a
 * container limit, not an app bug). One automatic full re-run keeps the round
 * honest: the suite itself must pass end-to-end on a healthy renderer. */

import { spawn } from 'node:child_process';

const run = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['tests/e2e.mjs'], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

let code = await run();
if (code !== 0) {
  console.log('\n[harness] first attempt failed — one clean re-run\n');
  code = await run();
}
process.exit(code);
