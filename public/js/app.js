// Inicialização, login, navegação e atualização em tempo real.
import { iniciar, restaurarSessao, entrar, sair, sessao, rpc, sb, ehAdmin, escutarMudancas, pararDeEscutar, config, funcaoUsuarios } from './api.js';
import { h, limpar, toast, modal, ICONES } from './ui.js';

const TELAS = {
  painel:      { titulo: 'Central da Recepção', icone: '🏠', modulo: './telas/painel.js' },
  exames:      { titulo: 'Exames', icone: '🧪', modulo: './telas/exames.js' },
  retornos:    { titulo: 'Retornos', icone: '📅', modulo: './telas/retornos.js' },
  pacientes:   { titulo: 'Tutores e Pacientes', icone: '🐾', modulo: './telas/pacientes.js' },
  paciente:    { titulo: 'Ficha do paciente', modulo: './telas/ficha.js', oculto: true },
  internados:  { titulo: 'Internação', icone: '🏥', modulo: './telas/internados.js' },
  historico:   { titulo: 'Histórico de Atividades', icone: '🕘', modulo: './telas/historico.js' },
  relatorios:  { titulo: 'Relatórios Gerenciais', icone: '📊', modulo: './telas/relatorios.js', admin: true },
  config:      { titulo: 'Configurações', icone: '⚙️', modulo: './telas/configuracoes.js', admin: true },
  usuarios:    { titulo: 'Gestão de Usuários', icone: '👥', modulo: './telas/usuarios.js', admin: true },
  // Futuro módulo de Orçamentos: registrar aqui { titulo: 'Orçamentos', modulo: './telas/orcamentos.js' }.
};

const app = document.getElementById('app');
let telaAtual = null;      // { nome, atualizar }
let elConteudo = null;
let elAoVivo = null;

// ---------------------------------------------------------------- rotas
function rotaAtual() {
  const [caminho, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const partes = caminho.split('/').filter(Boolean);
  return { nome: partes[0] || 'painel', id: partes[1], params: new URLSearchParams(qs || '') };
}

let navegacao = 0; // descarta telas que terminam de carregar depois que o usuário já mudou de página
async function navegar() {
  const minha = ++navegacao;
  const rota = rotaAtual();
  if (rota.nome === 'senha') return telaDefinirSenha(rota.params);
  if (rota.nome === 'configuracao-inicial') return telaConfiguracaoInicial();
  if (!sessao.usuario) return telaLogin();
  if (!elConteudo) montarLayout();
  const def = TELAS[rota.nome];
  marcarMenu(rota.nome === 'paciente' ? 'pacientes' : rota.nome);
  document.querySelector('.layout')?.classList.remove('menu-aberto');
  if (!def) return limpar(elConteudo, h('div', { class: 'vazio' }, 'Página não encontrada.'));
  if (def.admin && !ehAdmin()) {
    return limpar(elConteudo, h('div', { class: 'cartao' }, h('div', { class: 'vazio' }, h('div', { class: 'grande' }, '🔒'),
      h('h2', null, 'Acesso restrito aos administradores'), h('p', null, 'Esta área só pode ser acessada pela gestão.'))));
  }
  document.title = `${def.titulo} | Patinhas de Assis`;
  telaAtual = null;
  const alvo = h('div');
  limpar(elConteudo, alvo);
  try {
    const mod = await import(def.modulo);
    const controle = await mod.render(alvo, rota) || {};
    if (minha !== navegacao) return;
    telaAtual = { nome: rota.nome + (rota.id || ''), atualizar: controle.atualizar };
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (minha !== navegacao) return;
    console.error(e);
    if (e.codigo === '401' || (e.codigo === '42501' && /Sessão/.test(e.message))) { await sair(); elConteudo = null; return navegar(); }
    limpar(alvo, h('div', { class: 'aviso vermelho' }, 'Não foi possível carregar a tela: ', e.message));
  }
}
window.addEventListener('hashchange', navegar);

// Atualiza a tela aberta quando outro funcionário altera algo (sem recarregar a página).
let temporizador = null;
function agendarAtualizacao() {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    if (!sessao.usuario || !elConteudo) return;
    if (document.querySelector('.fundo-modal')) return agendarAtualizacao(); // não atrapalha quem está preenchendo
    if (telaAtual && telaAtual.atualizar) { try { await telaAtual.atualizar(); } catch (e) { console.warn(e); } }
    atualizarContadorMenu();
  }, 700);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && sessao.usuario) agendarAtualizacao(); });
