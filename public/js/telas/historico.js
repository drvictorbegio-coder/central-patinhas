// Histórico de Atividades (consulta administrativa): quem fez o quê, quando.
import { sb, consulta, cache, ehAdmin } from '../api.js';
import { h, limpar, fmtDataHora, tabela, carregando, exportarCsv, toast } from '../ui.js';
import { resumoAlteracao, linkPaciente } from '../acoes.js';

export const ACOES = {
  exame_cadastrado: 'Exame cadastrado', laudo_recebido: 'Laudo recebido', recebimento_desfeito: 'Recebimento desfeito',
  resultado_enviado_tutor: 'Resultado enviado ao tutor', resultado_comunicado_internacao: 'Resultado comunicado pela internação', comunicacao_desfeita: 'Comunicação desfeita',
  laboratorio_cobrado: 'Laboratório cobrado', exame_cancelado: 'Exame cancelado', exame_vinculado: 'Exame vinculado a acompanhamento', exame_alterado: 'Exame editado', correcao_administrativa: 'Correção administrativa',
  atendimento_criado: 'Atendimento aberto', retorno_criado: 'Retorno criado', retorno_exames_liberado: 'Retorno de exames liberado', retorno_exames_compativel: 'Avaliação no retorno já agendado',
  retorno_tutor_contatado: 'Tutor contatado', retorno_agendado: 'Retorno agendado', retorno_realizado: 'Comparecimento registrado', retorno_falta: 'Tutor não compareceu',
  retorno_recusado: 'Tutor recusou', retorno_dispensado: 'Retorno dispensado', retorno_reaberto: 'Retorno reaberto', retorno_previsao_alterada: 'Data prevista alterada',
  retorno_suspenso: 'Retorno suspenso (internação)', retorno_reativado: 'Retorno reativado após alta',
  internacao_iniciada: 'Internação ativada', alta_registrada: 'Alta registrada',
  tutor_cadastrado: 'Tutor cadastrado', tutor_alterado: 'Cadastro de tutor alterado', animal_cadastrado: 'Paciente cadastrado', animal_alterado: 'Cadastro de paciente alterado',
  configuracao_alterada: 'Configuração alterada',
  usuario_criado: 'Usuário criado', usuario_alterado: 'Usuário alterado', usuario_bloqueado: 'Usuário bloqueado', usuario_desativado: 'Usuário desativado', usuario_reativado: 'Usuário reativado',
  acesso_redefinido: 'Link de acesso gerado', senha_definida: 'Senha definida', senha_solicitada: 'Pedido de nova senha', login: 'Entrada no sistema',
};

export async function render(el) {
  const perfis = await cache.perfis();
  let limite = 200;
  const f = {
    func: sel([['', 'Todos os funcionários'], ...perfis.map((p) => [p.id, p.nome_completo + (p.situacao !== 'ativo' ? ` (${p.situacao})` : '')])]),
    acao: sel([['', 'Todas as ações'], ...Object.entries(ACOES).filter(([k]) => ehAdmin() || !/^usuario_|acesso_|senha_|login/.test(k)).sort((a, b) => a[1].localeCompare(b[1]))]),
    de: h('input', { type: 'date' }), ate: h('input', { type: 'date' }),
    texto: h('input', { type: 'search', placeholder: 'Paciente, exame, tutor…' }),
  };
  const campo = (rot, input) => h('div', { class: 'campo' }, h('label', null, rot), input);
  const elLista = h('div', null, carregando());
  limpar(el,
    h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Histórico de Atividades'),
      h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'Registro automático e permanente: ninguém pode editar ou apagar. Funcionários desativados continuam com seu histórico.'))),
    h('div', { class: 'cartao' },
      h('div', { class: 'filtros' }, h('div', { class: 'grade-form' }, campo('Funcionário', f.func), campo('Tipo de ação', f.acao), campo('De', f.de), campo('Até', f.ate), campo('Buscar na descrição', f.texto)),
        h('div', { class: 'filtros-rodape' }, h('button', { class: 'btn primario', onclick: () => { limite = 200; carregar(); } }, 'Aplicar filtros'),
          h('button', { class: 'btn', onclick: exportar }, '⬇ Exportar Excel/CSV'))),
      elLista));
  el.querySelector('.filtros').addEventListener('keydown', (e) => { if (e.key === 'Enter') carregar(); });

  function base(q) {
    if (f.func.value) q = q.eq('usuario_id', f.func.value);
    if (f.acao.value) q = q.eq('acao', f.acao.value);
    if (f.de.value) q = q.gte('ocorrido_em', `${f.de.value}T00:00:00-03:00`);
    if (f.ate.value) q = q.lte('ocorrido_em', `${f.ate.value}T23:59:59.999-03:00`);
    if (f.texto.value.trim()) q = q.ilike('descricao', `%${f.texto.value.trim().replace(/[%,()*]/g, ' ')}%`);
    return q.order('ocorrido_em', { ascending: false }).order('id', { ascending: false });
  }
  async function carregar() {
    const res = await consulta(base(sb.from('historico').select('*, animais(nome)', { count: 'exact' })).range(0, limite - 1));
    limpar(elLista,
      h('div', { style: { padding: '10px 16px', borderBottom: '1px solid var(--borda)' } }, h('b', null, `${res.count} registro(s)`)),
      tabela([
        { titulo: 'Data e horário', valor: (x) => h('span', { class: 'nowrap' }, fmtDataHora(x.ocorrido_em)) },
        { titulo: 'Funcionário', valor: (x) => h('b', null, x.usuario_nome) },
        { titulo: 'Ação', valor: (x) => ACOES[x.acao] || x.acao },
        { titulo: 'Paciente', valor: (x) => x.animal_id ? linkPaciente(x.animal_id, x.animais ? x.animais.nome : '#' + x.animal_id) : '—' },
        { titulo: 'Descrição', valor: (x) => h('div', null, x.descricao, resumoAlteracao(x)) },
      ], res.data, { vazio: 'Nenhum registro encontrado.' }),
      res.count > res.data.length ? h('div', { class: 'mais' }, h('button', { class: 'btn', onclick: () => { limite += 200; carregar(); } }, 'Carregar mais')) : null);
  }
  async function exportar() {
    try {
      const linhas = await consulta(base(sb.from('historico').select('*, animais(nome)')).range(0, 19999));
      exportarCsv('historico', [
        { titulo: 'Data e horário', valor: (x) => fmtDataHora(x.ocorrido_em) }, { titulo: 'Funcionário', valor: (x) => x.usuario_nome },
        { titulo: 'ID do funcionário', valor: (x) => x.usuario_id }, { titulo: 'Ação', valor: (x) => ACOES[x.acao] || x.acao },
        { titulo: 'Paciente', valor: (x) => x.animais ? x.animais.nome : '' }, { titulo: 'Descrição', valor: (x) => x.descricao },
        { titulo: 'Valor anterior', valor: (x) => x.antes ? JSON.stringify(x.antes) : '' }, { titulo: 'Novo valor', valor: (x) => x.depois ? JSON.stringify(x.depois) : '' },
      ], linhas);
      toast(`${linhas.length} registro(s) exportado(s).`);
    } catch (e) { toast(e.message, 'erro'); }
  }
  await carregar();
  return { atualizar: carregar };
}
const sel = (o) => h('select', null, o.map(([v, t]) => h('option', { value: v }, t)));
