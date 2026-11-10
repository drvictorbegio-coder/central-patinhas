// Ficha do paciente: acompanhamentos (exames + retornos), internações e Histórico de Atividades.
import { rpc, sb, consulta } from '../api.js';
import { h, limpar, toast, formulario, fmtData, fmtDataHora, hojeISO, somarDias, seloExame, seloRetorno, seloInternado, telefone, carregando, RETORNO_TIPO, confirmar } from '../ui.js';
import { acoesExame, acoesRetorno, internar, darAlta, linhaDoTempo, celulaRetornoDatas } from '../acoes.js';
import { formAnimal, formTutor } from './pacientes.js';
import { abrirCadastroExames, diasRetorno } from '../formExames.js';

export async function render(el, rota) {
  const id = Number(rota.id);
  limpar(el, carregando());

  async function atualizar() {
    const [animal, ats, exames, retornos, ints, hist] = await Promise.all([
      consulta(sb.from('animais').select('*, tutores(*), atualizador:perfis!animais_atualizado_por_fkey(nome_completo)').eq('id', id).maybeSingle()),
      consulta(sb.from('atendimentos').select('*, perfis(nome_completo)').eq('animal_id', id).order('data_abertura', { ascending: false }).order('id', { ascending: false })),
      consulta(sb.from('v_exames').select('*').eq('animal_id', id).order('data_realizacao', { ascending: false }).order('id')),
      consulta(sb.from('v_retornos').select('*').eq('animal_id', id).order('data_prevista')),
      consulta(sb.from('v_internacoes').select('*').eq('animal_id', id).order('inicio', { ascending: false })),
      consulta(sb.from('historico').select('*').eq('animal_id', id).order('ocorrido_em', { ascending: false }).limit(500)),
    ]);
    if (!animal) return limpar(el, h('div', { class: 'vazio' }, 'Paciente não encontrado.'));
    const tutor = animal.tutores;
    const ultima = hist[0];
    const aberta = ints.find((i) => !i.alta);

    const cabecalho = h('div', { class: 'cartao secao' }, h('div', { class: 'corpo ficha-topo' },
      h('div', { class: 'info' },
        h('h1', null, `🐾 ${animal.nome}`, animal.internado ? seloInternado() : null),
        h('div', { class: 'dados' },
          h('span', null, 'ID do paciente: ', h('b', null, animal.id_externo)), h('span', null, 'Espécie: ', h('b', null, animal.especie)),
          h('span', null, 'Tutor: ', h('b', null, tutor.nome), ` (ID ${tutor.id_externo})`), h('span', null, 'Telefone: ', telefone(tutor.telefone))),
        tutor.observacoes ? h('div', { class: 'fraco', style: { marginTop: '6px' } }, 'Obs. do tutor: ', tutor.observacoes) : null,
        ultima ? h('div', { class: 'fraco', style: { marginTop: '8px' } }, `Última atualização: ${ultima.usuario_nome} em ${fmtDataHora(ultima.ocorrido_em)} — ${ultima.descricao}`) : null,
        aberta ? h('div', { class: 'aviso azul', style: { marginTop: '10px' } }, `Internado desde ${fmtDataHora(aberta.inicio)} (ativado por ${aberta.iniciada_por_nome}). Os alertas de retorno ambulatorial estão suspensos; os exames continuam sendo acompanhados.`) : null),
      h('div', { class: 'acoes-linha' },
        h('button', { class: 'btn primario', onclick: () => abrirCadastroExames({ animal: { ...animal, tutor_nome: tutor.nome, tutor_id_externo: tutor.id_externo }, aoSalvar: atualizar }) }, '+ Cadastrar exames'),
        h('button', { class: 'btn', onclick: () => novoAtendimento(animal, atualizar) }, '+ Novo atendimento'),
        animal.internado
          ? h('button', { class: 'btn roxo', onclick: () => darAlta(animal, atualizar) }, '🏥 Registrar alta')
          : h('button', { class: 'btn roxo', onclick: () => internar(animal, atualizar) }, '🏥 Paciente internado'),
        h('button', { class: 'btn', onclick: () => formAnimal(animal, tutor, atualizar) }, 'Editar paciente'),
        h('button', { class: 'btn', onclick: () => formTutor(tutor, atualizar) }, 'Editar tutor'))));

    // Agrupa exames e retornos por acompanhamento
    const blocos = ats.map((at) => {
      const ex = exames.filter((e) => e.atendimento_id === at.id);
      const rt = retornos.filter((r) => r.atendimento_id === at.id);
      const ativos = ex.filter((e) => e.situacao === 'ativo');
      const rec = ativos.filter((e) => e.recebido_em).length;
      const temClinico = rt.some((r) => r.tipo === 'clinico');
      return h('div', { class: 'acomp' },
        h('div', { class: 'cab' },
          h('b', null, `Acompanhamento de ${fmtData(at.data_abertura)}`), at.descricao ? h('span', { class: 'suave' }, `— ${at.descricao}`) : null,
          ativos.length ? h('span', { class: 'fraco' }, h('span', { class: 'progresso' }, h('i', { style: { width: `${(100 * rec) / ativos.length}%` } })), ` ${rec} de ${ativos.length} laudos recebidos`) : null,
          h('span', { class: 'fraco', style: { marginLeft: 'auto' } }, `Aberto por ${at.perfis ? at.perfis.nome_completo : '—'}`),
          !temClinico ? h('button', { class: 'btn peq', onclick: () => criarRetorno(at, atualizar) }, '+ Retorno clínico') : null),
        ex.length ? h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela responsiva' },
          h('thead', null, h('tr', null, ['Exame', 'Laboratório', 'Previsão', 'Status', 'Ações'].map((t) => h('th', null, t)))),
          h('tbody', null, ex.map((e) => h('tr', null,
            h('td', { 'data-rot': 'Exame' }, h('b', null, e.tipo_nome), e.observacoes ? h('div', { class: 'sub' }, e.observacoes) : null),
            h('td', { 'data-rot': 'Laboratório' }, e.laboratorio_nome, h('div', { class: 'sub' }, `${e.prazo_dias} dia(s) útil(eis)`)),
            h('td', { 'data-rot': 'Previsão' }, fmtData(e.data_prevista), e.qtd_cobrancas ? h('div', { class: 'sub' }, `${e.qtd_cobrancas} cobrança(s)`) : null),
            h('td', { 'data-rot': 'Status' }, seloExame(e), e.recebido_em ? h('div', { class: 'sub' }, `Recebido: ${e.recebido_por_nome}, ${fmtDataHora(e.recebido_em)}`) : null,
              e.comunicado_em ? h('div', { class: 'sub' }, `Comunicado: ${e.comunicado_por_nome}, ${fmtDataHora(e.comunicado_em)}`) : null),
            h('td', { 'data-rot': 'Ações' }, acoesExame(e, atualizar))))))) : null,
        rt.length ? h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela responsiva' },
          h('thead', null, h('tr', null, ['Retorno', 'Datas', 'Status', 'Ações'].map((t) => h('th', null, t)))),
          h('tbody', null, rt.map((r) => h('tr', null,
            h('td', { 'data-rot': 'Retorno' }, h('b', null, RETORNO_TIPO[r.tipo]), r.exames_pendentes ? h('div', null, h('span', { class: 'selo amarelo' }, `⚠ Exames pendentes: ${r.exames_pendentes_nomes}`)) : null),
            h('td', { 'data-rot': 'Datas' }, celulaRetornoDatas(r)),
            h('td', { 'data-rot': 'Status' }, seloRetorno(r), r.motivo ? h('div', { class: 'sub' }, r.motivo) : null),
            h('td', { 'data-rot': 'Ações' }, acoesRetorno(r, atualizar))))))) : null,
        !ex.length && !rt.length ? h('div', { class: 'fraco', style: { padding: '12px 14px' } }, 'Sem exames ou retornos neste acompanhamento.') : null);
    });

    limpar(el,
      h('div', { class: 'cabecalho' }, h('a', { href: '#/pacientes', class: 'btn fantasma' }, '← Voltar à pesquisa')),
      cabecalho,
      h('div', { class: 'secao' }, h('h2', null, 'Acompanhamentos, exames e retornos'),
        blocos.length ? blocos : h('div', { class: 'cartao' }, h('div', { class: 'vazio' }, 'Nenhum acompanhamento registrado. Use "Cadastrar exames" ou "Novo atendimento".'))),
      ints.length ? h('div', { class: 'secao' }, h('h2', null, 'Internações'), h('div', { class: 'cartao' }, h('div', { class: 'corpo' },
        h('ul', { class: 'linha-tempo' }, ints.map((i) => h('li', null, h('time', null, fmtData(i.inicio.slice(0, 10))),
          h('div', null, `Início ${fmtDataHora(i.inicio)} por `, h('b', null, i.iniciada_por_nome),
            i.alta ? [`. Alta ${fmtDataHora(i.alta)} por `, h('b', null, i.alta_por_nome), ` — ${i.precisa_retorno ? 'com' : 'sem'} retorno após a alta.`] : ' — ', !i.alta ? h('span', { class: 'selo internado' }, 'Em andamento') : null,
            i.observacoes ? h('div', { class: 'sub' }, i.observacoes) : null))))))) : null,
      h('div', { class: 'secao' }, h('h2', null, 'Histórico de Atividades'), h('div', { class: 'cartao' }, h('div', { class: 'corpo' },
        h('p', { class: 'fraco', style: { marginTop: 0 } }, 'Registro automático de todas as ações relacionadas a este paciente (mais recentes primeiro). Não pode ser editado nem apagado.'),
        linhaDoTempo(hist)))));
  }

  await atualizar();
  return { atualizar };
}