setInterval(() => { if (sessao.usuario && !document.hidden) agendarAtualizacao(); }, 120000); // vira o dia / segurança

// ---------------------------------------------------------------- layout
function montarLayout() {
  const u = sessao.usuario;
  const itens = Object.entries(TELAS).filter(([, d]) => !d.oculto && (!d.admin || u.perfil === 'admin'));
  const operacionais = itens.filter(([, d]) => !d.admin);
  const gestao = itens.filter(([, d]) => d.admin);
  const link = ([nome, d]) => h('a', { href: `#/${nome}`, 'data-tela': nome }, h('span', null, d.icone), d.titulo, nome === 'painel' ? h('span', { class: 'contador oculto', id: 'contador-menu' }) : null);
  elAoVivo = h('span', { class: 'ao-vivo off', title: 'Atualização automática' }, 'Conectando…');
  elConteudo = h('main', { class: 'conteudo' });
  const layout = h('div', { class: 'layout' },
    h('aside', { class: 'lateral' },
      h('div', { class: 'marca' }, h('span', { html: ICONES.pata, style: { color: '#9fd6cf' } }), h('div', null, h('b', null, 'Patinhas de Assis'), h('span', null, 'Central da Recepção'))),
      h('nav', { class: 'menu' }, operacionais.map(link), gestao.length ? h('div', { class: 'sep' }, 'Gestão') : null, gestao.map(link)),
      h('div', { class: 'rodape' }, 'Hospital Veterinário · São Bernardo do Campo')),
    h('div', { class: 'principal' },
      h('header', { class: 'topo' },
        h('button', { class: 'btn fantasma icone btn-menu', 'aria-label': 'Abrir menu', onclick: () => layout.classList.toggle('menu-aberto') }, '☰'),
        elAoVivo,
        h('div', { class: 'usuario' },
          h('span', null, 'Usuário: ', h('b', null, primeiroNome(u.nome_completo)), h('span', { class: 'nome-perfil' }, ` | ${u.perfil === 'admin' ? 'Administrador' : 'Recepção'}`)),
          h('button', { class: 'btn peq fantasma', onclick: trocarSenha, title: 'Alterar minha senha' }, '🔑'),
          h('button', { class: 'btn peq', onclick: async () => { telaAtual = null; clearTimeout(temporizador); pararDeEscutar(); elConteudo = null; await sair(); location.hash = '#/painel'; navegar(); } }, 'Sair'))),
      elConteudo));
  layout.addEventListener('click', (e) => { if (e.target === layout) layout.classList.remove('menu-aberto'); });
  limpar(app, layout);
  escutarMudancas(() => agendarAtualizacao(), (ok) => {
    elAoVivo.classList.toggle('off', !ok);
    elAoVivo.textContent = ok ? 'Atualização em tempo real' : 'Reconectando…';
  });
  atualizarContadorMenu();
  iniciarInatividade();
}
const primeiroNome = (n) => n.split(' ')[0];
function marcarMenu(nome) { document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.tela === nome)); }

async function atualizarContadorMenu() {
  const el = document.getElementById('contador-menu');
  if (!el) return;
  try {
    const p = await rpc('painel_contadores');
    const n = p.exames.atrasados + p.exames.vence_hoje + p.exames.aguardando_comunicacao + p.retornos.vencidos + p.retornos.hoje;
    el.textContent = n; el.classList.toggle('oculto', !n);
    el.title = 'Pendências de hoje';
  } catch { /* silencioso */ }
}

// Encerramento por inatividade (computadores compartilhados): 60 minutos
let ultimoUso = Date.now();
function iniciarInatividade() {
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { ultimoUso = Date.now(); }, { passive: true }));
}
setInterval(async () => {
  if (sessao.usuario && Date.now() - ultimoUso > 60 * 60 * 1000) {
    telaAtual = null; pararDeEscutar(); elConteudo = null; await sair();
    toast('Sessão encerrada por inatividade. Entre novamente.', 'aviso');
    navegar();
  }
}, 60000);

