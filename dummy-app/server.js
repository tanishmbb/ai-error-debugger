/**
 * Zero-dependency Node.js HTTP Server for the Dummy Test Web App
 * Serves static assets on port 3000 and provides simulated failure endpoints:
 * - /api/missing -> HTTP 404 Not Found
 * - /api/crash   -> HTTP 500 Internal Server Error
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Set CORS headers so API endpoints can be accessed cleanly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = reqUrl.pathname;

  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);

  // Hardcoded endpoint: 404 Not Found
  if (pathname === '/api/missing') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        {
          error: 'Not Found',
          statusCode: 404,
          message: 'The requested route /api/missing does not exist in the routing table.',
          timestamp: new Date().toISOString()
        },
        null,
        2
      )
    );
    return;
  }

  // Hardcoded endpoint: 500 Internal Server Error
  if (pathname === '/api/crash') {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        {
          error: 'Internal Server Error',
          statusCode: 500,
          message: 'Unhandled database connection timeout exception in transaction worker.',
          timestamp: new Date().toISOString()
        },
        null,
        2
      )
    );
    return;
  }

  // Static file serving: default to index.html
  let safeRelativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // Sanitize path against directory traversal
  safeRelativePath = path.normalize(safeRelativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeRelativePath);

  // Guard against path traversal outside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Access denied.');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 File Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      console.error('File read stream error:', streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error reading file.');
      }
    });
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(` Dummy Test Web App Server is active on port ${PORT}`);
  console.log(` Web Interface:   http://localhost:${PORT}/`);
  console.log(` Missing Route:   http://localhost:${PORT}/api/missing  (404)`);
  console.log(` Crash Route:     http://localhost:${PORT}/api/crash    (500)`);
  console.log('====================================================');
});
