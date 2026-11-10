// Conexão com o Supabase (banco, login e tempo real).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export let sb = null;
export let config = null;
export const sessao = { usuario: null };

export class ErroApi extends Error {
  constructor(msg, codigo) { super(msg); this.codigo = codigo; }
}

export async function iniciar() {
  const r = await fetch('/api/config');
  config = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(config.erro || 'Não foi possível carregar a configuração do sistema.');
  sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    // Sessão por aba/janela: fechar o navegador encerra o acesso (computadores compartilhados entre turnos).
    auth: { persistSession: true, storage: window.sessionStorage, storageKey: 'patinhas-sessao', autoRefreshToken: true, detectSessionInUrl: false },
  });
}

function traduzir(error) {
  const m = (error && error.message) || 'Erro inesperado.';
  if (/JWT expired|invalid JWT|not authenticated/i.test(m)) return new ErroApi('Sua sessão expirou. Entre novamente.', '401');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return new ErroApi('Sem conexão com o servidor. Verifique a internet e tente novamente.', 'rede');
  if (/permission denied/i.test(m)) return new ErroApi('Você não tem permissão para esta ação.', '42501');
  if (/duplicate key/i.test(m)) return new ErroApi('Registro duplicado: este cadastro já existe.', '23505');
  return new ErroApi(m, error && error.code);
}

export async function rpc(nome, params) {
  const { data, error } = await sb.rpc(nome, params);
  if (error) throw traduzir(error);
  return data;
}

// Consulta genérica: consulta(sb.from('v_exames').select('*')...)
export async function consulta(q) {
  const { data, error, count } = await q;
  if (error) throw traduzir(error);
  return count !== undefined && count !== null ? { data, count } : data;
}

// ---------- Login (o "login" vira o e-mail interno do Supabase Auth)
export const emailDoLogin = (login) => `${login.trim().toLowerCase()}@${config.loginDomain}`;

export async function entrar(login, senha) {
  const { error } = await sb.auth.signInWithPassword({ email: emailDoLogin(login), password: senha });
  if (error) {
    if (/banned/i.test(error.message)) throw new ErroApi('Seu acesso está bloqueado. Procure a gestão.');
    if (/invalid login|invalid credentials/i.test(error.message)) throw new ErroApi('Login ou senha incorretos.');
    if (/rate limit|too many/i.test(error.message)) throw new ErroApi('Muitas tentativas. Aguarde alguns minutos.');
    throw traduzir(error);
  }
  try {
    sessao.usuario = await rpc('registrar_acesso');
    if (sessao.usuario.situacao !== 'ativo') throw new ErroApi('Defina sua senha pelo link enviado pela gestão.');
    await rpc('confirmar_login');
  } catch (e) {
    await sb.auth.signOut();
    sessao.usuario = null;
    throw e;
  }
  return sessao.usuario;
}

export async function restaurarSessao() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  // Falha de rede momentânea não deve derrubar o login: tenta de novo antes de desistir.
  for (let tentativa = 1; ; tentativa++) {
    try { sessao.usuario = await rpc('registrar_acesso'); break; }
    catch (e) {
      if (e.codigo === '42501' || e.codigo === '401' || e.codigo === 'PGRST301') { await sb.auth.signOut(); return null; }
      if (tentativa >= 3) throw new ErroApi('Não foi possível conectar ao servidor. Verifique a internet e recarregue a página.', 'rede');
      await new Promise((r) => setTimeout(r, 800 * tentativa));
    }
  }
  if (sessao.usuario.situacao !== 'ativo') { await sb.auth.signOut(); return null; }
  return sessao.usuario;
}

export async function sair() {
  cache.limpar();
  await sb.auth.signOut().catch(() => {});
  sessao.usuario = null;
}

// Chamada às funções da Vercel que exigem administrador (Gestão de Usuários)
// Funções do servidor (Supabase Edge Function "usuarios"): configuração inicial e Gestão de Usuários
export async function funcaoUsuarios(corpo, metodo = 'POST') {
  const { data } = await sb.auth.getSession();
  const token = data.session ? data.session.access_token : config.supabaseAnonKey;
  const r = await fetch(`${config.supabaseUrl}/functions/v1/usuarios`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}`, 'x-origem': location.origin },
    body: metodo === 'POST' ? JSON.stringify(corpo || {}) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroApi(j.erro || 'Não foi possível concluir a operação.', String(r.status));
  return j;
}
export const apiAdmin = (corpo) => funcaoUsuarios(corpo);

export const ehAdmin = () => sessao.usuario && sessao.usuario.perfil === 'admin';

// ---------- Cadastros auxiliares em memória (recarregados quando algo muda)
export const cache = {
  _d: {},
  limpar() { this._d = {}; },
  async obter(chave, carregar) {
    if (!this._d[chave]) this._d[chave] = carregar().catch((e) => { delete this._d[chave]; throw e; });
    return this._d[chave];
  },
  laboratorios() { return this.obter('labs', () => consulta(sb.from('laboratorios').select('*').order('nome'))); },
  tipos() { return this.obter('tipos', () => consulta(sb.from('tipos_exame').select('*').order('nome'))); },
  prazos() { return this.obter('prazos', () => consulta(sb.from('prazos').select('*'))); },
  perfis() { return this.obter('perfis', () => consulta(sb.from('perfis').select('id, nome_completo, login, perfil, situacao').order('nome_completo'))); },
  feriados() { return this.obter('feriados', () => consulta(sb.from('feriados').select('*').order('data'))); },
};

// ---------- Tempo real: toda ação gera uma linha no histórico; avisamos a tela aberta.
let canal = null;
export function escutarMudancas(aoMudar, aoStatus) {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel('central-recepcao')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historico' }, (p) => {
      if (p.new && p.new.acao === 'configuracao_alterada') cache.limpar();
      if (p.new && /^usuario_|acesso_redefinido|senha_/.test(p.new.acao || '')) delete cache._d.perfis;
      aoMudar(p.new);
    })
    .subscribe((status) => aoStatus && aoStatus(status === 'SUBSCRIBED'));
}
export function pararDeEscutar() { if (canal) { sb.removeChannel(canal); canal = null; } }
