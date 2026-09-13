// Vite targets are audited from dist/, so dist/ has to be current and built
// with the same base path GitHub Pages will serve from. Run before `npm test`.
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const { targets } = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

const only = process.argv.slice(2);
const buildable = targets.filter(t => t.build && (!only.length || only.includes(t.name)));

if (!buildable.length) {
  console.log('Nothing to build.');
  process.exit(0);
}

let failed = 0;
for (const t of buildable) {
  // t.dir points at dist/; the build runs in the project root above it.
  const cwd = dirname(resolve(root, t.dir));
  console.log(`\n=== building ${t.name} (${t.build})`);
  try {
    execSync(t.build, { cwd, stdio: 'inherit' });
  } catch {
    console.error(`!!! ${t.name} failed to build`);
    failed++;
  }
}

process.exit(failed ? 1 : 0);
