// Whether the dist/ being audited was built from the source that is there now.
//
// The failure this exists for is quiet and total. `build-targets.js` always
// runs the build, so dist/ is fresh the moment it finishes — but the target is
// a separate repository, and nothing stops it moving afterwards. Pull a target,
// or have a session working in it commit something, and the harness goes on
// serving the previous build with a current timestamp. Every check then passes
// or fails against an app that no longer exists, and the pictures a baseline
// run writes are of a feature that is not in the bundle.
//
// That is not hypothetical: a refresh of story-tale-reader's baselines was
// nearly committed from a dist with a clean checkout, a timestamp minutes old,
// and no `shelf-controls` anywhere in it — the checkout had advanced past the
// build. The tell was a state failing under `--update-snapshots=all`, which
// cannot fail on pixels. That is a thin thread to hang this on.
//
// So the build records what it built from, and the things that read dist/ check
// it. A sha, not an mtime: mtimes say when, and the question is *what*.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

export const STAMP = '.audit-build.json';

/** The project root, which is the directory above dist/. */
export const projectRoot = (target, root) => dirname(resolve(root, target.dir));

/** HEAD and whether the tree is dirty, or null when this is not a git checkout. */
export function headOf(dir) {
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  } catch {
    return null;
  }
}

/** Record what this build was made from. Called after a build succeeds. */
export function writeStamp(target, root) {
  const head = headOf(projectRoot(target, root));
  if (!head) return null;
  const dist = resolve(root, target.dir);
  if (!existsSync(dist)) return null;
  const stamp = { commit: head.commit, dirty: head.dirty, builtAt: new Date().toISOString() };
  writeFileSync(join(dist, STAMP), JSON.stringify(stamp, null, 2) + '\n');
  return stamp;
}

/**
 * Targets whose dist/ no longer matches their source.
 *
 * Returns `{ name, reason, fatal }`. A dirty tree is reported but not fatal:
 * somebody iterating on a target is dirty continuously and should not be
 * blocked by it, and a sha cannot speak for uncommitted edits anyway.
 */
export function staleTargets(targets, root) {
  const out = [];
  for (const t of targets) {
    // Only a built target can go stale. A plain static site is served from its
    // own tree, so there is no second copy to fall behind.
    if (!t.build) continue;
    const dist = resolve(root, t.dir);
    // No dist at all is a different fault with a better error already: the
    // harness reports the 404s and names the base path.
    if (!existsSync(dist)) continue;
    // Absent on a runner that has not got the file — same rule the harness uses.
    if (t.requires?.some(f => !existsSync(resolve(root, t.dir, f)))) continue;

    const head = headOf(projectRoot(t, root));
    if (!head) continue; // not a checkout; nothing to compare against

    const file = join(dist, STAMP);
    if (!existsSync(file)) {
      out.push({ name: t.name, fatal: true, reason: `built before this check existed, or by hand — no ${STAMP}` });
      continue;
    }

    let stamp;
    try { stamp = JSON.parse(readFileSync(file, 'utf8')); }
    catch { out.push({ name: t.name, fatal: true, reason: `${STAMP} is unreadable` }); continue; }

    if (stamp.commit !== head.commit) {
      out.push({
        name: t.name,
        fatal: true,
        reason: `built from ${String(stamp.commit).slice(0, 8)}, checkout is at ${head.commit.slice(0, 8)}`,
      });
    } else if (head.dirty || stamp.dirty) {
      out.push({
        name: t.name,
        fatal: false,
        reason: 'working tree is dirty, so the commit alone cannot vouch for the build',
      });
    }
  }
  return out;
}

/**
 * Report, and throw on anything fatal. Called by whatever is about to read
 * dist/ — the check suite through playwright.config.js, and capture.js.
 */
export function assertFresh(targets, root, { label = 'audit' } = {}) {
  const stale = staleTargets(targets, root);
  for (const s of stale.filter(s => !s.fatal)) {
    console.warn(`  ! ${s.name}: ${s.reason}`);
  }
  const fatal = stale.filter(s => s.fatal);
  if (!fatal.length) return;
  throw new Error(
    `${fatal.length} target(s) would be ${label}ed from a stale build:\n` +
    fatal.map(s => `  ${s.name} — ${s.reason}`).join('\n') +
    `\n\nThe dist/ being served was made from different source than the checkout holds,` +
    `\nso every result would describe an app that is not there. Rebuild:\n` +
    `  npm run build:targets ${fatal.map(s => s.name).join(' ')}\n`,
  );
}
