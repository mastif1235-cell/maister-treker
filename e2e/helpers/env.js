'use strict';
/* Інфраструктура E2E: тимчасова копія runtime-файлів репозиторію + локальний
   статичний сервер без жодних зовнішніх залежностей (node http/fs). Копія
   потрібна, щоб тести могли безпечно модифікувати файли (наприклад sw.js у
   сценарії оновлення Service Worker), не торкаючись робочого дерева. */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const EXCLUDED_TOP_LEVEL = new Set([
  '.git', '.github', 'node_modules', 'tests', 'e2e', 'docs',
  'test-results', 'playwright-report', 'blob-report', '.arena'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pmtiles': 'application/octet-stream',
  '.wasm': 'application/wasm'
};

function createWorkspace(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-e2e-'));
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(REPO_ROOT, source);
      if(!rel) return true;
      const top = rel.split(path.sep)[0];
      return !EXCLUDED_TOP_LEVEL.has(top);
    }
  });
  return dir;
}

function startStaticServer(dir){
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try{
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
        let relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
        const filePath = path.join(dir, relative);
        // Захист від виходу за межі тимчасової копії.
        if(!filePath.startsWith(dir + path.sep) && filePath !== path.join(dir, 'index.html')){
          res.writeHead(403).end('Forbidden'); return;
        }
        fs.stat(filePath, (statError, stats) => {
          if(statError || !stats.isFile()){
            // GitHub Pages віддає 404.html/index.html; у E2E достатньо чесного 404.
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            // no-store: оновлення sw.js/ресурсів у тестах має бути реальним,
            // а кешуванням керує сам Service Worker (як у production).
            'Cache-Control': 'no-store',
            'Content-Length': stats.size
          });
          fs.createReadStream(filePath).pipe(res);
        });
      }catch(_error){
        try{ res.writeHead(500).end('Server error'); }catch(_e){}
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        dir,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

async function createAppEnv(){
  const dir = createWorkspace();
  const server = await startStaticServer(dir);
  return server;
}

module.exports = { REPO_ROOT, createWorkspace, startStaticServer, createAppEnv };
