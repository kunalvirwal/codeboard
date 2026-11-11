// Production server: serves the built app from dist/ plus the link-preview API.
// Run with `npm run build && npm start`. Binds to localhost only.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleImageRequest, handlePreviewRequest } from './preview.ts';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  if (pathname === '/api/preview') {
    await handlePreviewRequest(req, res);
    return;
  }
  if (pathname === '/api/image') {
    await handleImageRequest(req, res);
    return;
  }

  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html'); // SPA fallback
  }

  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    if (file.includes(`${sep}assets${sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found. Did you run `npm run build`?');
  }
}).listen(port, host, () => {
  console.log(`CodeBoard running at http://${host}:${port}`);
});
