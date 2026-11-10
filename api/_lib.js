'use strict';
// Utilitários das funções da Vercel. Credenciais SOMENTE por variáveis de ambiente.
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMINIO = (process.env.LOGIN_EMAIL_DOMAIN || 'equipe.patinhasdeassis.local').toLowerCase();

function faltandoConfig() {
  const f = [];
  if (!URL) f.push('SUPABASE_URL');
  if (!ANON) f.push('SUPABASE_ANON_KEY');
  if (!SERVICE) f.push('SUPABASE_SERVICE_ROLE_KEY');
  return f;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const servico = () => createClient(URL, SERVICE, opts);
const comoUsuario = (token) => createClient(URL, ANON, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });

const emailDoLogin = (login) => `${String(login).trim().toLowerCase()}@${DOMINIO}`;
const loginValido = (l) => /^[a-z0-9._-]{3,40}$/.test(String(l || ''));

function senhaValida(s) {
  if (typeof s !== 'string' || s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (s.length > 72) return 'Senha muito longa.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'A senha precisa conter letras e números.';
  return null;
}

function origem(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Mensagens do banco (RAISE EXCEPTION) chegam prontas em português.
function erroSupabase(res, error, padrao = 'Não foi possível concluir a operação.') {
  const msg = (error && error.message) || padrao;
  const status = error && (error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400);
  return json(res, status || 400, { erro: msg });
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

// Link de uso único para definir/redefinir senha (enviado pela gestão via WhatsApp).
async function gerarLinkSenha(req, login) {
  const { data, error } = await servico().auth.admin.generateLink({ type: 'recovery', email: emailDoLogin(login) });
  if (error) throw error;
  const t = data && data.properties && data.properties.hashed_token;
  if (!t) throw new Error('O Supabase não retornou o link de acesso.');
  return `${origem(req)}/#/senha?t=${encodeURIComponent(t)}&l=${encodeURIComponent(login)}`;
}

module.exports = { URL, ANON, DOMINIO, faltandoConfig, servico, comoUsuario, emailDoLogin, loginValido, senhaValida, origem, json, erroSupabase, lerCorpo, gerarLinkSenha };
