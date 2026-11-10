// Controle de Retornos (independente dos exames).
import { rpc, sb, consulta, cache } from '../api.js';
import { h, limpar, fmtData, fmtDataHora, tabela, seloRetorno, corLinhaRetorno, carregando, exportarCsv, toast, RETORNO_TIPO, RETORNO_STATUS } from '../ui.js';
import { acoesRetorno, celulaPaciente, celulaTutor, celulaRetornoTipo, celulaRetornoDatas } from '../acoes.js';

const ABAS = [
  ['vencido', 'Vencidos', 'vermelho'], ['hoje', 'Hoje', 'amarelo'], ['proximo', 'Próximos'], ['aguardando', 'Aguardando agendamento', 'amarelo'],
  ['agendado', 'Agendados'], ['realizado', 'Realizados'], ['exames_pendentes', 'Com exames pendentes'], ['suspenso', 'Suspensos por internação'], ['todos', 'Consultar todos'],
];
const ABERTOS = ['aguardando_agendamento', 'tutor_contatado', 'agendado'];

export async function render(el, rota) {
  let aba = rota.params.get('g') || 'vencido';
  let limite = 300;
  const perfis = await cache.perfis();
  const f = {
    campoData: sel([['data_prevista', 'Data prevista'], ['data_consulta', 'Data agendada da consulta'], ['data_realizado', 'Data de realização']]),
    de: h('input', { type: 'date' }), ate: h('input', { type: 'date' }),
    tipo: sel([['', 'Todos'], ...Object.entries(RETORNO_TIPO)]),
    status: sel([['', 'Todos'], ...Object.entries(RETORNO_STATUS).map(([k, v]) => [k, v[0]])]),
    tutor: h('input', { type: 'text', placeholder: 'Nome do tutor' }), animal: h('input', { type: 'text', placeholder: 'Nome do animal' }),
    tutorId: h('input', { type: 'text', placeholder: 'ID do tutor' }), animalId: h('input', { type: 'text', placeholder: 'ID do paciente' }),
    func: sel([['', 'Todos'], ...perfis.map((p) => [p.id, p.nome_completo])]),
    internado: sel([['', 'Todos'], ['sim', 'Somente internados'], ['nao', 'Somente não internados']]),
  };
  const campo = (rot, input) => h('div', { class: 'campo' }, h('label', null, rot), input);
  const painelFiltros = h('div', { class: 'filtros' },
    h('div', { class: 'grade-form' }, campo('Período por', f.campoData), campo('De', f.de), campo('Até', f.ate), campo('Tipo de retorno', f.tipo), campo('Status', f.status),
      campo('Nome do tutor', f.tutor), campo('Nome do animal', f.animal), campo('ID do tutor', f.tutorId), campo('ID do paciente', f.animalId),
      campo('Funcionário responsável', f.func), campo('Internação', f.internado)),
    h('div', { class: 'filtros-rodape' },
      h('button', { class: 'btn primario', onclick: () => carregar() }, 'Aplicar filtros'),
      h('button', { class: 'btn', onclick: () => { Object.values(f).forEach((x) => { x.value = x.tagName === 'SELECT' ? x.options[0].value : ''; }); carregar(); } }, 'Limpar'),
      h('button', { class: 'btn', onclick: exportar }, '⬇ Exportar Excel/CSV')));
  painelFiltros.addEventListener('keydown', (e) => { if (e.key === 'Enter') carregar(); });
  if (aba !== 'todos' || window.innerWidth < 700) painelFiltros.classList.add('oculto');
  const elAbas = h('div', { class: 'abas' });
  const elLista = h('div', null, carregando());
  limpar(el,
    h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Controle de Retornos'), h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'O alerta aparece somente a partir da data prevista. Retornos futuros ficam em "Próximos".')),
      h('div', { class: 'acoes' }, h('button', { class: 'btn', onclick: () => painelFiltros.classList.toggle('oculto') }, '🔎 Filtros'))),
    elAbas, h('div', { class: 'cartao' }, painelFiltros, elLista));

  function consultaBase(q) {
    switch (aba) {
      case 'vencido': case 'hoje': case 'proximo': q = q.eq('classificacao', aba); break;
      case 'aguardando': q = q.in('status', ['aguardando_agendamento', 'tutor_contatado']).lte('data_prevista', hoje()); break;
      case 'agendado': q = q.eq('status', 'agendado'); break;
      case 'realizado': q = q.eq('status', 'realizado'); break;
      case 'exames_pendentes': q = q.gt('exames_pendentes', 0).in('status', [...ABERTOS, 'suspenso_internacao']); break;
      case 'suspenso': q = q.eq('status', 'suspenso_internacao'); break;
      default: break;
    }
    if (f.de.value) q = q.gte(f.campoData.value, f.de.value);
    if (f.ate.value) q = q.lte(f.campoData.value, f.ate.value);
    if (f.tipo.value) q = q.eq('tipo', f.tipo.value);
    if (f.status.value) q = q.eq('status', f.status.value);
    if (f.tutor.value.trim()) q = q.ilike('tutor_nome', `%${lb(f.tutor.value)}%`);
    if (f.animal.value.trim()) q = q.ilike('animal_nome', `%${lb(f.animal.value)}%`);
    if (f.tutorId.value.trim()) q = q.ilike('tutor_id_externo', lb(f.tutorId.value));
    if (f.animalId.value.trim()) q = q.ilike('animal_id_externo', lb(f.animalId.value));
    if (f.func.value) q = q.or(`criado_por.eq.${f.func.value},atualizado_por.eq.${f.func.value}`);
    if (f.internado.value) q = q.eq('internado', f.internado.value === 'sim');
    const desc = ['realizado', 'todos'].includes(aba);
    return q.order(aba === 'realizado' ? 'data_realizado' : 'data_referencia', { ascending: !desc }).order('id');
  }

  async function carregar() {
    const [p, res] = await Promise.all([rpc('painel_contadores'), consulta(consultaBase(sb.from('v_retornos').select('*', { count: 'exact' })).range(0, limite - 1))]);
    window.__hoje = p.hoje;
    const n = { vencido: p.retornos.vencidos, hoje: p.retornos.hoje, proximo: p.retornos.proximos, aguardando: p.retornos.aguardando, agendado: p.retornos.agendados, exames_pendentes: p.retornos.exames_pendentes, suspenso: p.retornos.suspensos };
    limpar(elAbas, ABAS.map(([k, t, cor]) => h('button', { class: `aba ${cor || ''} ${aba === k ? 'ativa' : ''}`, onclick: () => {
      aba = k; history.replaceState(null, '', `#/retornos?g=${k}`); if (k === 'todos' && window.innerWidth >= 700) painelFiltros.classList.remove('oculto'); carregar();
    } }, t, n[k] !== undefined ? h('span', { class: 'n' }, n[k]) : null)));
    limpar(elLista,
      h('div', { style: { padding: '10px 16px', borderBottom: '1px solid var(--borda)' } }, h('b', null, `${res.count} retorno(s)`)),
      tabela([
        { titulo: 'Paciente', valor: celulaPaciente },
        { titulo: 'Tutor', valor: celulaTutor },
        { titulo: 'Tipo de retorno', valor: celulaRetornoTipo },
        { titulo: 'Datas', valor: celulaRetornoDatas },
        { titulo: 'Status', valor: (r) => h('div', null, seloRetorno(r), r.atualizado_por_nome ? h('div', { class: 'sub' }, `${r.atualizado_por_nome} · ${fmtDataHora(r.atualizado_em)}`) : null, r.motivo ? h('div', { class: 'sub' }, r.motivo) : null) },
        { titulo: 'Ação necessária', valor: (r) => acoesRetorno(r, carregar) },
      ], res.data, { vazio: 'Nenhum retorno nesta lista.', classeLinha: corLinhaRetorno }),
      res.count > res.data.length ? h('div', { class: 'mais' }, h('button', { class: 'btn', onclick: () => { limite += 300; carregar(); } }, 'Mostrar mais')) : null);
  }

  async function exportar() {
    try {
      const linhas = await consulta(consultaBase(sb.from('v_retornos').select('*')).range(0, 9999));
      exportarCsv(`retornos_${aba}`, [
        { titulo: 'Paciente', valor: (r) => r.animal_nome }, { titulo: 'ID paciente', valor: (r) => r.animal_id_externo },
        { titulo: 'Tutor', valor: (r) => r.tutor_nome }, { titulo: 'ID tutor', valor: (r) => r.tutor_id_externo }, { titulo: 'Telefone', valor: (r) => r.tutor_telefone },
        { titulo: 'Tipo', valor: (r) => RETORNO_TIPO[r.tipo] }, { titulo: 'Status', valor: (r) => (RETORNO_STATUS[r.status] || [r.status])[0] },
        { titulo: 'Data prevista', valor: (r) => fmtData(r.data_prevista) }, { titulo: 'Agendado em', valor: (r) => r.data_agendamento ? fmtDataHora(r.data_agendamento) : '' },
        { titulo: 'Data da consulta', valor: (r) => r.data_consulta ? fmtData(r.data_consulta) : '' }, { titulo: 'Horário', valor: (r) => r.hora_consulta ? r.hora_consulta.slice(0, 5) : '' },
        { titulo: 'Realizado em', valor: (r) => r.data_realizado ? fmtData(r.data_realizado) : '' }, { titulo: 'Exames pendentes', valor: (r) => r.exames_pendentes_nomes || '' },
        { titulo: 'Motivo', valor: (r) => r.motivo }, { titulo: 'Internado', valor: (r) => r.internado ? 'Sim' : 'Não' },
        { titulo: 'Última atualização por', valor: (r) => r.atualizado_por_nome }, { titulo: 'Última atualização em', valor: (r) => fmtDataHora(r.atualizado_em) },
      ], linhas);
      toast(`${linhas.length} retorno(s) exportado(s).`);
    } catch (e) { toast(e.message, 'erro'); }
  }

  await carregar();
  return { atualizar: carregar };
}
const sel = (o) => h('select', null, o.map(([v, t]) => h('option', { value: v }, t)));
const lb = (s) => s.trim().replace(/[%,()*]/g, ' ');
const hoje = () => window.__hoje || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
