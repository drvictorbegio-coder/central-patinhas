// Ações rápidas compartilhadas entre as telas (exames, retornos, internação).
import { rpc, sb, consulta, cache, ehAdmin } from './api.js';
import { h, toast, modal, confirmar, formulario, menuAcoes, botaoAcao, fmtData, fmtDataHora, hojeISO, seloExame, seloRetorno, RETORNO_TIPO, seloInternado, telefone } from './ui.js';

// Navegação para a ficha do paciente
export const linkPaciente = (animalId, nome) => h('a', { href: `#/paciente/${animalId}` }, nome);

export function celulaPaciente(l) {
  return h('div', { class: 'pac' }, linkPaciente(l.animal_id, l.animal_nome), ' ', l.internado ? seloInternado() : null,
    h('div', { class: 'sub' }, `ID ${l.animal_id_externo} · ${l.especie || ''}`));
}
export function celulaTutor(l) {
  return h('div', null, l.tutor_nome, h('div', { class: 'sub' }, `ID ${l.tutor_id_externo} · `, telefone(l.tutor_telefone)));
}

// ======================================================= EXAMES
export function acoesExame(e, aoMudar) {
  const feito = (msg) => { toast(msg); aoMudar && aoMudar(); };
  const botoes = [];
  if (e.situacao === 'ativo' && !e.recebido_em) {
    botoes.push(botaoAcao('Laudo recebido', 'verde', async () => { await rpc('exame_receber', { p_id: e.id }); feito(`Laudo de ${e.tipo_nome} (${e.animal_nome}) registrado como recebido.`); }));
    if (e.classificacao === 'atrasado') {
      botoes.push(e.precisa_cobranca
        ? botaoAcao('Cobrança realizada', 'amarelo', async () => { await rpc('exame_cobrar', { p_id: e.id }); feito(`Cobrança de ${e.laboratorio_nome} registrada.`); })
        : h('span', { class: 'fraco', title: e.ultima_cobranca_em ? `Por ${e.ultima_cobranca_por_nome} em ${fmtDataHora(e.ultima_cobranca_em)}` : '' }, `Cobrado ${e.ultima_cobranca === hojeISO() ? 'hoje' : 'em ' + fmtData(e.ultima_cobranca)}`));
    }
  }
  if (e.situacao === 'ativo' && e.recebido_em && !e.comunicado_em) {
    botoes.push(botaoAcao('Enviado ao tutor', 'azul', async () => { await rpc('exame_comunicar', { p_id: e.id, p_tipo: 'tutor' }); feito('Resultado marcado como enviado ao tutor.'); }));
    botoes.push(botaoAcao('Comunicado pela internação', 'roxo', async () => { await rpc('exame_comunicar', { p_id: e.id, p_tipo: 'internacao' }); feito('Resultado marcado como comunicado pela internação.'); }));
  }
  botoes.push(menuAcoes([
    { texto: 'Ver detalhes e cobranças', acao: () => detalhesExame(e.id) },
    { texto: 'Abrir ficha do paciente', acao: () => { location.hash = `#/paciente/${e.animal_id}`; } },
    e.situacao === 'ativo' && e.recebido_em && !e.comunicado_em ? { texto: 'Desfazer recebimento do laudo', acao: async () => {
      if (await confirmar({ titulo: 'Desfazer recebimento', mensagem: `O exame ${e.tipo_nome} de ${e.animal_nome} voltará para "aguardando laudo". A ação ficará registrada no histórico.`, botao: 'Desfazer', perigo: true })) {
        await executar(() => rpc('exame_desfazer_recebimento', { p_id: e.id }), 'Recebimento desfeito.', aoMudar);
      } } } : null,
    e.comunicado_em ? { texto: 'Desfazer registro de comunicação', acao: async () => {
      if (await confirmar({ titulo: 'Desfazer comunicação', mensagem: `O resultado de ${e.tipo_nome} (${e.animal_nome}) voltará para "aguardando comunicação".`, botao: 'Desfazer', perigo: true })) {
        await executar(() => rpc('exame_desfazer_comunicacao', { p_id: e.id }), 'Registro de comunicação desfeito.', aoMudar);
      } } } : null,
    e.situacao === 'ativo' ? { texto: 'Vincular a outro acompanhamento', acao: () => vincularExame(e, aoMudar) } : null,
    e.situacao === 'ativo' ? { texto: ehAdmin() ? 'Corrigir exame (administração)' : 'Editar observações', acao: () => corrigirExame(e, aoMudar) } : null,
    e.situacao === 'ativo' ? { texto: 'Cancelar exame', perigo: true, acao: () => cancelarExame(e, aoMudar) } : null,
  ]));
  return h('div', { class: 'acoes-linha' }, botoes);
}

