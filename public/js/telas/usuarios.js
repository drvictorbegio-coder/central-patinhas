// Gestão de Usuários (somente administradores).
import { sb, consulta, apiAdmin, sessao, cache } from '../api.js';
import { h, limpar, toast, modal, formulario, confirmar, tabela, fmtDataHora, selo, carregando } from '../ui.js';

const SITUACAO = { ativo: ['Ativo', 'verde'], pendente: ['Aguardando definir senha', 'amarelo'], bloqueado: ['Bloqueado', 'vermelho'], inativo: ['Desativado', 'cinza'] };

export async function render(el) {
  let mostrarInativos = false;
  const corpo = h('div', null, carregando());
  limpar(el, h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Gestão de Usuários'),
    h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'Cada funcionário tem o próprio login. Senhas nunca ficam visíveis — o acesso é definido pelo próprio funcionário, por um link de uso único.')),
  h('div', { class: 'acoes' }, h('button', { class: 'btn primario', onclick: () => novoUsuario(atualizar) }, '+ Novo usuário'))), corpo);

  async function atualizar() {
    const [usuarios, pedidos] = await Promise.all([
      consulta(sb.from('perfis').select('*').order('nome_completo')),
      consulta(sb.from('solicitacoes_senha').select('*, perfis!solicitacoes_senha_usuario_id_fkey(nome_completo)').is('atendida_em', null).order('criado_em')),
    ]);
    const lista = usuarios.filter((u) => mostrarInativos || u.situacao !== 'inativo');
    limpar(corpo,
      pedidos.length ? h('div', { class: 'aviso amarelo secao' }, h('b', null, `${pedidos.length} pedido(s) de nova senha: `),
        pedidos.map((p, i) => [i ? ', ' : '', `${p.perfis ? p.perfis.nome_completo : p.login_informado} (${fmtDataHora(p.criado_em)})`]),
        '. Use "Gerar link de acesso" no usuário correspondente.') : null,
      h('div', { class: 'cartao' },
        h('div', { class: 'cab' }, h('b', null, `${lista.length} usuário(s)`),
          h('label', { class: 'check', style: { marginLeft: 'auto' } }, h('input', { type: 'checkbox', checked: mostrarInativos, onchange: (e) => { mostrarInativos = e.target.checked; atualizar(); } }), 'Mostrar desativados')),
        tabela([
          { titulo: 'Nome', valor: (u) => h('div', null, h('b', null, u.nome_completo), u.id === sessao.usuario.id ? h('span', { class: 'fraco' }, ' (você)') : null) },
          { titulo: 'Login', valor: (u) => h('code', null, u.login) },
          { titulo: 'Perfil', valor: (u) => u.perfil === 'admin' ? selo('Administrador', 'roxo') : selo('Recepção', 'azul') },
          { titulo: 'Situação', valor: (u) => selo(...SITUACAO[u.situacao]) },
          { titulo: 'Último acesso', valor: (u) => u.ultimo_acesso ? fmtDataHora(u.ultimo_acesso) : '—' },
          { titulo: 'Ações', valor: (u) => acoes(u, atualizar) },
        ], lista)));
  }
  await atualizar();
  return { atualizar };
}

