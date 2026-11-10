// Controle de Exames: listas por situação, filtros completos e exportação.
import { rpc, sb, consulta, cache } from '../api.js';
import { h, limpar, fmtData, fmtDataHora, tabela, seloExame, corLinhaExame, carregando, exportarCsv, toast } from '../ui.js';
import { acoesExame, celulaPaciente, celulaTutor } from '../acoes.js';
import { abrirCadastroExames } from '../formExames.js';
import { acaoNecessariaExame } from './painel.js';

const ABAS = [
  ['atrasado', 'Atrasados', 'vermelho'], ['cobrar', 'Cobrar laboratório', 'vermelho'], ['vence_hoje', 'Vencem hoje', 'amarelo'],
  ['no_prazo', 'Dentro do prazo'], ['comunicar', 'Aguardando comunicação'], ['aguardando', 'Todos aguardando laudo'], ['todos', 'Consultar todos'],
];
const POR_PAGINA = 300;

export async function render(el, rota) {
  let aba = rota.params.get('f') || 'atrasado';
  let limite = POR_PAGINA;
  const [tipos, labs, perfis] = await Promise.all([cache.tipos(), cache.laboratorios(), cache.perfis()]);

  // ---------- filtros
  const f = {
    campoData: sel([['data_realizacao', 'Data de realização'], ['data_prevista', 'Data prevista do resultado'], ['data_recebimento', 'Data do recebimento']]),
    de: h('input', { type: 'date' }), ate: h('input', { type: 'date' }),
    tipo: sel([['', 'Todos'], ...tipos.map((t) => [t.id, t.nome])]),
    lab: sel([['', 'Todos'], ...labs.map((l) => [l.id, l.nome])]),
    status: sel([['', 'Todos'], ['atrasado', 'Atrasado'], ['vence_hoje', 'Vence hoje'], ['no_prazo', 'Dentro do prazo'], ['recebido', 'Laudo recebido'], ['recebido_nao_comunicado', 'Recebido, aguardando comunicação'], ['comunicado_tutor', 'Enviado ao tutor'], ['comunicado_internacao', 'Comunicado pela internação'], ['recebido_com_atraso', 'Recebido com atraso'], ['cancelado', 'Cancelado']]),
    tutor: h('input', { type: 'text', placeholder: 'Nome do tutor' }), animal: h('input', { type: 'text', placeholder: 'Nome do animal' }),
    tutorId: h('input', { type: 'text', placeholder: 'ID do tutor' }), animalId: h('input', { type: 'text', placeholder: 'ID do paciente' }),
    func: sel([['', 'Todos'], ...perfis.map((p) => [p.id, p.nome_completo])]),
    internado: sel([['', 'Todos'], ['sim', 'Somente internados'], ['nao', 'Somente não internados']]),
  };
  const campo = (rot, input) => h('div', { class: 'campo' }, h('label', null, rot), input);
  const painelFiltros = h('div', { class: 'filtros' },
    h('div', { class: 'grade-form' },
      campo('Período por', f.campoData), campo('De', f.de), campo('Até', f.ate), campo('Tipo de exame', f.tipo), campo('Laboratório', f.lab),
      campo('Status', f.status), campo('Nome do tutor', f.tutor), campo('Nome do animal', f.animal), campo('ID do tutor', f.tutorId),
      campo('ID do paciente', f.animalId), campo('Funcionário responsável', f.func), campo('Internação', f.internado)),
    h('div', { class: 'filtros-rodape' },
      h('button', { class: 'btn primario', onclick: () => { limite = POR_PAGINA; carregar(); } }, 'Aplicar filtros'),
      h('button', { class: 'btn', onclick: () => { Object.values(f).forEach((x) => { x.value = x.tagName === 'SELECT' ? x.options[0].value : ''; }); carregar(); } }, 'Limpar'),
      h('button', { class: 'btn', onclick: exportar }, '⬇ Exportar Excel/CSV'),
      h('span', { class: 'fraco' }, 'Os filtros combinam com a aba selecionada.')));
  painelFiltros.addEventListener('keydown', (e) => { if (e.key === 'Enter') carregar(); });

  const elAbas = h('div', { class: 'abas' });
  const elLista = h('div', null, carregando());
  const mostrarFiltros = h('button', { class: 'btn', onclick: () => painelFiltros.classList.toggle('oculto') }, '🔎 Filtros');
  limpar(el,
    h('div', { class: 'cabecalho' }, h('h1', null, 'Controle de Exames'),
      h('div', { class: 'acoes' }, mostrarFiltros, h('button', { class: 'btn primario', onclick: () => abrirCadastroExames({ aoSalvar: carregar }) }, '+ Cadastrar exames'))),
    elAbas,
    h('div', { class: 'cartao' }, painelFiltros, elLista));
  if (aba !== 'todos' || window.innerWidth < 700) painelFiltros.classList.add('oculto');
  if (rota.params.get('novo')) { history.replaceState(null, '', '#/exames'); abrirCadastroExames({ aoSalvar: carregar }); }

  function consultaBase(q) {
    switch (aba) {
      case 'atrasado': q = q.eq('situacao', 'ativo').eq('classificacao', 'atrasado'); break;
      case 'cobrar': q = q.eq('precisa_cobranca', true); break;
      case 'vence_hoje': q = q.eq('situacao', 'ativo').eq('classificacao', 'vence_hoje'); break;
      case 'no_prazo': q = q.eq('situacao', 'ativo').eq('classificacao', 'no_prazo'); break;
      case 'comunicar': q = q.eq('aguardando_comunicacao', true); break;
      case 'aguardando': q = q.eq('situacao', 'ativo').is('recebido_em', null); break;
      default: break;
    }
    if (f.de.value) q = q.gte(f.campoData.value, f.de.value);
    if (f.ate.value) q = q.lte(f.campoData.value, f.ate.value);
    if (f.tipo.value) q = q.eq('tipo_exame_id', f.tipo.value);
    if (f.lab.value) q = q.eq('laboratorio_id', f.lab.value);
    const st = f.status.value;
    if (st === 'recebido_nao_comunicado') q = q.eq('aguardando_comunicacao', true);
    else if (st === 'comunicado_tutor') q = q.eq('comunicacao_tipo', 'tutor');
    else if (st === 'comunicado_internacao') q = q.eq('comunicacao_tipo', 'internacao');
    else if (st === 'recebido_com_atraso') q = q.eq('recebido_com_atraso', true);
    else if (st) q = q.eq('classificacao', st);
    if (f.tutor.value.trim()) q = q.ilike('tutor_nome', `%${limparBusca(f.tutor.value)}%`);
    if (f.animal.value.trim()) q = q.ilike('animal_nome', `%${limparBusca(f.animal.value)}%`);
    if (f.tutorId.value.trim()) q = q.ilike('tutor_id_externo', limparBusca(f.tutorId.value));
    if (f.animalId.value.trim()) q = q.ilike('animal_id_externo', limparBusca(f.animalId.value));
    if (f.func.value) q = q.or(`criado_por.eq.${f.func.value},recebido_por.eq.${f.func.value},comunicado_por.eq.${f.func.value},atualizado_por.eq.${f.func.value}`);
    if (f.internado.value) q = q.eq('internado', f.internado.value === 'sim');
    const recentes = aba === 'todos' || aba === 'comunicar';
    return q.order(recentes ? 'data_realizacao' : 'data_prevista', { ascending: !recentes }).order('id');
  }

  async function carregar() {
    const [p, res] = await Promise.all([
      rpc('painel_contadores'),
      consulta(consultaBase(sb.from('v_exames').select('*', { count: 'exact' })).range(0, limite - 1)),
    ]);
    const n = { atrasado: p.exames.atrasados, cobrar: p.exames.precisa_cobranca, vence_hoje: p.exames.vence_hoje, no_prazo: p.exames.no_prazo, comunicar: p.exames.aguardando_comunicacao };
    limpar(elAbas, ABAS.map(([k, t, cor]) => h('button', { class: `aba ${cor || ''} ${aba === k ? 'ativa' : ''}`, onclick: () => {
      aba = k; limite = POR_PAGINA; history.replaceState(null, '', `#/exames?f=${k}`);
      if (k === 'todos' && window.innerWidth >= 700) painelFiltros.classList.remove('oculto');
      carregar();
    } }, t, n[k] !== undefined ? h('span', { class: 'n' }, n[k]) : null)));
    const linhas = res.data;
    limpar(elLista,
      h('div', { class: 'cab', style: { padding: '10px 16px', borderBottom: '1px solid var(--borda)', display: 'flex', gap: '8px', alignItems: 'center' } },
        h('b', null, `${res.count} exame(s)`), aba === 'cobrar' ? h('span', { class: 'fraco' }, '— ao registrar a cobrança, o exame sai desta lista hoje e volta no próximo dia útil se o laudo não chegar.') : null),
      tabela([
        { titulo: 'Paciente', valor: celulaPaciente },
        { titulo: 'Tutor', valor: celulaTutor },
        { titulo: 'Exame', valor: (e) => h('div', null, h('b', null, e.tipo_nome), h('div', { class: 'sub' }, `Realizado em ${fmtData(e.data_realizacao)} · grupo ${e.grupo_recebidos}/${e.grupo_total}`)) },
        { titulo: 'Laboratório', valor: (e) => e.laboratorio_nome },
        { titulo: 'Previsão', valor: (e) => h('div', { class: 'nowrap' }, fmtData(e.data_prevista), e.qtd_cobrancas ? h('div', { class: 'sub' }, `${e.qtd_cobrancas} cobrança(s)`) : null) },
        { titulo: 'Status', valor: (e) => h('div', null, seloExame(e), e.recebido_em ? h('div', { class: 'sub' }, `${e.recebido_por_nome} · ${fmtDataHora(e.recebido_em)}`) : null) },
        { titulo: 'Ação necessária', valor: (e) => h('div', null, e.situacao === 'ativo' && !e.comunicado_em ? h('div', { class: 'sub', style: { marginBottom: '4px' } }, acaoNecessariaExame(e)) : null, acoesExame(e, carregar)) },
      ], linhas, { vazio: mensagemVazia(aba), classeLinha: corLinhaExame }),
      res.count > linhas.length ? h('div', { class: 'mais' }, h('button', { class: 'btn', onclick: () => { limite += POR_PAGINA; carregar(); } }, `Mostrar mais (${res.count - linhas.length} restantes)`)) : null);
  }

  async function exportar() {
    try {
      const linhas = await consulta(consultaBase(sb.from('v_exames').select('*')).range(0, 9999));
      exportarCsv(`exames_${aba}`, [
        { titulo: 'Paciente', valor: (e) => e.animal_nome }, { titulo: 'ID paciente', valor: (e) => e.animal_id_externo }, { titulo: 'Espécie', valor: (e) => e.especie },
        { titulo: 'Tutor', valor: (e) => e.tutor_nome }, { titulo: 'ID tutor', valor: (e) => e.tutor_id_externo }, { titulo: 'Telefone', valor: (e) => e.tutor_telefone },
        { titulo: 'Exame', valor: (e) => e.tipo_nome }, { titulo: 'Laboratório', valor: (e) => e.laboratorio_nome },
        { titulo: 'Realização', valor: (e) => fmtData(e.data_realizacao) }, { titulo: 'Prazo (dias úteis)', valor: (e) => e.prazo_dias },
        { titulo: 'Previsão', valor: (e) => fmtData(e.data_prevista) }, { titulo: 'Classificação', valor: (e) => e.classificacao },
        { titulo: 'Recebido em', valor: (e) => e.recebido_em ? fmtDataHora(e.recebido_em) : '' }, { titulo: 'Recebido por', valor: (e) => e.recebido_por_nome },
        { titulo: 'Comunicação', valor: (e) => e.comunicacao_tipo === 'tutor' ? 'Enviado ao tutor' : e.comunicacao_tipo === 'internacao' ? 'Pela internação' : '' },
        { titulo: 'Comunicado em', valor: (e) => e.comunicado_em ? fmtDataHora(e.comunicado_em) : '' }, { titulo: 'Comunicado por', valor: (e) => e.comunicado_por_nome },
        { titulo: 'Cobranças', valor: (e) => e.qtd_cobrancas }, { titulo: 'Internado', valor: (e) => e.internado ? 'Sim' : 'Não' },
        { titulo: 'Cadastrado por', valor: (e) => e.criado_por_nome }, { titulo: 'Cadastrado em', valor: (e) => fmtDataHora(e.criado_em) },
        { titulo: 'Observações', valor: (e) => e.observacoes }, { titulo: 'Situação', valor: (e) => e.situacao },
      ], linhas);
      toast(`${linhas.length} exame(s) exportado(s).`);
    } catch (e) { toast(e.message, 'erro'); }
  }

  await carregar();
  return { atualizar: carregar };
}

function sel(opcoes) { return h('select', null, opcoes.map(([v, t]) => h('option', { value: v }, t))); }
const limparBusca = (s) => s.trim().replace(/[%,()*]/g, ' ');
function mensagemVazia(aba) {
  return { atrasado: 'Nenhum exame atrasado. 🎉', cobrar: 'Nenhum laboratório para cobrar hoje.', vence_hoje: 'Nenhum exame vence hoje.',
    comunicar: 'Nenhum resultado aguardando comunicação.', no_prazo: 'Nenhum exame dentro do prazo aguardando laudo.' }[aba] || 'Nenhum exame encontrado com estes filtros.';
}