async function executar(fn, msg, aoMudar) {
  try { await fn(); toast(msg); aoMudar && aoMudar(); } catch (e) { toast(e.message, 'erro'); }
}

function cancelarExame(e, aoMudar) {
  formulario({
    titulo: `Cancelar ${e.tipo_nome} — ${e.animal_nome}`,
    aviso: { cor: 'amarelo', texto: 'O exame deixa de contar nas pendências, mas continua no histórico. Use apenas para cadastros feitos por engano ou exames que não serão realizados.' },
    campos: [{ nome: 'motivo', rotulo: 'Motivo do cancelamento', tipo: 'textarea', obrigatorio: true, largo: true }],
    botao: 'Cancelar exame',
    aoEnviar: async (v) => { await rpc('exame_cancelar', { p_id: e.id, p_motivo: v.motivo }); toast('Exame cancelado.'); aoMudar && aoMudar(); },
  });
}

async function vincularExame(e, aoMudar) {
  const ats = await consulta(sb.from('atendimentos').select('id, data_abertura, descricao').eq('animal_id', e.animal_id).neq('id', e.atendimento_id).order('data_abertura', { ascending: false }));
  if (!ats.length) return toast('Este paciente não tem outro acompanhamento para vincular.', 'aviso');
  formulario({
    titulo: `Vincular ${e.tipo_nome} a outro acompanhamento`,
    aviso: { texto: 'Use quando exames de datas diferentes fazem parte do mesmo acompanhamento. O retorno de avaliação só é liberado quando todos os laudos do grupo chegarem.' },
    campos: [{ nome: 'at', rotulo: 'Acompanhamento', tipo: 'select', obrigatorio: true, largo: true, opcoes: ats.map((a) => [a.id, `${fmtData(a.data_abertura)}${a.descricao ? ' — ' + a.descricao : ''}`]) }],
    botao: 'Vincular',
    aoEnviar: async (v) => { await rpc('exame_vincular', { p_id: e.id, p_atendimento: Number(v.at) }); toast('Exame vinculado.'); aoMudar && aoMudar(); },
  });
}

async function corrigirExame(e, aoMudar) {
  const campos = [];
  if (ehAdmin()) {
    const [tipos, labs] = await Promise.all([cache.tipos(), cache.laboratorios()]);
    campos.push(
      { nome: 'tipo_exame_id', rotulo: 'Tipo de exame', tipo: 'select', valor: e.tipo_exame_id, opcoes: tipos.map((t) => [t.id, t.nome]) },
      { nome: 'laboratorio_id', rotulo: 'Laboratório / profissional', tipo: 'select', valor: e.laboratorio_id, opcoes: labs.map((l) => [l.id, l.nome]) },
      { nome: 'data_realizacao', rotulo: 'Data de realização', tipo: 'date', valor: e.data_realizacao },
      { nome: 'data_prevista', rotulo: 'Data prevista (manual)', tipo: 'date', valor: e.data_prevista, ajuda: 'Ao mudar tipo, laboratório ou data sem mexer aqui, a previsão é recalculada.' });
  }
  campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: e.observacoes || '', largo: true });
  formulario({
    titulo: `${ehAdmin() ? 'Corrigir' : 'Editar'} ${e.tipo_nome} — ${e.animal_nome}`,
    aviso: ehAdmin() ? { cor: 'amarelo', texto: 'Correção administrativa: o valor anterior e o novo ficam registrados no histórico.' } : null,
    campos, botao: 'Salvar',
    aoEnviar: async (v) => {
      const p = { versao: e.versao, observacoes: v.observacoes };
      if (ehAdmin()) {
        if (Number(v.tipo_exame_id) !== e.tipo_exame_id) p.tipo_exame_id = Number(v.tipo_exame_id);
        if (Number(v.laboratorio_id) !== e.laboratorio_id) p.laboratorio_id = Number(v.laboratorio_id);
        if (v.data_realizacao !== e.data_realizacao) p.data_realizacao = v.data_realizacao;
        if (v.data_prevista !== e.data_prevista) p.data_prevista = v.data_prevista;
      }
      await rpc('exame_corrigir', { p_id: e.id, p });
      toast('Exame atualizado.'); aoMudar && aoMudar();
    },
  });
}