async function novoAtendimento(animal, aoMudar) {
  const dias = await diasRetorno();
  const m = formulario({
    titulo: `Novo atendimento — ${animal.nome}`,
    aviso: { texto: `Será gerado automaticamente um retorno clínico (padrão: ${dias} dias). Você pode alterar a data abaixo ou desmarcar se não houver retorno.` },
    campos: [
      { nome: 'data', rotulo: 'Data do atendimento', tipo: 'date', obrigatorio: true, valor: hojeISO(), maxData: hojeISO() },
      { nome: 'descricao', rotulo: 'Descrição (opcional)', placeholder: 'Ex.: consulta dermatológica', max: 200 },
      { nome: 'retorno', rotulo: 'Gerar retorno clínico?', tipo: 'select', opcoes: [['sim', 'Sim'], ['nao', 'Não']], valor: 'sim' },
      { nome: 'data_retorno', rotulo: 'Data prevista do retorno', tipo: 'date', valor: somarDias(hojeISO(), dias) },
    ],
    botao: 'Abrir atendimento',
    aoEnviar: async (v) => {
      const p = { animal_id: animal.id, data: v.data, descricao: v.descricao || null, gerar_retorno: v.retorno === 'sim', data_retorno: v.retorno === 'sim' ? v.data_retorno || null : null };
      try { await rpc('criar_atendimento', { p }); }
      catch (e) {
        if (e.codigo !== 'PAD01') throw e;
        if (!(await confirmar({ titulo: 'Já existe acompanhamento nesta data', mensagem: e.message, botao: 'Abrir outro' }))) return false;
        await rpc('criar_atendimento', { p: { ...p, confirmar: true } });
      }
      toast('Atendimento aberto.'); aoMudar();
    },
  });
  const dataAt = m.caixa.querySelector('input[name=data]');
  const dataRet = m.caixa.querySelector('input[name=data_retorno]');
  dataAt.addEventListener('change', () => { dataRet.value = somarDias(dataAt.value, dias); });
}

function criarRetorno(at, aoMudar) {
  formulario({
    titulo: `Retorno clínico — acompanhamento de ${fmtData(at.data_abertura)}`,
    campos: [{ nome: 'data', rotulo: 'Data prevista', tipo: 'date', obrigatorio: true, valor: hojeISO() }, { nome: 'obs', rotulo: 'Observações', tipo: 'textarea', largo: true }],
    aoEnviar: async (v) => { await rpc('retorno_criar', { p: { atendimento_id: at.id, data_prevista: v.data, observacoes: v.obs || null } }); toast('Retorno criado.'); aoMudar(); },
  });
}
