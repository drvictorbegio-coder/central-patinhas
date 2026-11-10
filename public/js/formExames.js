// Formulário de cadastro de exames (vários exames de uma vez), com agrupamento por acompanhamento.
import { rpc, sb, consulta, cache } from './api.js';
import { h, limpar, modal, toast, confirmar, fmtData, hojeISO, somarDias, seloInternado, ICONES } from './ui.js';

// Seletor de paciente com pesquisa (ID, tutor, animal ou telefone)
export function seletorPaciente(aoSelecionar, inicial) {
  const entrada = h('input', { type: 'search', placeholder: 'Pesquise por ID, nome do tutor, nome do animal ou telefone…', autocomplete: 'off' });
  const lista = h('div', { class: 'sugestoes oculto' });
  const escolhido = h('div', { class: 'oculto' });
  let t = null;
  const mostrarEscolhido = (a) => {
    limpar(escolhido, h('div', { class: 'resultado-tutor', style: { marginBottom: 0 } },
      h('div', { class: 'acoes-linha' }, h('b', null, `🐾 ${a.nome}`), a.internado ? seloInternado() : null, h('span', { class: 'fraco' }, `ID ${a.id_externo} · ${a.especie}`),
        h('button', { type: 'button', class: 'btn peq', style: { marginLeft: 'auto' }, onclick: () => { escolhido.classList.add('oculto'); entrada.parentElement.classList.remove('oculto'); entrada.value = ''; entrada.focus(); aoSelecionar(null); } }, 'Trocar')),
      h('div', { class: 'fraco' }, `Tutor: ${a.tutor_nome} (ID ${a.tutor_id_externo})`)));
    escolhido.classList.remove('oculto'); entrada.parentElement.classList.add('oculto'); lista.classList.add('oculto');
    aoSelecionar(a);
  };
  entrada.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = entrada.value.trim();
      if (q.length < 2) return lista.classList.add('oculto');
      const tutores = await rpc('buscar_cadastros', { q }).catch(() => []);
      const animais = tutores.flatMap((tu) => tu.animais.map((a) => ({ ...a, tutor_nome: tu.nome, tutor_id_externo: tu.id_externo })));
      limpar(lista, animais.length ? animais.map((a) => h('button', { type: 'button', onclick: () => mostrarEscolhido(a) },
        h('b', null, a.nome), ` · ${a.especie} · ID ${a.id_externo}`, a.internado ? ' · internado' : '', h('div', { class: 'fraco' }, `Tutor: ${a.tutor_nome} (ID ${a.tutor_id_externo})`)))
        : h('div', { class: 'fraco', style: { padding: '10px 12px' } }, 'Nenhum paciente encontrado. Cadastre-o em "Tutores e Pacientes".'));
      lista.classList.remove('oculto');
    }, 250);
  });
  const caixa = h('div', null, h('div', { class: 'busca-grande' }, h('span', { html: ICONES.busca }), entrada), lista, escolhido);
  if (inicial) setTimeout(() => mostrarEscolhido(inicial), 0);
  return caixa;
}