export async function detalhesExame(id) {
  const [e, cobs, hist] = await Promise.all([
    consulta(sb.from('v_exames').select('*').eq('id', id).single()),
    consulta(sb.from('cobrancas').select('cobrado_em, perfis(nome_completo)').eq('exame_id', id).order('cobrado_em')),
    consulta(sb.from('historico').select('*').eq('entidade', 'exame').eq('entidade_id', id).order('ocorrido_em')),
  ]);
  const linha = (r, v) => h('div', { class: 'dados' }, h('span', null, r + ': '), h('b', null, v));
  modal({
    titulo: `${e.tipo_nome} — ${e.animal_nome}`, largo: true,
    corpo: [
      h('div', { class: 'acoes-linha' }, seloExame(e), e.internado ? seloInternado() : null),
      h('div', { class: 'grade-form' },
        linha('Laboratório / profissional', e.laboratorio_nome),
        linha('Realizado em', fmtData(e.data_realizacao)),
        linha('Prazo', `${e.prazo_dias} dia(s) útil(eis)`),
        linha('Previsão do resultado', fmtData(e.data_prevista)),
        linha('Acompanhamento', `${fmtData(e.atendimento_data)} · ${e.grupo_recebidos} de ${e.grupo_total} laudos recebidos`),
        linha('Cadastrado por', `${e.criado_por_nome || '—'} em ${fmtDataHora(e.criado_em)}`),
        linha('Laudo recebido', e.recebido_em ? `${e.recebido_por_nome} em ${fmtDataHora(e.recebido_em)}` : 'Aguardando'),
        linha('Comunicação', e.comunicado_em ? `${e.comunicacao_tipo === 'internacao' ? 'Pela internação' : 'Enviado ao tutor'} — ${e.comunicado_por_nome} em ${fmtDataHora(e.comunicado_em)}` : (e.recebido_em ? 'Aguardando' : '—'))),
      e.observacoes ? h('div', { class: 'aviso azul' }, 'Observações: ', e.observacoes) : null,
      e.motivo_cancelamento ? h('div', { class: 'aviso vermelho' }, 'Cancelado: ', e.motivo_cancelamento) : null,
      h('h3', null, `Cobranças ao laboratório (${cobs.length})`),
      cobs.length ? h('ul', { class: 'linha-tempo' }, cobs.map((c) => h('li', null, h('time', null, fmtDataHora(c.cobrado_em)), h('span', null, 'Cobrança realizada por ', h('b', null, c.perfis ? c.perfis.nome_completo : '—'))))) : h('p', { class: 'fraco' }, 'Nenhuma cobrança registrada.'),
      h('h3', null, 'Histórico deste exame'),
      linhaDoTempo(hist),
    ],
  });
}

