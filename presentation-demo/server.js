/**
 * TaskFlow Pro - Backend API & Static Asset Server
 * Zero-dependency Node.js server using built-in http, fs, and path modules.
 * Port: 8080
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Global CORS headers for seamless extension and client communication
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
  const pathname = reqUrl.pathname;
  const timestamp = new Date().toLocaleTimeString();

  // -------------------------------------------------------------
  // BUG 2 (DEMO): The 500 Database Crash on POST /api/v1/tasks
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/v1/tasks') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`\x1b[31m[${timestamp}] [DB CLUSTER CRASH] POST /api/v1/tasks\x1b[0m`);
      console.log(`\x1b[33m  └─ Received payload: ${body || '{}'}\x1b[0m`);
      console.log(`\x1b[31m  └─ [Error: Connection to PostgreSQL primary pool 'taskflow_prod:5432' timed out after 5000ms]\x1b[0m`);
      console.log(`\x1b[31m  └─ Worker thread #3 terminated unexpectedly with code ETIMEDOUT\x1b[0m`);

      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 500,
        error: 'Internal Server Error',
        code: 'ERR_DATABASE_CONNECTION_TIMEOUT',
        message: 'The database connection pool timed out while attempting to persist the task entity.',
        target: 'postgresql://db-cluster-primary.internal:5432/taskflow_prod',
        timestamp: new Date().toISOString()
      }, null, 2));
    });
    return;
  }

  // -------------------------------------------------------------
  // Optional: Correct profile route if needed for comparison
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/v1/user-profile') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'usr_88291',
      name: 'Sarah Connor',
      role: 'Lead Architect',
      email: 's.connor@taskflow.io',
      team: 'Core Platform',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'
    }));
    return;
  }

  // -------------------------------------------------------------
  // BUG 1 (DEMO): 404 Typo Route (/api/v1/user-profle)
  // Any API route not matched returns a clean 404 JSON
  // -------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    console.log(`\x1b[33m[${timestamp}] [ROUTER 404] ${req.method} ${pathname}\x1b[0m`);
    if (pathname === '/api/v1/user-profle') {
      console.log(`\x1b[36m  └─ Notice: Did the client mean '/api/v1/user-profile' (typo detected in endpoint name)?\x1b[0m`);
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 404,
      error: 'Not Found',
      message: `The endpoint '${pathname}' does not exist on this API server. Please check route spelling.`,
      timestamp: new Date().toISOString()
    }, null, 2));
    return;
  }

  // -------------------------------------------------------------
  // Static File Serving from /public
  // -------------------------------------------------------------
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // Sanitize path against directory traversal
  relativePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Access denied.');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: Static resource '${pathname}' does not exist.`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.on('error', streamErr => {
      console.error('File stream error:', streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('\n\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m  TASKFLOW PRO - PRESENTATION DEMO SERVER IS LIVE\x1b[0m');
  console.log('\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log(`  \x1b[1mWeb Application:\x1b[0m   \x1b[4mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`  \x1b[1mStatic Root:\x1b[0m       ${PUBLIC_DIR}`);
  console.log(`  \x1b[1mDemo Failure 1:\x1b[0m    GET  /api/v1/user-profle     -> 404 Not Found (Typo on Load)`);
  console.log(`  \x1b[1mDemo Failure 2:\x1b[0m    POST /api/v1/tasks           -> 500 Internal Server Error (DB Crash)`);
  console.log(`  \x1b[1mDemo Failure 3:\x1b[0m    POST :5555/generate-pdf      -> ECONNREFUSED (Microservice Offline)`);
  console.log('\x1b[1m\x1b[36m=================================================================\x1b[0m\n');
});
