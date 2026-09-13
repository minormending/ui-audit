// Static file server that mounts every target dir under /<target-name>/.
// Lets one Playwright run cover all projects without per-repo servers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const { targets } = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));
const mounts = new Map(targets.map(t => [t.name, resolve(root, t.dir)]));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const [, name, ...rest] = url.pathname.split('/');
  const base = mounts.get(name);
  if (!base) return send(res, 404, 'no such target');

  let file = join(base, ...rest);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    return send(res, 404, 'not found');
  }
  // Refuse to escape the mount root.
  if (!resolve(file).startsWith(base)) return send(res, 403, 'forbidden');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    send(res, 404, 'not found');
  }
});

function send(res, code, msg) {
  res.writeHead(code, { 'content-type': 'text/plain' });
  res.end(msg);
}

server.listen(4173, () => console.log('ui-audit static server on http://localhost:4173'));
