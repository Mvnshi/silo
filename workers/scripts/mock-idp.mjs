/** Minimal stand-in for Supabase's auth API — only what workers/auth.ts calls. */
import http from 'node:http';

const USERS = {
  'token-alice': { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.com' },
  'token-bob':   { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com' },
};
const SERVICE_KEY = 'service-test';
export const calls = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  calls.push(`${req.method} ${url.pathname}`);

  if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
    if (req.headers.apikey !== 'anon-test') { res.writeHead(401); return res.end('{}'); }
    const user = USERS[auth];
    if (!user) { res.writeHead(401, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ error: 'bad jwt' })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(user));
  }

  const del = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && del) {
    // The admin endpoint must be called with the SERVICE key, never the anon one.
    if (auth !== SERVICE_KEY) { res.writeHead(403); return res.end('{}'); }
    globalThis.__deleted = (globalThis.__deleted || []).concat(del[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }

  if (req.method === 'GET' && url.pathname === '/__deleted') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(globalThis.__deleted || []));
  }
  res.writeHead(404); res.end('{}');
});
server.listen(8124, '127.0.0.1', () => console.log('mock idp on 8124'));