export async function abrirCadastroExames({ animal = null, aoSalvar } = {}) {
  const [tipos, labs, prazos] = await Promise.all([cache.tipos(), cache.laboratorios(), cache.prazos()]);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const labsAtivos = labs.filter((l) => l.ativo);
  const prazoDe = (tipo, lab) => prazos.find((p) => p.tipo_exame_id === Number(tipo) && p.laboratorio_id === Number(lab) && p.ativo);

  let paciente = animal;
  const data = h('input', { type: 'date', value: hojeISO(), max: hojeISO() });
  const blocoAt = h('div', { class: 'campo' });
  const linhas = h('div');
  const obsGeral = h('input', { type: 'text', placeholder: 'Ex.: check-up, pré-cirúrgico… (opcional)', maxlength: 200 });

  async function atualizarAtendimentos() {
    limpar(blocoAt);
    if (!paciente) return;
    const ats = await consulta(sb.from('atendimentos').select('id, data_abertura, descricao').eq('animal_id', paciente.id).order('data_abertura', { ascending: false }).limit(20));
    const mesmoDia = ats.find((a) => a.data_abertura === data.value);
    const sel = h('select', { name: 'at' },
      h('option', { value: 'auto' }, mesmoDia ? `Agrupar com o acompanhamento de ${fmtData(data.value)} (automático)` : `Novo acompanhamento em ${fmtData(data.value)} (automático)`),
      ats.filter((a) => a !== mesmoDia).map((a) => h('option', { value: a.id }, `Vincular ao acompanhamento de ${fmtData(a.data_abertura)}${a.descricao ? ' — ' + a.descricao : ''}`)),
      mesmoDia ? h('option', { value: 'novo' }, 'Abrir outro acompanhamento (atendimento diferente no mesmo dia)') : null);
    const dataRet = h('input', { type: 'date', value: somarDias(data.value, await diasRetorno()) });
    const chk = h('input', { type: 'checkbox', checked: true });
    const blocoRet = h('div', { class: 'linha-form' }, h('label', { class: 'check' }, chk, 'Gerar retorno clínico para o novo acompanhamento'), h('div', { class: 'campo', style: { maxWidth: '180px' } }, h('label', null, 'Data prevista do retorno'), dataRet));
    const atualizarRet = () => blocoRet.classList.toggle('oculto', !(sel.value === 'novo' || (sel.value === 'auto' && !mesmoDia)));
    sel.addEventListener('change', atualizarRet); atualizarRet();
    chk.addEventListener('change', () => { dataRet.disabled = !chk.checked; });
    blocoAt._valor = () => ({ atendimento: sel.value, gerar_retorno: chk.checked, data_retorno: chk.checked ? dataRet.value : null });
    limpar(blocoAt, h('label', null, 'Acompanhamento'), sel, blocoRet,
      h('span', { class: 'ajuda' }, 'Exames do mesmo animal na mesma data são agrupados automaticamente. O retorno de avaliação só é liberado quando todos os laudos do grupo chegarem.'));
  }

  function novaLinha() {
    const tipo = h('select', null, h('option', { value: '' }, 'Selecione o exame…'), tiposAtivos.map((t) => h('option', { value: t.id }, t.nome)));
    const lab = h('select', null, h('option', { value: '' }, 'Selecione…'));
    const prev = h('div', { class: 'prev' }, '—');
    const obs = h('input', { type: 'text', placeholder: 'Observações (opcional)', maxlength: 300 });
    const atualizarLabs = () => {
      const comPrazo = labsAtivos.filter((l) => prazoDe(tipo.value, l.id));
      const atual = lab.value;
      limpar(lab, h('option', { value: '' }, comPrazo.length || !tipo.value ? 'Selecione…' : 'Nenhum laboratório com prazo configurado'),
        comPrazo.map((l) => h('option', { value: l.id, selected: String(l.id) === atual || comPrazo.length === 1 }, `${l.nome} — ${prazoDe(tipo.value, l.id).dias_uteis} dia(s) útil(eis)`)));
      atualizarPrev();
    };
    const atualizarPrev = async () => {
      const p = prazoDe(tipo.value, lab.value);
      if (!p || !data.value) { prev.textContent = '—'; return; }
      const { data: d } = await sb.rpc('soma_dias_uteis', { inicio: data.value, n: p.dias_uteis });
      prev.textContent = d ? `Previsão: ${fmtData(d)}` : '—';
    };
    tipo.addEventListener('change', atualizarLabs); lab.addEventListener('change', atualizarPrev);
    const linha = h('div', { class: 'linha-exame' },
      h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Exame'), tipo),
      h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Laboratório / profissional'), lab),
      prev,
      h('button', { type: 'button', class: 'btn peq fantasma', title: 'Remover linha', onclick: () => { if (linhas.children.length > 1) linha.remove(); } }, '✕'),
      h('div', { class: 'campo', style: { gridColumn: '1 / -1' } }, obs));
    linha._valor = () => ({ tipo_exame_id: Number(tipo.value), laboratorio_id: Number(lab.value), observacoes: obs.value || null });
    linha._ok = () => tipo.value && lab.value;
    linha._prev = atualizarPrev;
    linhas.append(linha);
    tipo.focus();
  }
  data.addEventListener('change', () => { atualizarAtendimentos(); [...linhas.children].forEach((l) => l._prev()); });

  const seletor = seletorPaciente((a) => { paciente = a; atualizarAtendimentos(); }, animal ? { ...animal } : null);
  novaLinha();

  const btn = h('button', { class: 'btn primario' }, 'Cadastrar exames');
  const m = modal({
    titulo: 'Cadastrar exames', largo: true,
    corpo: [
      h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Paciente'), seletor),
      h('div', { class: 'grade-form' }, h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Data de realização'), data), h('div', { class: 'campo', style: { gridColumn: 'span 2' } }, h('label', null, 'Descrição do atendimento'), obsGeral)),
      blocoAt,
      h('div', null, h('div', { class: 'rotulo', style: { marginBottom: '6px' } }, 'Exames'), linhas,
        h('button', { type: 'button', class: 'btn peq', onclick: novaLinha }, '+ Adicionar outro exame')),
      h('div', { class: 'aviso azul' }, 'A data prevista de cada resultado é calculada automaticamente pelos dias úteis configurados (fins de semana e feriados não contam).'),
    ],
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), btn],
  });

  btn.addEventListener('click', async () => {
    if (!paciente) return toast('Selecione o paciente.', 'aviso');
    const itens = [...linhas.children];
    if (!itens.every((l) => l._ok())) return toast('Selecione o exame e o laboratório em todas as linhas.', 'aviso');
    const corpo = { animal_id: paciente.id, data_realizacao: data.value, descricao: obsGeral.value || null, itens: itens.map((l) => l._valor()), ...(blocoAt._valor ? blocoAt._valor() : {}) };
    btn.disabled = true;
    try {
      let r;
      try { r = await rpc('cadastrar_exames', { p: corpo }); }
      catch (e) {
        if (e.codigo !== 'PAD01') throw e;
        if (!(await confirmar({ titulo: 'Possível duplicidade', mensagem: e.message, botao: 'Cadastrar mesmo assim' }))) return;
        r = await rpc('cadastrar_exames', { p: { ...corpo, confirmar_duplicado: true } });
      }
      m.fechar();
      toast(`${r.exames.length} exame(s) cadastrado(s) para ${paciente.nome}${r.atendimento_novo ? ' em novo acompanhamento' : ' no acompanhamento existente'}.`);
      aoSalvar && aoSalvar(r);
    } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; }
  });
}

async function diasRetorno() {
  const c = await cache.obter('cfg_retorno', () => consulta(sb.from('configuracoes').select('valor').eq('chave', 'retorno_clinico_dias').single()));
  return Number(c.valor) || 15;
}
export { diasRetorno };
