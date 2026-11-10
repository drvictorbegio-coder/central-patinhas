'use strict';
// Gestão de Usuários. A permissão é conferida NO BANCO: as funções admin_* recusam quem não é
// administrador ativo. A chave de serviço só é usada para a parte de autenticação (criar login,
// gerar link de senha, bloquear sessão), depois que o banco autorizou a operação.
const crypto = require('crypto');
const { faltandoConfig, servico, comoUsuario, emailDoLogin, loginValido, json, erroSupabase, lerCorpo, gerarLinkSenha } = require('./_lib');

module.exports = async (req, res) => {
  const falta = faltandoConfig();
  if (falta.length) return json(res, 500, { erro: `Configuração incompleta na Vercel: ${falta.join(', ')}.` });
  if (req.method !== 'POST') return json(res, 405, { erro: 'Método não permitido.' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
  const usuario = comoUsuario(token);
  const { data: ehAdmin, error: eAdm } = await usuario.rpc('is_admin');
  if (eAdm) return json(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
  if (!ehAdmin) return json(res, 403, { erro: 'Acesso restrito aos administradores.' });

  const b = await lerCorpo(req);
  const sb = servico();

  try {
    if (b.acao === 'criar') {
      const nome = String(b.nome_completo || '').trim();
      const login = String(b.login || '').trim().toLowerCase();
      const perfil = b.perfil === 'admin' ? 'admin' : 'recepcao';
      if (nome.length < 2) return json(res, 400, { erro: 'Informe o nome completo.' });
      if (!loginValido(login)) return json(res, 400, { erro: 'Login: use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado (sem espaços nem acentos).' });
      // Senha aleatória descartada: a funcionária define a própria senha pelo link.
      const { data, error } = await sb.auth.admin.createUser({
        email: emailDoLogin(login), password: crypto.randomBytes(24).toString('base64url') + 'a1',
        email_confirm: true, user_metadata: { nome_completo: nome, login },
      });
      if (error) {
        const dup = /already|registered|exists/i.test(error.message);
        return json(res, dup ? 409 : 400, { erro: dup ? 'Este login já está em uso.' : `Não foi possível criar o login: ${error.message}` });
      }
      const id = data.user.id;
      const { error: e1 } = await usuario.rpc('admin_criar_perfil', { p_id: id, p_nome: nome, p_login: login, p_perfil: perfil });
      if (e1) { await sb.auth.admin.deleteUser(id).catch(() => {}); return erroSupabase(res, e1); }
      const link = await gerarLinkSenha(req, login);
      return json(res, 201, { id, link });
    }

    if (b.acao === 'link') {
      const { data: p, error: e0 } = await usuario.from('perfis').select('login').eq('id', b.id).single();
      if (e0 || !p) return json(res, 404, { erro: 'Usuário não encontrado.' });
      const { error } = await usuario.rpc('admin_registrar_link', { p_id: b.id });
      if (error) return erroSupabase(res, error);
      await sb.auth.admin.updateUserById(b.id, { ban_duration: 'none' });
      return json(res, 200, { link: await gerarLinkSenha(req, p.login) });
    }

    if (b.acao === 'alterar') {
      const alteracoes = {};
      for (const k of ['nome_completo', 'perfil', 'situacao']) if (b[k] !== undefined) alteracoes[k] = b[k];
      const { data, error } = await usuario.rpc('admin_alterar_usuario', { p_id: b.id, p: alteracoes });
      if (error) return erroSupabase(res, error);
      // Bloqueado/desativado: impede novos logins e renovação de sessão no Supabase Auth.
      const bloquear = data.situacao === 'bloqueado' || data.situacao === 'inativo';
      const { error: e2 } = await sb.auth.admin.updateUserById(b.id, { ban_duration: bloquear ? '876000h' : 'none' });
      if (e2) return json(res, 500, { erro: `Situação salva, mas o Supabase Auth não confirmou o bloqueio: ${e2.message}` });
      return json(res, 200, { ok: true, usuario: data });
    }

    return json(res, 400, { erro: 'Ação inválida.' });
  } catch (e) {
    return json(res, 500, { erro: e.message || 'Erro inesperado.' });
  }
};
