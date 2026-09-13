// Shared target resolution for the standalone scripts. Mirrors the same
// AUDIT_DIR / AUDIT_ONLY rules the Playwright harness uses, so the server and
// the capture script always agree on what is being audited.
import { readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(import.meta.url), '../..');

export async function resolveTargets(argv = []) {
  const config = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

  if (process.env.AUDIT_DIR) {
    const dir = resolve(process.env.AUDIT_DIR);
    return [{
      name: process.env.AUDIT_NAME || basename(dir),
      dir,
      waitFor: process.env.AUDIT_WAIT_FOR || null,
      pages: [{ path: '/', name: 'home' }],
    }];
  }

  const names = argv.length
    ? argv
    : (process.env.AUDIT_ONLY?.split(',').map(s => s.trim()).filter(Boolean) ?? []);

  if (!names.length) return config.targets;

  const picked = config.targets.filter(t => names.includes(t.name));
  if (!picked.length) {
    throw new Error(`No matching targets. Known: ${config.targets.map(t => t.name).join(', ')}`);
  }
  return picked;
}