// ======================================================= RETORNOS
export function acoesRetorno(r, aoMudar) {
  const feito = (msg) => { toast(msg); aoMudar && aoMudar(); };
  const p = (extra = {}) => ({ versao: r.versao, ...extra });
  const botoes = [];
  const aberto = ['aguardando_agendamento', 'tutor_contatado', 'agendado'].includes(r.status);
  if (r.status === 'suspenso_internacao') {
    botoes.push(h('span', { class: 'fraco' }, 'Volta após a alta'));
  }
  if (['aguardando_agendamento', 'nao_compareceu'].includes(r.status)) {
    botoes.push(botaoAcao('Tutor contatado', '', async () => { await rpc('retorno_acao', { p_id: r.id, p_acao: 'contatado', p: p() }); feito('Contato registrado.'); }));
  }
  if (['aguardando_agendamento', 'tutor_contatado', 'nao_compareceu', 'agendado'].includes(r.status)) {
    botoes.push(botaoAcao(r.status === 'agendado' ? 'Reagendar' : 'Agendar', r.status === 'agendado' ? '' : 'azul', async () => agendar(r, aoMudar)));
  }
  if (r.status === 'agendado') {
    botoes.push(botaoAcao('Compareceu', 'verde', async () => {
      await rpc('retorno_acao', { p_id: r.id, p_acao: 'realizado', p: p() }); feito('Comparecimento registrado.');
    }));
    botoes.push(botaoAcao('Não compareceu', '', async () => {
      if (await confirmar({ titulo: 'Registrar falta', mensagem: `Confirmar que o tutor de ${r.animal_nome} não compareceu?`, botao: 'Registrar falta', perigo: true })) {
        await rpc('retorno_acao', { p_id: r.id, p_acao: 'nao_compareceu', p: p() }); feito('Falta registrada.');
      }
    }));
  }
  botoes.push(menuAcoes([
    { texto: 'Abrir ficha do paciente', acao: () => { location.hash = `#/paciente/${r.animal_id}`; } },
    aberto ? { texto: 'Alterar data prevista', acao: () => alterarPrevisao(r, aoMudar) } : null,
    ['aguardando_agendamento', 'tutor_contatado'].includes(r.status) ? { texto: 'Registrar comparecimento (sem agendamento)', acao: async () => {
      if (await confirmar({ titulo: 'Registrar comparecimento', mensagem: `Registrar que ${r.animal_nome} compareceu ao ${RETORNO_TIPO[r.tipo].toLowerCase()} hoje?`, botao: 'Registrar' })) {
        await executar(() => rpc('retorno_acao', { p_id: r.id, p_acao: 'realizado', p: p() }), 'Comparecimento registrado.', aoMudar);
      } } } : null,
    aberto || r.status === 'nao_compareceu' ? { texto: 'Tutor recusou', acao: () => motivo(r, 'recusou', 'Registrar recusa do tutor', aoMudar) } : null,
    aberto || ['nao_compareceu', 'suspenso_internacao'].includes(r.status) ? { texto: 'Dispensar retorno', perigo: true, acao: () => motivo(r, 'dispensar', 'Dispensar retorno', aoMudar) } : null,
    ['realizado', 'nao_compareceu', 'recusou', 'dispensado'].includes(r.status) ? { texto: 'Reabrir retorno', acao: () => reabrir(r, aoMudar) } : null,
  ]));
  return h('div', { class: 'acoes-linha' }, botoes);
}