function trocarSenha() {
  const atual = h('input', { type: 'password', autocomplete: 'current-password' });
  const nova = h('input', { type: 'password', autocomplete: 'new-password' });
  const conf = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn primario', onclick: async () => {
    const erro = validarSenha(nova.value, conf.value);
    if (erro) return toast(erro, 'aviso');
    btn.disabled = true;
    try {
      const { error: e1 } = await sb.auth.signInWithPassword({ email: `${sessao.usuario.login}@${config.loginDomain}`, password: atual.value });
      if (e1) throw new Error('Senha atual incorreta.');
      const { error } = await sb.auth.updateUser({ password: nova.value });
      if (error) throw new Error(error.message);
      m.fechar(); toast('Senha alterada com sucesso.');
    } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; }
  } }, 'Alterar senha');
  const m = modal({ titulo: 'Alterar minha senha', corpo: [
    h('div', { class: 'campo' }, h('label', null, 'Senha atual'), atual),
    h('div', { class: 'campo' }, h('label', null, 'Nova senha'), nova, h('span', { class: 'ajuda' }, 'Mínimo de 8 caracteres, com letras e números.')),
    h('div', { class: 'campo' }, h('label', null, 'Confirme a nova senha'), conf),
  ], rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), btn] });
}

function validarSenha(s, c) {
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'A senha precisa conter letras e números.';
  if (s !== c) return 'As senhas não conferem.';
  return null;
}

// ---------------------------------------------------------------- telas de acesso
function caixaLogin(...conteudo) {
  return h('div', { class: 'tela-login' }, h('div', { class: 'caixa-login' },
    h('div', { class: 'logo' }, h('span', { html: ICONES.pata, style: { color: 'var(--marca)' } }),
      h('div', null, h('b', null, 'Patinhas de Assis'), h('span', null, 'Central da Recepção'))), ...conteudo));
}

async function telaLogin() {
  elConteudo = null;
  document.title = 'Entrar | Patinhas de Assis';
  // Primeiro acesso: nenhum usuário cadastrado ainda
  try {
    const s = await funcaoUsuarios(null, 'GET');
    if (s.precisa_configurar) { location.hash = '#/configuracao-inicial'; return; }
  } catch { /* segue para o login */ }
  const login = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex.: nathaly', required: true });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const erro = h('div', { class: 'aviso vermelho oculto' });
  const btn = h('button', { type: 'submit', class: 'btn primario', style: { width: '100%', padding: '11px' } }, 'Entrar');
  const form = h('form', { style: { display: 'flex', flexDirection: 'column', gap: '14px' }, onsubmit: async (e) => {
    e.preventDefault();
    erro.classList.add('oculto'); btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await entrar(login.value, senha.value);
      location.hash = location.hash && !/senha|configuracao/.test(location.hash) ? location.hash : '#/painel';
      navegar();
    } catch (err) {
      erro.textContent = err.message; erro.classList.remove('oculto');
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  } },
    h('div', { class: 'campo' }, h('label', null, 'Login'), login),
    h('div', { class: 'campo' }, h('label', null, 'Senha'), senha),
    erro, btn,
    h('button', { type: 'button', class: 'btn fantasma', onclick: esqueciSenha }, 'Esqueci minha senha'));
  limpar(app, caixaLogin(h('h1', null, 'Entrar'), h('p', { class: 'suave', style: { margin: 0 } }, 'Use o seu login individual. Não compartilhe sua senha.'), form));
  login.focus();
}

function esqueciSenha() {
  const login = h('input', { type: 'text', autocapitalize: 'none', placeholder: 'Seu login' });
  const m = modal({ titulo: 'Esqueci minha senha', corpo: [
    h('p', { style: { margin: 0 } }, 'Informe seu login. A gestão receberá o pedido e vai te enviar um novo link para definir a senha.'), login],
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), h('button', { class: 'btn primario', onclick: async () => {
      await sb.rpc('solicitar_redefinicao', { p_login: login.value });
      m.fechar(); toast('Pedido enviado à gestão. Aguarde o novo link de acesso.');
    } }, 'Enviar pedido')] });
}

