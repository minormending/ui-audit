// Clones every target repo as a sibling of this one, which is the layout the
// harness expects. Used by CI; locally the projects are already siblings.
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const workspace = dirname(root);
const { githubUser, targets } = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

const only = process.argv.slice(2);
const wanted = only.length ? targets.filter(t => only.includes(t.name)) : targets;

for (const t of wanted) {
  if (!t.repo) {
    console.log(`- ${t.name}: no repo mapping, skipping`);
    continue;
  }
  // dir may point into the project (e.g. ../foo/dist); clone the project root.
  const checkout = join(workspace, t.name);
  if (existsSync(checkout)) {
    console.log(`- ${t.name}: already present`);
    continue;
  }
  console.log(`- ${t.name}: cloning ${githubUser}/${t.repo}`);
  execSync(
    `git clone --depth 1 https://github.com/${githubUser}/${t.repo}.git ${JSON.stringify(checkout)}`,
    { stdio: 'inherit' }
  );
}
