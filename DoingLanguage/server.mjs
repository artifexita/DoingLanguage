/**
 * DoingLanguage — Local Development & PWA Static Server
 * Zero dependencies, built-in MIME types, CORS, and audio streaming support.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL path
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let reqPath = decodeURIComponent(parsedUrl.pathname);
  if (reqPath.endsWith('/') || reqPath === '') {
    reqPath += 'index.html';
  }

  const safePath = path.normalize(path.join(__dirname, reqPath));

  // Security: prevent directory traversal
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err) {
      // If path not found and not a file extension, try index.html for SPA routing
      if (!path.extname(safePath)) {
        const indexPath = path.join(__dirname, 'index.html');
        return fs.readFile(indexPath, (errIndex, data) => {
          if (errIndex) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          }
        });
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(safePath, 'index.html');
      return fs.readFile(indexPath, (errIndex, data) => {
        if (errIndex) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Support HTTP Range Requests for audio/video playback
    const range = req.headers.range;
    if (range && stats.size > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(safePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(safePath).pipe(res);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n==================================================`);
  console.log(`🧠 DoingLanguage Server Running!`);
  console.log(`   Local URL:    http://localhost:${PORT}`);
  console.log(`   Network URL:  http://${HOST}:${PORT}`);
  console.log(`==================================================\n`);
});
