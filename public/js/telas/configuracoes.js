// Configurações Administrativas: laboratórios, exames, prazos, feriados e retornos.
// Gravação direta nas tabelas, permitida pelo banco SOMENTE para administradores (RLS + trigger).
import { sb, consulta, cache } from '../api.js';
import { h, limpar, toast, formulario, confirmar, tabela, fmtData, diaSemana, selo, carregando, hojeISO } from '../ui.js';

const ABAS = [['prazos', 'Prazos de exames'], ['labs', 'Laboratórios e profissionais'], ['tipos', 'Tipos de exame'], ['feriados', 'Feriados'], ['retornos', 'Retornos']];

export async function render(el, rota) {
  let aba = rota.params.get('aba') || 'prazos';
  const elAbas = h('div', { class: 'abas' });
  const elCorpo = h('div', { class: 'cartao' }, carregando());
  limpar(el, h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Configurações'),
    h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'Alterações valem para os próximos cadastros. As previsões dos exames já cadastrados não mudam. Tudo fica registrado no histórico.'))),
  elAbas, elCorpo);

  async function atualizar() {
    cache.limpar();
    limpar(elAbas, ABAS.map(([k, t]) => h('button', { class: `aba ${aba === k ? 'ativa' : ''}`, onclick: () => { aba = k; history.replaceState(null, '', `#/config?aba=${k}`); atualizar(); } }, t)));
    const fn = { prazos: telaPrazos, labs: telaLabs, tipos: telaTipos, feriados: telaFeriados, retornos: telaRetornos }[aba];
    await fn(elCorpo, atualizar);
  }
  await atualizar();
  return { atualizar };
}

const salvar = async (q, msg, aoMudar) => { await consulta(q); toast(msg); aoMudar(); };
const cab = (titulo, ...acoes) => h('div', { class: 'cab' }, h('h3', null, titulo), h('div', { style: { marginLeft: 'auto' }, class: 'acoes-linha' }, acoes));

