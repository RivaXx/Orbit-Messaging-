// Dependency-free local HTTP host. Run through Start-Orbit.cmd.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(__dirname);
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf'
};
const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
    }
    try {
        const url = new URL(req.url, 'http://127.0.0.1:4173');
        if (url.pathname === '/__orbit_health') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return res.end(req.method === 'HEAD' ? '' : JSON.stringify({ app: 'orbit-local', version: 1 }));
        }
        const requested = decodeURIComponent(url.pathname);
        if (requested.includes('\0') || requested.includes('\\')) throw new Error('Invalid path');
        const candidate = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
        const actual = await fs.promises.realpath(candidate);
        if (!actual.startsWith(root + path.sep) || !types[path.extname(actual).toLowerCase()]) {
            res.writeHead(403); return res.end('Forbidden');
        }
        const stat = await fs.promises.stat(actual);
        if (!stat.isFile()) throw new Error('Not a file');
        res.writeHead(200, {
            'Content-Type': types[path.extname(actual).toLowerCase()], 'Content-Length': stat.size,
            'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(actual);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
    } catch (_) { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error('Orbit could not start:', error.message); process.exitCode = 1; });
server.listen(4173, '127.0.0.1', () => console.log('Orbit: http://127.0.0.1:4173/'));
