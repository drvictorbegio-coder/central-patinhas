'use strict';
// Ambiente local que imita o Supabase para testes de interface:
//  - /rest/v1/*  → PostgREST (o mesmo motor usado pelo Supabase)
//  - /auth/v1/*  → login simplificado (senhas em memória, JWT HS256)
//  - /api/config → configuração do front-end
//  - demais      → arquivos de public/
// NÃO é usado em produção.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = Number(process.env.PORTA || 4321);
const PGRST = process.env.PGRST || 'http://127.0.0.1:3001';
const SEGREDO = process.env.JWT_SECRET;
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const usuarios = JSON.parse(process.env.USUARIOS_TESTE || '{}'); // { login: { id, senha } }

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(claims) {
  const cab = b64({ alg: 'HS256', typ: 'JWT' }), corpo = b64(claims);
  return `${cab}.${corpo}.${crypto.createHmac('sha256', SEGREDO).update(`${cab}.${corpo}`).digest('base64url')}`;
}
const anonKey = jwt({ role: 'anon', iss: 'teste' });
function sessao(u, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id, user };
}
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function lerCorpo(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); }); }
function json(res, st, obj) { res.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
    if (url.pathname === '/api/config') return json(res, 200, { supabaseUrl: `http://${req.headers.host}`, supabaseAnonKey: anonKey, loginDomain: 'teste.local' });
    if (url.pathname === '/api/setup') return json(res, 200, { precisa_configurar: false, setup_habilitado: false });
    if (url.pathname.startsWith('/auth/v1/')) {
      const corpo = await lerCorpo(req);
      if (url.pathname === '/auth/v1/token') {
        const b = JSON.parse(corpo || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const id = String(b.refresh_token || '').slice(2);
          const ent = Object.entries(usuarios).find(([, u]) => u.id === id);
          return ent ? json(res, 200, sessao(ent[1], `${ent[0]}@teste.local`)) : json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        const login = String(b.email || '').split('@')[0];
        const u = usuarios[login];
        if (!u || u.senha !== b.password) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        return json(res, 200, sessao(u, b.email));
      }
      if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
      if (url.pathname === '/auth/v1/user') {
        const tok = String(req.headers.authorization || '').split(' ')[1] || '';
        const claims = JSON.parse(Buffer.from(tok.split('.')[1] || 'e30', 'base64url').toString());
        return json(res, 200, { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email });
      }
      return json(res, 404, { msg: 'não implementado no ambiente de teste' });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const corpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await lerCorpo(req);
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
      if (headers.authorization === undefined && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const r = await fetch(PGRST + url.pathname.slice('/rest/v1'.length) + url.search, { method: req.method, headers, body: corpo });
      const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) h[k] = v; });
      res.writeHead(r.status, h);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (url.pathname.startsWith('/realtime/')) { res.writeHead(404); return res.end(); }
    let arq = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!arq.startsWith(PUBLIC) || !fs.existsSync(arq)) arq = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  } catch (e) {
    console.error(e); json(res, 500, { message: e.message });
  }
}).listen(PORTA, () => console.log(`Servidor local de testes em http://localhost:${PORTA}`));