function acoes(u, aoMudar) {
  const eu = u.id === sessao.usuario.id;
  const alterar = async (dados, msg) => { await apiAdmin({ acao: 'alterar', id: u.id, ...dados }); cache.limpar(); toast(msg); aoMudar(); };
  const botoes = [];
  if (u.situacao === 'pendente' || u.situacao === 'ativo') {
    botoes.push(h('button', { class: 'btn peq', onclick: async () => {
      if (u.situacao === 'ativo' && !(await confirmar({ titulo: 'Gerar link de acesso', mensagem: `Gerar um novo link para ${u.nome_completo} definir uma nova senha? Links anteriores deixam de valer.`, botao: 'Gerar link' }))) return;
      try { const r = await apiAdmin({ acao: 'link', id: u.id }); mostrarLink(u, r.link); aoMudar(); } catch (e) { toast(e.message, 'erro'); }
    } }, 'Gerar link de acesso'));
  }
  botoes.push(h('button', { class: 'btn peq', onclick: () => formulario({
    titulo: `Editar ${u.nome_completo}`,
    campos: [{ nome: 'nome_completo', rotulo: 'Nome completo', obrigatorio: true, valor: u.nome_completo, max: 120 },
      { nome: 'perfil', rotulo: 'Perfil de acesso', tipo: 'select', valor: u.perfil, opcoes: [['recepcao', 'Recepção'], ['admin', 'Administrador']] }],
    aoEnviar: async (v) => alterar(v, 'Usuário atualizado.'),
  }) }, 'Editar'));
  if (!eu && (u.situacao === 'ativo' || u.situacao === 'pendente')) {
    botoes.push(h('button', { class: 'btn peq', onclick: async () => {
      if (await confirmar({ titulo: 'Bloquear acesso', mensagem: `${u.nome_completo} não conseguirá mais entrar até ser reativado(a). O histórico é mantido.`, botao: 'Bloquear', perigo: true })) {
        try { await alterar({ situacao: 'bloqueado' }, 'Acesso bloqueado.'); } catch (e) { toast(e.message, 'erro'); }
      } } }, 'Bloquear'));
  }
  if (!eu && u.situacao !== 'inativo') {
    botoes.push(h('button', { class: 'btn peq', onclick: async () => {
      if (await confirmar({ titulo: 'Desativar usuário desligado', mensagem: `Desativar ${u.nome_completo}? O acesso é encerrado e todo o histórico de atividades permanece salvo.`, botao: 'Desativar', perigo: true })) {
        try { await alterar({ situacao: 'inativo' }, 'Usuário desativado.'); } catch (e) { toast(e.message, 'erro'); }
      } } }, 'Desativar'));
  }
  if (u.situacao === 'bloqueado' || u.situacao === 'inativo') {
    botoes.push(h('button', { class: 'btn peq verde', onclick: async () => {
      try { await alterar({ situacao: 'ativo' }, 'Usuário reativado.'); } catch (e) { toast(e.message, 'erro'); }
    } }, 'Reativar'));
  }
  return h('div', { class: 'acoes-linha' }, botoes);
}

function novoUsuario(aoMudar) {
  formulario({
    titulo: 'Novo usuário',
    aviso: { texto: 'Após criar, você receberá um link de uso único para enviar ao funcionário. Ele mesmo definirá a senha — ninguém mais a conhece.' },
    campos: [
      { nome: 'nome_completo', rotulo: 'Nome completo', obrigatorio: true, max: 120 },
      { nome: 'login', rotulo: 'Login (identificação para entrar)', obrigatorio: true, max: 40, placeholder: 'ex.: nathaly', ajuda: 'Letras minúsculas, números, ponto ou hífen. Sem espaços e sem acentos.' },
      { nome: 'perfil', rotulo: 'Perfil de acesso', tipo: 'select', valor: 'recepcao', opcoes: [['recepcao', 'Recepção'], ['admin', 'Administrador']] },
    ],
    botao: 'Criar usuário',
    aoEnviar: async (v) => {
      const login = v.login.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.');
      const r = await apiAdmin({ acao: 'criar', ...v, login });
      cache.limpar(); aoMudar();
      setTimeout(() => mostrarLink({ nome_completo: v.nome_completo, login }, r.link), 50);
    },
  });
}

function mostrarLink(u, link) {
  const input = h('input', { type: 'text', value: link, readOnly: true });
  const msg = `Olá, ${u.nome_completo.split(' ')[0]}! Este é o seu acesso à Central da Recepção do Patinhas de Assis.\nLogin: ${u.login}\nDefina sua senha neste link (uso único): ${link}`;
  const m = modal({ titulo: 'Link de acesso gerado', corpo: [
    h('p', { style: { margin: 0 } }, 'Envie este link para ', h('b', null, u.nome_completo), ` (login: ${u.login}). Ele serve uma única vez para definir a senha.`),
    h('div', { class: 'link-copiar' }, input, h('button', { class: 'btn', onclick: async () => { input.select(); try { await navigator.clipboard.writeText(link); toast('Link copiado.'); } catch { document.execCommand('copy'); toast('Link copiado.'); } } }, 'Copiar')),
    h('div', { class: 'aviso amarelo' }, 'Por segurança, o link expira (padrão do Supabase: 1 hora — veja o guia para aumentar para 24 horas). Se expirar, gere outro.'),
  ], rodape: [h('a', { class: 'btn verde', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'Enviar pelo WhatsApp'), h('button', { class: 'btn primario', onclick: () => m.fechar() }, 'Concluir')] });
  input.select();
}