// ---------- Prazos
async function telaPrazos(el, aoMudar) {
  const [prazos, labs, tipos] = await Promise.all([cache.prazos(), cache.laboratorios(), cache.tipos()]);
  const nomeLab = (id) => (labs.find((l) => l.id === id) || {}).nome;
  const nomeTipo = (id) => (tipos.find((t) => t.id === id) || {}).nome;
  const linhas = [...prazos].sort((a, b) => nomeTipo(a.tipo_exame_id).localeCompare(nomeTipo(b.tipo_exame_id)) || nomeLab(a.laboratorio_id).localeCompare(nomeLab(b.laboratorio_id)));
  const form = (p) => formulario({
    titulo: p ? 'Alterar prazo' : 'Novo prazo',
    aviso: { texto: 'Prazo em dias úteis (segunda a sexta, sem feriados). O primeiro dia útil após a realização conta como dia 1. Prazo 0 = resultado no mesmo dia.' },
    campos: [
      { nome: 'tipo', rotulo: 'Tipo de exame', tipo: 'select', obrigatorio: true, valor: p ? p.tipo_exame_id : '', opcoes: [['', 'Selecione…'], ...tipos.filter((t) => t.ativo || (p && t.id === p.tipo_exame_id)).map((t) => [t.id, t.nome])] },
      { nome: 'lab', rotulo: 'Laboratório / profissional', tipo: 'select', obrigatorio: true, valor: p ? p.laboratorio_id : '', opcoes: [['', 'Selecione…'], ...labs.filter((l) => l.ativo || (p && l.id === p.laboratorio_id)).map((l) => [l.id, l.nome])] },
      { nome: 'dias', rotulo: 'Prazo (dias úteis)', tipo: 'number', obrigatorio: true, valor: p ? p.dias_uteis : '', min: 0 },
    ],
    aoEnviar: async (v) => {
      const dados = { tipo_exame_id: Number(v.tipo), laboratorio_id: Number(v.lab), dias_uteis: Number(v.dias), atualizado_em: new Date().toISOString() };
      if (!Number.isInteger(dados.dias_uteis) || dados.dias_uteis < 0 || dados.dias_uteis > 120) throw new Error('Informe um prazo entre 0 e 120 dias úteis.');
      await salvar(p ? sb.from('prazos').update(dados).eq('id', p.id) : sb.from('prazos').insert(dados), 'Prazo salvo.', aoMudar);
    },
  });
  limpar(el, cab('Prazo padrão por exame e laboratório', h('button', { class: 'btn primario', onclick: () => form(null), disabled: !tipos.length || !labs.length }, '+ Novo prazo')),
    !tipos.length || !labs.length ? h('div', { class: 'aviso amarelo', style: { margin: '14px' } }, 'Cadastre primeiro os laboratórios/profissionais e os tipos de exame.') : null,
    tabela([
      { titulo: 'Exame', valor: (p) => h('b', null, nomeTipo(p.tipo_exame_id)) },
      { titulo: 'Laboratório / profissional', valor: (p) => nomeLab(p.laboratorio_id) },
      { titulo: 'Prazo', valor: (p) => `${p.dias_uteis} dia(s) útil(eis)` },
      { titulo: 'Situação', valor: (p) => p.ativo ? selo('Ativo', 'verde') : selo('Inativo', 'cinza') },
      { titulo: 'Ações', valor: (p) => h('div', { class: 'acoes-linha' }, h('button', { class: 'btn peq', onclick: () => form(p) }, 'Alterar'),
        h('button', { class: 'btn peq', onclick: async () => { if (await confirmar({ titulo: p.ativo ? 'Desativar prazo' : 'Reativar prazo', mensagem: p.ativo ? 'Sem prazo ativo, não será possível cadastrar este exame neste laboratório. Exames já cadastrados não mudam.' : 'Reativar este prazo?', botao: p.ativo ? 'Desativar' : 'Reativar', perigo: p.ativo })) await salvar(sb.from('prazos').update({ ativo: !p.ativo }).eq('id', p.id), 'Prazo atualizado.', aoMudar); } }, p.ativo ? 'Desativar' : 'Reativar')) },
    ], linhas, { vazio: 'Nenhum prazo configurado ainda.' }));
}

// ---------- Laboratórios / profissionais
async function telaLabs(el, aoMudar) {
  const labs = await cache.laboratorios();
  const form = (l) => formulario({
    titulo: l ? 'Alterar laboratório/profissional' : 'Novo laboratório ou profissional',
    campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: l ? l.nome : '', max: 120 },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: l ? l.tipo : 'laboratorio', opcoes: [['laboratorio', 'Laboratório'], ['profissional', 'Profissional responsável por laudos']] }],
    aoEnviar: async (v) => salvar(l ? sb.from('laboratorios').update(v).eq('id', l.id) : sb.from('laboratorios').insert(v), 'Salvo.', aoMudar),
  });
  limpar(el, cab('Laboratórios e profissionais', h('button', { class: 'btn primario', onclick: () => form(null) }, '+ Novo')),
    tabela([
      { titulo: 'Nome', valor: (l) => h('b', null, l.nome) },
      { titulo: 'Tipo', valor: (l) => l.tipo === 'profissional' ? 'Profissional' : 'Laboratório' },
      { titulo: 'Situação', valor: (l) => l.ativo ? selo('Ativo', 'verde') : selo('Inativo', 'cinza') },
      { titulo: 'Ações', valor: (l) => h('div', { class: 'acoes-linha' }, h('button', { class: 'btn peq', onclick: () => form(l) }, 'Alterar'),
        h('button', { class: 'btn peq', onclick: async () => { if (await confirmar({ titulo: l.ativo ? 'Desativar' : 'Reativar', mensagem: l.ativo ? `"${l.nome}" deixará de aparecer nos novos cadastros. O histórico é mantido.` : `Reativar "${l.nome}"?`, botao: l.ativo ? 'Desativar' : 'Reativar', perigo: l.ativo })) await salvar(sb.from('laboratorios').update({ ativo: !l.ativo }).eq('id', l.id), 'Atualizado.', aoMudar); } }, l.ativo ? 'Desativar' : 'Reativar')) },
    ], labs, { vazio: 'Nenhum laboratório cadastrado.' }));
}

