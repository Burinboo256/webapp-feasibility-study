import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const root = resolve(process.cwd());
const publicRoot = join(root, 'public');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const rawPath = pathname === '/' ? '/index.html' : pathname;
  const candidate = normalize(join(publicRoot, rawPath));
  if (!candidate.startsWith(publicRoot)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  const sourceCandidate = normalize(join(root, rawPath));
  if (sourceCandidate.startsWith(root) && existsSync(sourceCandidate) && statSync(sourceCandidate).isFile()) {
    return sourceCandidate;
  }

  return null;
}

createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || '/');

  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes[extname(filePath)] || 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Cohort feasibility app: http://${host}:${port}`);
});