function agendar(r, aoMudar) {
  formulario({
    titulo: `Agendar ${RETORNO_TIPO[r.tipo].toLowerCase()} — ${r.animal_nome}`,
    aviso: r.exames_pendentes ? { cor: 'amarelo', texto: `Atenção: exames pendentes neste acompanhamento (${r.exames_pendentes_nomes}).` } : null,
    campos: [
      { nome: 'data', rotulo: 'Data da consulta', tipo: 'date', obrigatorio: true, valor: r.data_consulta && r.data_consulta >= hojeISO() ? r.data_consulta : (r.data_prevista >= hojeISO() ? r.data_prevista : hojeISO()), min: hojeISO() },
      { nome: 'hora', rotulo: 'Horário', tipo: 'time', valor: r.hora_consulta ? r.hora_consulta.slice(0, 5) : '' },
      { nome: 'obs', rotulo: 'Observações', tipo: 'textarea', largo: true },
    ],
    botao: 'Confirmar agendamento',
    aoEnviar: async (v) => {
      await rpc('retorno_acao', { p_id: r.id, p_acao: 'agendar', p: { versao: r.versao, data_consulta: v.data, hora_consulta: v.hora || null, observacoes: v.obs || null } });
      toast(`Retorno agendado para ${fmtData(v.data)}${v.hora ? ' às ' + v.hora : ''}.`); aoMudar && aoMudar();
    },
  });
}
function alterarPrevisao(r, aoMudar) {
  formulario({
    titulo: `Alterar data prevista — ${r.animal_nome}`,
    campos: [{ nome: 'data', rotulo: 'Nova data prevista', tipo: 'date', obrigatorio: true, valor: r.data_prevista }],
    aviso: { texto: 'O alerta aparece somente a partir da data prevista.' },
    aoEnviar: async (v) => { await rpc('retorno_alterar_previsao', { p_id: r.id, p_data: v.data, p_versao: r.versao }); toast('Data prevista alterada.'); aoMudar && aoMudar(); },
  });
}
function motivo(r, acao, titulo, aoMudar) {
  formulario({
    titulo: `${titulo} — ${r.animal_nome}`,
    aviso: { cor: 'amarelo', texto: 'Esta ação encerra a pendência deste retorno. Ela fica registrada no histórico e pode ser reaberta depois.' },
    campos: [{ nome: 'motivo', rotulo: 'Motivo (opcional)', tipo: 'textarea', largo: true }],
    botao: 'Confirmar',
    aoEnviar: async (v) => { await rpc('retorno_acao', { p_id: r.id, p_acao: acao, p: { versao: r.versao, motivo: v.motivo || null } }); toast('Retorno atualizado.'); aoMudar && aoMudar(); },
  });
}
function reabrir(r, aoMudar) {
  formulario({
    titulo: `Reabrir retorno — ${r.animal_nome}`,
    campos: [{ nome: 'data', rotulo: 'Nova data prevista', tipo: 'date', obrigatorio: true, valor: r.data_prevista > hojeISO() ? r.data_prevista : hojeISO() }],
    botao: 'Reabrir',
    aoEnviar: async (v) => { await rpc('retorno_acao', { p_id: r.id, p_acao: 'reabrir', p: { versao: r.versao, data_prevista: v.data } }); toast('Retorno reaberto.'); aoMudar && aoMudar(); },
  });
}

export function celulaRetornoTipo(r) {
  return h('div', null, RETORNO_TIPO[r.tipo] || r.tipo,
    r.exames_pendentes ? h('div', null, h('span', { class: 'selo amarelo', title: r.exames_pendentes_nomes }, `⚠ Exames pendentes: ${r.exames_pendentes_nomes}`)) : null,
    h('div', { class: 'sub' }, `Acompanhamento de ${fmtData(r.atendimento_data)}`));
}
export function celulaRetornoDatas(r) {
  return h('div', null,
    h('div', null, 'Prevista: ', h('b', null, fmtData(r.data_prevista))),
    r.data_consulta ? h('div', { class: 'sub' }, `Consulta: ${fmtData(r.data_consulta)}${r.hora_consulta ? ' às ' + r.hora_consulta.slice(0, 5) : ''}`) : null,
    r.data_realizado ? h('div', { class: 'sub' }, `Realizado: ${fmtData(r.data_realizado)}`) : null);
}

// ======================================================= INTERNAÇÃO
export async function internar(animal, aoMudar) {
  formulario({
    titulo: `Internar ${animal.nome}`,
    aviso: { texto: 'Os exames continuam sendo acompanhados normalmente. Os alertas de agendamento de retorno ambulatorial ficam suspensos até a alta.' },
    campos: [{ nome: 'obs', rotulo: 'Observações (opcional)', tipo: 'textarea', largo: true }],
    botao: 'Ativar internação',
    aoEnviar: async (v) => { await rpc('internar', { p_animal: animal.id, p_observacoes: v.obs || null }); toast(`${animal.nome} marcado(a) como internado(a).`); aoMudar && aoMudar(); },
  });
}