// ---------- Tipos de exame
async function telaTipos(el, aoMudar) {
  const tipos = await cache.tipos();
  const form = (t) => formulario({
    titulo: t ? 'Alterar tipo de exame' : 'Novo tipo de exame',
    campos: [{ nome: 'nome', rotulo: 'Nome do exame', obrigatorio: true, valor: t ? t.nome : '', max: 120 }],
    aoEnviar: async (v) => salvar(t ? sb.from('tipos_exame').update(v).eq('id', t.id) : sb.from('tipos_exame').insert(v), 'Salvo.', aoMudar),
  });
  limpar(el, cab('Tipos de exame', h('button', { class: 'btn primario', onclick: () => form(null) }, '+ Novo tipo')),
    tabela([
      { titulo: 'Exame', valor: (t) => h('b', null, t.nome) },
      { titulo: 'Situação', valor: (t) => t.ativo ? selo('Ativo', 'verde') : selo('Inativo', 'cinza') },
      { titulo: 'Ações', valor: (t) => h('div', { class: 'acoes-linha' }, h('button', { class: 'btn peq', onclick: () => form(t) }, 'Alterar'),
        h('button', { class: 'btn peq', onclick: async () => { if (await confirmar({ titulo: t.ativo ? 'Desativar' : 'Reativar', mensagem: t.ativo ? `"${t.nome}" deixará de aparecer nos novos cadastros.` : `Reativar "${t.nome}"?`, botao: t.ativo ? 'Desativar' : 'Reativar', perigo: t.ativo })) await salvar(sb.from('tipos_exame').update({ ativo: !t.ativo }).eq('id', t.id), 'Atualizado.', aoMudar); } }, t.ativo ? 'Desativar' : 'Reativar')) },
    ], tipos, { vazio: 'Nenhum tipo de exame cadastrado.' }));
}

// ---------- Feriados
async function telaFeriados(el, aoMudar) {
  const feriados = await consulta(sb.from('feriados').select('*').order('data'));
  const ano = Number(hojeISO().slice(0, 4));
  const proximos = feriados.filter((f) => f.data >= `${ano - 1}-01-01`);
  limpar(el, cab('Feriados (não contam como dia útil)',
      h('button', { class: 'btn', onclick: () => sugerirNacionais(ano, aoMudar) }, `Adicionar feriados nacionais de ${ano}`),
      h('button', { class: 'btn', onclick: () => sugerirNacionais(ano + 1, aoMudar) }, `… de ${ano + 1}`),
      h('button', { class: 'btn primario', onclick: () => formulario({
        titulo: 'Novo feriado', aviso: { texto: 'Inclua também feriados municipais (São Bernardo do Campo) e datas em que os laboratórios não funcionam.' },
        campos: [{ nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true }, { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, max: 120 }],
        aoEnviar: async (v) => salvar(sb.from('feriados').insert(v), 'Feriado cadastrado.', aoMudar),
      }) }, '+ Novo feriado')),
    tabela([
      { titulo: 'Data', valor: (f) => h('b', { class: 'nowrap' }, `${fmtData(f.data)} (${diaSemana(f.data)})`) },
      { titulo: 'Descrição', valor: (f) => f.descricao },
      { titulo: 'Ações', valor: (f) => h('button', { class: 'btn peq', onclick: async () => {
        if (await confirmar({ titulo: 'Remover feriado', mensagem: `Remover ${fmtData(f.data)} — ${f.descricao}? Exames já cadastrados não mudam.`, botao: 'Remover', perigo: true })) await salvar(sb.from('feriados').delete().eq('data', f.data), 'Feriado removido.', aoMudar);
      } }, 'Remover') },
    ], proximos, { vazio: 'Nenhum feriado cadastrado.' }));
}

