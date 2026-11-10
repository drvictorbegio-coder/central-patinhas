// Controle de Internação: pacientes internados com seus exames e pendências.
import { sb, consulta } from '../api.js';
import { h, limpar, fmtData, fmtDataHora, tabela, carregando, selo, exportarCsv } from '../ui.js';
import { darAlta, celulaTutor, linkPaciente } from '../acoes.js';

export async function render(el) {
  let aba = 'atuais';
  const elAbas = h('div', { class: 'abas' });
  const elLista = h('div', { class: 'cartao' }, carregando());
  limpar(el, h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Pacientes internados'),
    h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'Para internar, abra a ficha do paciente e clique em "Paciente internado".'))), elAbas, elLista);

  async function atualizar() {
    let q = sb.from('v_internacoes').select('*');
    q = aba === 'atuais' ? q.is('alta', null).order('inicio') : q.not('alta', 'is', null).order('alta', { ascending: false }).limit(300);
    const linhas = await consulta(q);
    limpar(elAbas, [['atuais', 'Internados agora'], ['altas', 'Altas recentes']].map(([k, t]) =>
      h('button', { class: `aba ${aba === k ? 'ativa' : ''}`, onclick: () => { aba = k; atualizar(); } }, t, k === 'atuais' ? h('span', { class: 'n' }, aba === 'atuais' ? linhas.length : '…') : null)));
    limpar(elLista, tabela([
      { titulo: 'Paciente', valor: (i) => h('div', { class: 'pac' }, linkPaciente(i.animal_id, i.animal_nome), h('div', { class: 'sub' }, `ID ${i.animal_id_externo} · ${i.especie}`)) },
      { titulo: 'Tutor', valor: celulaTutor },
      { titulo: 'Internação', valor: (i) => h('div', null, `Desde ${fmtDataHora(i.inicio)}`, h('div', { class: 'sub' }, `Ativada por ${i.iniciada_por_nome}`),
        i.alta ? h('div', { class: 'sub' }, `Alta ${fmtDataHora(i.alta)} por ${i.alta_por_nome} — ${i.precisa_retorno ? 'com' : 'sem'} retorno`) : null) },
      { titulo: 'Exames', valor: (i) => h('div', { class: 'acoes-linha' },
        i.exames_atrasados ? selo(`${i.exames_atrasados} atrasado(s)`, 'vermelho') : null,
        i.exames_aguardando - i.exames_atrasados > 0 ? selo(`${i.exames_aguardando - i.exames_atrasados} aguardando laudo`, 'verde') : null,
        i.exames_a_comunicar ? selo(`${i.exames_a_comunicar} a comunicar`, 'azul') : null,
        !i.exames_aguardando && !i.exames_a_comunicar ? h('span', { class: 'fraco' }, 'Sem pendências') : null) },
      { titulo: 'Ações', valor: (i) => h('div', { class: 'acoes-linha' },
        h('a', { class: 'btn peq', href: `#/paciente/${i.animal_id}` }, 'Ver exames e ficha'),
        !i.alta ? h('button', { class: 'btn peq roxo', onclick: () => darAlta({ id: i.animal_id, nome: i.animal_nome }, atualizar) }, 'Registrar alta') : null) },
    ], linhas, { vazio: aba === 'atuais' ? 'Nenhum paciente internado no momento.' : 'Nenhuma alta registrada.' }),
    linhas.length ? h('div', { class: 'mais' }, h('button', { class: 'btn peq', onclick: () => exportarCsv(`internacoes_${aba}`, [
      { titulo: 'Paciente', valor: (i) => i.animal_nome }, { titulo: 'ID paciente', valor: (i) => i.animal_id_externo }, { titulo: 'Tutor', valor: (i) => i.tutor_nome },
      { titulo: 'Telefone', valor: (i) => i.tutor_telefone }, { titulo: 'Início', valor: (i) => fmtDataHora(i.inicio) }, { titulo: 'Ativada por', valor: (i) => i.iniciada_por_nome },
      { titulo: 'Alta', valor: (i) => i.alta ? fmtDataHora(i.alta) : '' }, { titulo: 'Alta por', valor: (i) => i.alta_por_nome || '' },
      { titulo: 'Exames atrasados', valor: (i) => i.exames_atrasados }, { titulo: 'Aguardando laudo', valor: (i) => i.exames_aguardando }, { titulo: 'A comunicar', valor: (i) => i.exames_a_comunicar },
    ], linhas) }, '⬇ Exportar Excel/CSV')) : null);
  }
  await atualizar();
  return { atualizar };
}
export { fmtData };
