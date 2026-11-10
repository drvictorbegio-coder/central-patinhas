'use strict';
// Configuração inicial: cria o PRIMEIRO administrador. Funciona só enquanto não existir nenhum
// usuário e exige o código SETUP_TOKEN definido nas variáveis de ambiente da Vercel.
const crypto = require('crypto');
const { faltandoConfig, servico, emailDoLogin, loginValido, senhaValida, json, lerCorpo } = require('./_lib');

module.exports = async (req, res) => {
  const falta = faltandoConfig();
  if (falta.length) return json(res, 500, { erro: `Configuração incompleta na Vercel: ${falta.join(', ')}.` });
  const sb = servico();
  const { count, error: e0 } = await sb.from('perfis').select('id', { count: 'exact', head: true });
  if (e0) return json(res, 500, { erro: 'Não foi possível acessar o banco. Verifique se o SQL do Supabase foi executado.' });

  if (req.method === 'GET') return json(res, 200, { precisa_configurar: count === 0, setup_habilitado: Boolean(process.env.SETUP_TOKEN) });
  if (req.method !== 'POST') return json(res, 405, { erro: 'Método não permitido.' });
  if (count > 0) return json(res, 403, { erro: 'O sistema já foi configurado.' });

  const tokenEsperado = process.env.SETUP_TOKEN || '';
  const b = await lerCorpo(req);
  const dado = Buffer.from(String(b.setup_token || ''));
  const esperado = Buffer.from(tokenEsperado);
  if (!tokenEsperado || dado.length !== esperado.length || !crypto.timingSafeEqual(dado, esperado)) {
    return json(res, 403, { erro: 'Código de configuração inválido.' });
  }
  const nome = String(b.nome_completo || '').trim();
  const login = String(b.login || '').trim().toLowerCase();
  if (nome.length < 2) return json(res, 400, { erro: 'Informe o nome completo.' });
  if (!loginValido(login)) return json(res, 400, { erro: 'Login: 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.' });
  const problema = senhaValida(b.senha);
  if (problema) return json(res, 400, { erro: problema });

  const { data, error } = await sb.auth.admin.createUser({
    email: emailDoLogin(login), password: b.senha, email_confirm: true, user_metadata: { nome_completo: nome, login },
  });
  if (error) return json(res, 400, { erro: `Não foi possível criar o login: ${error.message}` });
  const id = data.user.id;
  const { error: e1 } = await sb.from('perfis').insert({ id, nome_completo: nome, login, perfil: 'admin', situacao: 'ativo' });
  if (e1) {
    await sb.auth.admin.deleteUser(id).catch(() => {});
    return json(res, 400, { erro: `Não foi possível registrar o administrador: ${e1.message}` });
  }
  await sb.from('historico').insert({ usuario_id: id, usuario_nome: nome, acao: 'usuario_criado', entidade: 'usuario',
    descricao: `Configuração inicial: primeiro administrador criado — ${nome} (${login})` });
  json(res, 201, { ok: true });
};