function pascoa(ano) { // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const mes = Math.floor((hh + l - 7 * m + 114) / 31), dia = ((hh + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
const desloca = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function sugerirNacionais(ano, aoMudar) {
  const p = pascoa(ano);
  const nacionais = [[`${ano}-01-01`, 'Confraternização Universal'], [desloca(p, -2), 'Sexta-feira Santa'], [`${ano}-04-21`, 'Tiradentes'], [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência do Brasil'], [`${ano}-10-12`, 'Nossa Senhora Aparecida'], [`${ano}-11-02`, 'Finados'], [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra'], [`${ano}-12-25`, 'Natal']];
  const facultativos = [[desloca(p, -48), 'Carnaval (segunda-feira)'], [desloca(p, -47), 'Carnaval (terça-feira)'], [desloca(p, 60), 'Corpus Christi']];
  const checks = facultativos.map(([d, t]) => { const c = h('input', { type: 'checkbox' }); return { c, d, t, el: h('label', { class: 'check' }, c, `${fmtData(d)} — ${t} (ponto facultativo)`) }; });
  const btn = h('button', { class: 'btn primario', onclick: async () => {
    const linhas = [...nacionais, ...checks.filter((x) => x.c.checked).map((x) => [x.d, x.t])].map(([data, descricao]) => ({ data, descricao }));
    btn.disabled = true;
    try { await consulta(sb.from('feriados').upsert(linhas, { onConflict: 'data', ignoreDuplicates: true })); m.fechar(); toast('Feriados adicionados.'); aoMudar(); }
    catch (e) { toast(e.message, 'erro'); btn.disabled = false; }
  } }, 'Adicionar');
  const { modal } = await import('../ui.js');
  const m = modal({ titulo: `Feriados nacionais de ${ano}`, corpo: [
    h('ul', { style: { margin: 0, paddingLeft: '18px' } }, nacionais.map(([d, t]) => h('li', null, `${fmtData(d)} — ${t}`))),
    h('div', { class: 'rotulo' }, 'Pontos facultativos (marque se os laboratórios não funcionam):'), checks.map((x) => x.el),
    h('div', { class: 'aviso amarelo' }, 'Confira as datas e acrescente manualmente os feriados municipais e estaduais.')],
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), btn] });
}

// ---------- Retornos
async function telaRetornos(el, aoMudar) {
  const cfg = await consulta(sb.from('configuracoes').select('*').eq('chave', 'retorno_clinico_dias').single());
  const dias = h('input', { type: 'number', min: 1, max: 365, value: cfg.valor, style: { maxWidth: '140px' } });
  limpar(el, cab('Configuração dos retornos'), h('div', { class: 'corpo' },
    h('div', { class: 'linha-form' }, h('div', { class: 'campo' }, h('label', null, 'Prazo padrão do retorno clínico (dias corridos após o atendimento)'), dias),
      h('button', { class: 'btn primario', onclick: async () => {
        const n = Number(dias.value);
        if (!Number.isInteger(n) || n < 1 || n > 365) return toast('Informe um número entre 1 e 365.', 'aviso');
        await salvar(sb.from('configuracoes').update({ valor: n, atualizado_em: new Date().toISOString() }).eq('chave', 'retorno_clinico_dias'), 'Prazo do retorno atualizado.', aoMudar);
      } }, 'Salvar')),
    h('p', { class: 'fraco' }, 'A recepção pode ajustar a data prevista de cada retorno individualmente. O retorno de avaliação de exames é liberado automaticamente quando todos os laudos do acompanhamento chegam.')));
}
