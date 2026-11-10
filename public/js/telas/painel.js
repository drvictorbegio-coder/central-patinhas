// Dashboard — Central da Recepção: indicadores clicáveis e pendências de hoje.
import { rpc, sb, consulta, sessao } from '../api.js';
import { h, limpar, fmtData, tabela, seloExame, seloRetorno, corLinhaExame, corLinhaRetorno, carregando, RETORNO_TIPO } from '../ui.js';
import { acoesExame, acoesRetorno, celulaPaciente, celulaTutor, celulaRetornoTipo } from '../acoes.js';

export async function render(el) {
  const indicadores = h('div');
  const pendExames = h('div', { class: 'cartao' }, carregando());
  const pendRetornos = h('div', { class: 'cartao' }, carregando());
  const saudacao = () => { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; };

  limpar(el,
    h('div', { class: 'cabecalho' },
      h('div', null, h('h1', null, 'Central da Recepção'), h('p', { class: 'suave', style: { margin: '4px 0 0' } }, `${saudacao()}, ${sessao.usuario.nome_completo.split(' ')[0]}! Estas são as pendências que precisam de atenção.`)),
      h('div', { class: 'acoes' },
        h('a', { class: 'btn primario', href: '#/exames?novo=1' }, '+ Cadastrar exames'),
        h('a', { class: 'btn', href: '#/pacientes' }, 'Pesquisar paciente'))),
    indicadores,
    h('div', { class: 'secao' }, h('h2', null, 'Exames que precisam de ação hoje'), pendExames),
    h('div', { class: 'secao' }, h('h2', null, 'Retornos para hoje e vencidos'), pendRetornos));

  async function atualizar() {
    const [p, exames, retornos] = await Promise.all([
      rpc('painel_contadores'),
      consulta(sb.from('v_exames').select('*').eq('situacao', 'ativo')
        .or(`and(recebido_em.is.null,data_prevista.lte.${hoje()}),and(recebido_em.not.is.null,comunicado_em.is.null)`)
        .order('data_prevista').limit(200)),
      consulta(sb.from('v_retornos').select('*').in('classificacao', ['vencido', 'hoje']).order('data_referencia').limit(200)),
    ]);
    window.__hoje = p.hoje;
    const ind = (rot, n, cor, href, ajuda) => h('button', { class: `ind ${n ? cor : 'zero'}`, onclick: () => { location.hash = href; }, title: ajuda || rot },
      h('span', { class: 'num' }, n), h('span', { class: 'rot' }, rot));
    limpar(indicadores,
      h('div', { class: 'secao' }, h('h2', null, '🧪 Exames'), h('div', { class: 'grade-ind' },
        ind('Exames atrasados', p.exames.atrasados, 'vermelho', '#/exames?f=atrasado'),
        ind('Vencem hoje', p.exames.vence_hoje, 'amarelo', '#/exames?f=vence_hoje'),
        ind('Dentro do prazo', p.exames.no_prazo, 'verde', '#/exames?f=no_prazo'),
        ind('Laudos aguardando comunicação', p.exames.aguardando_comunicacao, 'azul', '#/exames?f=comunicar'),
        ind('Atrasados aguardando cobrança', p.exames.precisa_cobranca, 'vermelho', '#/exames?f=cobrar', 'Laboratórios que precisam ser cobrados hoje'))),
      h('div', { class: 'secao' }, h('h2', null, '📅 Retornos'), h('div', { class: 'grade-ind' },
        ind('Retornos vencidos', p.retornos.vencidos, 'vermelho', '#/retornos?g=vencido'),
        ind('Retornos de hoje', p.retornos.hoje, 'amarelo', '#/retornos?g=hoje'),
        ind('Próximos retornos', p.retornos.proximos, 'azul', '#/retornos?g=proximo'),
        ind('Aguardando agendamento', p.retornos.aguardando, 'amarelo', '#/retornos?g=aguardando'),
        ind('Retornos agendados', p.retornos.agendados, 'azul', '#/retornos?g=agendado'),
        ind('Com exames pendentes', p.retornos.exames_pendentes, 'cinza', '#/retornos?g=exames_pendentes'))),
      h('div', { class: 'secao' }, h('div', { class: 'grade-ind' },
        ind('🏥 Pacientes internados', p.internados, 'azul', '#/internados'),
        ind('Retornos suspensos por internação', p.retornos.suspensos, 'cinza', '#/retornos?g=suspenso'))));

    const ordemEx = { atrasado: 0, vence_hoje: 1, recebido: 2 };
    exames.sort((a, b) => (ordemEx[a.classificacao] ?? 3) - (ordemEx[b.classificacao] ?? 3) || a.data_prevista.localeCompare(b.data_prevista));
    limpar(pendExames, tabela([
      { titulo: 'Paciente', valor: celulaPaciente },
      { titulo: 'Tutor', valor: celulaTutor },
      { titulo: 'Exame', valor: (e) => h('div', null, e.tipo_nome, h('div', { class: 'sub' }, e.laboratorio_nome)) },
      { titulo: 'Previsão', valor: (e) => h('span', { class: 'nowrap' }, fmtData(e.data_prevista)) },
      { titulo: 'Status', valor: seloExame },
      { titulo: 'Ação necessária', valor: (e) => h('div', null, h('div', { class: 'sub', style: { marginBottom: '4px' } }, acaoNecessariaExame(e)), acoesExame(e, atualizar)) },
    ], exames, { vazio: 'Nenhum exame atrasado, vencendo hoje ou aguardando comunicação.', classeLinha: corLinhaExame }));

    limpar(pendRetornos, tabela([
      { titulo: 'Paciente', valor: celulaPaciente },
      { titulo: 'Tutor', valor: celulaTutor },
      { titulo: 'Retorno', valor: celulaRetornoTipo },
      { titulo: 'Data', valor: (r) => h('span', { class: 'nowrap' }, fmtData(r.data_referencia)) },
      { titulo: 'Status', valor: seloRetorno },
      { titulo: 'Ação necessária', valor: (r) => acoesRetorno(r, atualizar) },
    ], retornos, { vazio: 'Nenhum retorno vencido ou para hoje.', classeLinha: corLinhaRetorno }));
  }
  await atualizar();
  return { atualizar };
}

const hoje = () => window.__hoje || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function acaoNecessariaExame(e) {
  if (e.recebido_em && !e.comunicado_em) return e.internado ? 'Comunicar resultado (paciente internado)' : 'Enviar resultado ao tutor';
  if (e.precisa_cobranca) return 'Cobrar o laboratório';
  if (e.classificacao === 'atrasado') return 'Aguardar laudo (já cobrado hoje)';
  if (e.classificacao === 'vence_hoje') return 'Conferir se o laudo chegou';
  return 'Aguardar laudo';
}
export { RETORNO_TIPO };
