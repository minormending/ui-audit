// Vite targets are audited from dist/, so dist/ has to be current and built
// with the same base path GitHub Pages will serve from. Run before `npm test`.
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStamp } from './build-stamp.js';

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
    // Fresh CI checkouts have no node_modules; locally this is already done.
    //
    // `install` lets a target override the command. story-tale-reader needs it:
    // sharp is in its devDependencies for generating icons, fixtures and its sample
    // book — all of which are committed — and sharp's postinstall downloads libvips
    // from a GitHub release. The Vite build never touches sharp, but the download
    // still had to succeed for the audit to run, and the day it timed out it took
    // the whole suite with it. Installing with --ignore-scripts skips it.
    if (!existsSync(join(cwd, 'node_modules'))) {
      execSync(t.install ?? 'npm install --no-audit --no-fund', { cwd, stdio: 'inherit' });
    }
    execSync(t.build, { cwd, stdio: 'inherit' });
    // What this dist was made from, so anything reading it later can tell
    // whether the checkout has moved on since. See build-stamp.js.
    const stamp = writeStamp(t, root);
    if (stamp) console.log(`    built from ${stamp.commit.slice(0, 8)}${stamp.dirty ? ' (dirty tree)' : ''}`);
  } catch {
    console.error(`!!! ${t.name} failed to build`);
    failed++;
  }
}

process.exit(failed ? 1 : 0);
