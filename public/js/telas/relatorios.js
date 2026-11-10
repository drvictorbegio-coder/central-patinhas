// Relatórios Gerenciais (administradores) — calculados a partir dos registros reais do banco.
import { rpc } from '../api.js';
import { h, limpar, hojeISO, fmtData, carregando, exportarCsv, tabela } from '../ui.js';

export async function render(el) {
  const hoje = hojeISO();
  const de = h('input', { type: 'date', value: hoje.slice(0, 8) + '01' });
  const ate = h('input', { type: 'date', value: hoje });
  const atalho = (t, ini, fim) => h('button', { class: 'btn peq', onclick: () => { de.value = ini; ate.value = fim; carregar(); } }, t);
  const mesPassado = (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(0); const fim = d.toISOString().slice(0, 10); return [fim.slice(0, 8) + '01', fim]; })();
  const corpo = h('div', null, carregando());
  limpar(el,
    h('div', { class: 'cabecalho' }, h('h1', null, 'Relatórios Gerenciais')),
    h('div', { class: 'cartao secao' }, h('div', { class: 'corpo linha-form' },
      h('div', { class: 'campo' }, h('label', null, 'De'), de), h('div', { class: 'campo' }, h('label', null, 'Até'), ate),
      h('button', { class: 'btn primario', onclick: () => carregar() }, 'Atualizar'),
      atalho('Este mês', hoje.slice(0, 8) + '01', hoje), atalho('Mês passado', ...mesPassado), atalho('Este ano', hoje.slice(0, 5) + '01-01', hoje))),
    corpo);

  async function carregar() {
    limpar(corpo, carregando());
    const r = await rpc('relatorio_gerencial', { p_inicio: de.value, p_fim: ate.value });
    const ex = r.exames, rt = r.retornos;
    const kpi = (rot, n, cor = 'cinza', sub) => h('div', { class: `ind ${n ? cor : 'zero'}`, style: { cursor: 'default' } }, h('span', { class: 'num' }, n), h('span', { class: 'rot' }, rot), sub ? h('span', { class: 'fraco' }, sub) : null);
    const barra = (pct) => h('div', { class: 'barra', title: `${pct}%` }, h('i', { style: { width: `${Math.min(100, pct || 0)}%` } }));
    limpar(corpo,
      h('p', { class: 'fraco' }, `Período: ${fmtData(r.periodo.inicio)} a ${fmtData(r.periodo.fim)}. Exames considerados pela data de realização; retornos pela data prevista.`),
      h('div', { class: 'secao' }, h('h2', null, '🧪 Exames'), h('div', { class: 'grade-ind' },
        kpi('Exames realizados', ex.total, 'azul'), kpi('Exames com atraso', ex.atrasados, 'vermelho', `${ex.percentual_atraso}% do total`),
        kpi('Ainda aguardando laudo', ex.aguardando_laudo, 'amarelo'), kpi('Aguardando comunicação', ex.aguardando_comunicacao, 'azul'),
        kpi('Cobranças realizadas', ex.cobrancas, 'amarelo'))),
      h('div', { class: 'secao' }, h('div', { class: 'cartao' },
        h('div', { class: 'cab' }, h('h3', null, 'Laboratórios — atrasos e tempo real de entrega'),
          h('button', { class: 'btn peq', style: { marginLeft: 'auto' }, onclick: () => exportarCsv('relatorio_laboratorios', colsLab, ex.por_laboratorio) }, '⬇ Exportar')),
        tabela([
          { titulo: 'Laboratório', valor: (l) => h('b', null, l.nome) }, { titulo: 'Exames', valor: (l) => l.total },
          { titulo: 'Atrasados', valor: (l) => h('div', null, `${l.atrasados} (${l.percentual_atraso}%)`, barra(l.percentual_atraso)) },
          { titulo: 'Tempo médio (dias úteis)', valor: (l) => l.media_dias_uteis ?? '—' }, { titulo: 'Tempo médio (dias corridos)', valor: (l) => l.media_dias_corridos ?? '—' },
          { titulo: 'Cobranças', valor: (l) => l.cobrancas },
        ], ex.por_laboratorio, { vazio: 'Sem exames no período.' }))),
      h('div', { class: 'secao' }, h('div', { class: 'cartao' },
        h('div', { class: 'cab' }, h('h3', null, 'Tempo médio de entrega por tipo de exame'),
          h('button', { class: 'btn peq', style: { marginLeft: 'auto' }, onclick: () => exportarCsv('relatorio_tipos', colsTipo, ex.por_tipo) }, '⬇ Exportar')),
        tabela([
          { titulo: 'Exame', valor: (t) => h('b', null, t.nome) }, { titulo: 'Quantidade', valor: (t) => t.total }, { titulo: 'Atrasados', valor: (t) => t.atrasados },
          { titulo: 'Tempo médio (dias úteis)', valor: (t) => t.media_dias_uteis ?? '—' }, { titulo: 'Tempo médio (dias corridos)', valor: (t) => t.media_dias_corridos ?? '—' },
        ], ex.por_tipo, { vazio: 'Sem exames no período.' }))),
      h('div', { class: 'secao' }, h('h2', null, '📅 Retornos'), h('div', { class: 'grade-ind' },
        kpi('Retornos previstos', rt.previstos, 'azul'), kpi('Agendados', rt.agendados, 'azul'), kpi('Realizados', rt.realizados, 'verde'),
        kpi('Não agendados', rt.nao_agendados, 'amarelo'), kpi('Vencidos', rt.vencidos, 'vermelho'), kpi('Faltas', rt.faltas, 'vermelho'),
        kpi('Recusados', rt.recusados, 'cinza'), kpi('Dispensados', rt.dispensados, 'cinza'), kpi('Suspensos (internação)', rt.suspensos, 'cinza'))),
      h('p', { class: 'fraco' }, `Por tipo: clínico ${rt.por_tipo.clinico || 0} · avaliação de exames ${rt.por_tipo.exames || 0} · pós-alta ${rt.por_tipo.pos_alta || 0}.`));
  }
  await carregar();
  return { atualizar: carregar };
}
const colsLab = [
  { titulo: 'Laboratório', valor: (l) => l.nome }, { titulo: 'Exames', valor: (l) => l.total }, { titulo: 'Atrasados', valor: (l) => l.atrasados },
  { titulo: '% atraso', valor: (l) => String(l.percentual_atraso).replace('.', ',') }, { titulo: 'Média dias úteis', valor: (l) => l.media_dias_uteis == null ? '' : String(l.media_dias_uteis).replace('.', ',') },
  { titulo: 'Média dias corridos', valor: (l) => l.media_dias_corridos == null ? '' : String(l.media_dias_corridos).replace('.', ',') }, { titulo: 'Cobranças', valor: (l) => l.cobrancas },
];
const colsTipo = [
  { titulo: 'Exame', valor: (t) => t.nome }, { titulo: 'Quantidade', valor: (t) => t.total }, { titulo: 'Atrasados', valor: (t) => t.atrasados },
  { titulo: 'Média dias úteis', valor: (t) => t.media_dias_uteis == null ? '' : String(t.media_dias_uteis).replace('.', ',') },
  { titulo: 'Média dias corridos', valor: (t) => t.media_dias_corridos == null ? '' : String(t.media_dias_corridos).replace('.', ',') },
];