async function telaDefinirSenha(params) {
  pararDeEscutar(); elConteudo = null;
  const t = params.get('t'); const login = params.get('l') || '';
  const nova = h('input', { type: 'password', autocomplete: 'new-password' });
  const conf = h('input', { type: 'password', autocomplete: 'new-password' });
  const msg = h('div', { class: 'aviso vermelho oculto' });
  const btn = h('button', { class: 'btn primario', onclick: async () => {
    const e = validarSenha(nova.value, conf.value);
    if (e) { msg.textContent = e; msg.classList.remove('oculto'); return; }
    btn.disabled = true; msg.classList.add('oculto');
    try {
      await sb.auth.signOut().catch(() => {});
      const { error: e1 } = await sb.auth.verifyOtp({ token_hash: t, type: 'recovery' });
      if (e1) throw new Error('Link inválido, expirado ou já utilizado. Peça um novo link à gestão.');
      const { error: e2 } = await sb.auth.updateUser({ password: nova.value });
      if (e2) throw new Error(e2.message);
      const { error: e3 } = await sb.rpc('ativar_minha_conta');
      if (e3) throw new Error(e3.message);
      await sb.auth.signOut();
      limpar(app, caixaLogin(h('div', { class: 'aviso verde' }, 'Senha definida com sucesso!'),
        h('p', { style: { margin: 0 } }, `Agora entre com o login "${login}" e a senha que você acabou de criar.`),
        h('a', { class: 'btn primario', href: '#/painel' }, 'Ir para o login')));
    } catch (err) { msg.textContent = err.message; msg.classList.remove('oculto'); btn.disabled = false; }
  } }, 'Definir minha senha');
  if (!t) return limpar(app, caixaLogin(h('div', { class: 'aviso vermelho' }, 'Link incompleto. Peça um novo link à gestão.'), h('a', { class: 'btn', href: '#/painel' }, 'Voltar')));
  limpar(app, caixaLogin(h('h1', null, 'Definir senha'),
    login ? h('p', { style: { margin: 0 } }, 'Login: ', h('b', null, login)) : null,
    h('div', { class: 'campo' }, h('label', null, 'Nova senha'), nova, h('span', { class: 'ajuda' }, 'Mínimo de 8 caracteres, com letras e números. Não use a mesma senha de outros sites.')),
    h('div', { class: 'campo' }, h('label', null, 'Confirme a senha'), conf), msg, btn));
}

async function telaConfiguracaoInicial() {
  elConteudo = null;
  const s = await funcaoUsuarios(null, 'GET').catch((e) => ({ erro: e.message }));
  if (s.erro) return limpar(app, caixaLogin(h('div', { class: 'aviso vermelho' }, s.erro)));
  if (!s.precisa_configurar) { location.hash = '#/painel'; return; }
  const campos = { setup_token: h('input', { type: 'password' }), nome_completo: h('input', { type: 'text' }), login: h('input', { type: 'text', autocapitalize: 'none' }), senha: h('input', { type: 'password', autocomplete: 'new-password' }), conf: h('input', { type: 'password', autocomplete: 'new-password' }) };
  const msg = h('div', { class: 'aviso vermelho oculto' });
  const btn = h('button', { class: 'btn primario', onclick: async () => {
    const e = validarSenha(campos.senha.value, campos.conf.value);
    if (e) { msg.textContent = e; msg.classList.remove('oculto'); return; }
    btn.disabled = true;
    try {
      await funcaoUsuarios({ acao: 'setup', setup_token: campos.setup_token.value, nome_completo: campos.nome_completo.value, login: campos.login.value.trim().toLowerCase(), senha: campos.senha.value });
    } catch (err) { msg.textContent = err.message; msg.classList.remove('oculto'); btn.disabled = false; return; }
    toast('Administrador criado! Entre com seu login.');
    location.hash = '#/painel';
  } }, 'Criar administrador');
  limpar(app, caixaLogin(h('h1', null, 'Configuração inicial'),
    h('p', { class: 'suave', style: { margin: 0 } }, 'Crie o primeiro administrador. Esta tela só aparece enquanto não houver nenhum usuário.'),
    h('div', { class: 'campo' }, h('label', null, 'Código de configuração'), campos.setup_token),
    h('div', { class: 'campo' }, h('label', null, 'Nome completo'), campos.nome_completo),
    h('div', { class: 'campo' }, h('label', null, 'Login'), campos.login, h('span', { class: 'ajuda' }, 'Letras minúsculas, sem espaços. Ex.: bruna')),
    h('div', { class: 'campo' }, h('label', null, 'Senha'), campos.senha),
    h('div', { class: 'campo' }, h('label', null, 'Confirme a senha'), campos.conf), msg, btn));
}

// ---------------------------------------------------------------- início
(async () => {
  try {
    await iniciar();
    if (!/^#\/?(senha|configuracao-inicial)/.test(location.hash)) await restaurarSessao();
  } catch (e) {
    limpar(app, caixaLogin(h('div', { class: 'aviso vermelho' }, e.message)));
    return;
  }
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && sessao.usuario) { sessao.usuario = null; telaAtual = null; pararDeEscutar(); elConteudo = null; navegar(); }
  });
  navegar();
})();