export function darAlta(animal, aoMudar) {
  const dataEl = h('input', { type: 'date', value: '', min: hojeISO() });
  const obsEl = h('textarea', { placeholder: 'Observações (opcional)' });
  const blocoData = h('div', { class: 'campo oculto' }, h('label', { class: 'req' }, 'Nova data prevista do retorno'), dataEl);
  const radios = h('div', { class: 'opcoes-radio' },
    h('label', null, h('input', { type: 'radio', name: 'precisa', value: 'sim', onchange: () => blocoData.classList.remove('oculto') }), 'Sim'),
    h('label', null, h('input', { type: 'radio', name: 'precisa', value: 'nao', onchange: () => blocoData.classList.add('oculto') }), 'Não'));
  const btn = h('button', { class: 'btn primario', onclick: async () => {
    const sel = radios.querySelector('input:checked');
    if (!sel) return toast('Responda se o paciente precisará de retorno.', 'aviso');
    const sim = sel.value === 'sim';
    if (sim && !dataEl.value) return toast('Informe a data prevista do retorno.', 'aviso');
    btn.disabled = true;
    try {
      const r = await rpc('dar_alta', { p_animal: animal.id, p_precisa_retorno: sim, p_data_retorno: sim ? dataEl.value : null, p_observacoes: obsEl.value || null });
      m.fechar();
      toast(sim ? `Alta registrada. ${r.reativados ? r.reativados + ' retorno(s) reativado(s)' : 'Retorno pós-alta criado'} para ${fmtData(dataEl.value)}.`
               : `Alta registrada. ${r.dispensados} retorno(s) dispensado(s) após a alta.`);
      aoMudar && aoMudar();
    } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; }
  } }, 'Registrar alta');
  const m = modal({
    titulo: `Alta hospitalar — ${animal.nome}`,
    corpo: [h('h3', null, 'O paciente precisará de retorno após a alta?'), radios, blocoData, obsEl,
      h('div', { class: 'aviso azul' }, 'Sim: reativa os retornos suspensos com a nova data (ou cria um único retorno pós-alta). Não: encerra a pendência de retorno ambulatorial, registrando "dispensado após a alta".')],
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), btn],
  });
}

// ======================================================= HISTÓRICO
const NOMES_CAMPOS = { id_externo: 'ID', nome: 'Nome', telefone: 'Telefone', observacoes: 'Observações', especie: 'Espécie', tutor_id: 'Tutor',
  status: 'Status', data_prevista: 'Data prevista', data_consulta: 'Consulta', internado: 'Internado', situacao: 'Situação', perfil: 'Perfil',
  nome_completo: 'Nome', dias_uteis: 'Dias úteis', prazo_dias: 'Prazo', data_realizacao: 'Realização', tipo_exame_id: 'Tipo', laboratorio_id: 'Laboratório' };
function valorLegivel(v) {
  if (v === null || v === undefined || v === '') return 'vazio';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtData(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/_/g, ' ');
}
export function resumoAlteracao(hst) {
  if (!hst.antes || !hst.depois || typeof hst.antes !== 'object') return null;
  const chaves = Object.keys(hst.depois).filter((k) => NOMES_CAMPOS[k] && JSON.stringify(hst.antes[k]) !== JSON.stringify(hst.depois[k]));
  if (!chaves.length) return null;
  return h('div', { class: 'alteracao' }, chaves.map((k, i) => [i ? ' · ' : '', `${NOMES_CAMPOS[k]}: `, h('del', null, valorLegivel(hst.antes[k])), ' → ', h('ins', null, valorLegivel(hst.depois[k]))]));
}
export function linhaDoTempo(itens) {
  if (!itens.length) return h('p', { class: 'fraco' }, 'Nenhuma atividade registrada.');
  return h('ul', { class: 'linha-tempo' }, itens.map((x) => h('li', null,
    h('time', { title: x.ocorrido_em }, fmtDataHora(x.ocorrido_em).replace(',', ' às')),
    h('div', null, h('b', null, x.usuario_nome), ' — ', x.descricao, resumoAlteracao(x)))));
}
