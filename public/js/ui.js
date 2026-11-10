// Componentes de interface reutilizáveis (sem bibliotecas externas).
const FUSO = 'America/Sao_Paulo';

// h('div', {class:'x', onclick}, 'texto', filho) — textos sempre como texto (evita injeção de HTML)
export function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // somente para SVGs fixos do próprio código
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  adicionar(el, filhos);
  return el;
}
function adicionar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}
export const limpar = (el, ...filhos) => { el.replaceChildren(); adicionar(el, filhos); return el; };

// ---------- Datas (DD/MM/AAAA, fuso de São Paulo)
export function fmtData(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function fmtDataHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diasEntre(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}
export function diaSemana(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
}

// ---------- Telefone / WhatsApp
export function linkWhats(tel, texto) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const num = d.length <= 11 ? '55' + d : d;
  return `https://wa.me/${num}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
}
export function telefone(tel) {
  if (!tel) return '—';
  const link = linkWhats(tel);
  return link ? h('a', { href: link, target: '_blank', rel: 'noopener', class: 'nowrap', title: 'Abrir conversa no WhatsApp' }, tel) : tel;
}

// ---------- Selos
export const selo = (texto, cor = 'cinza', title) => h('span', { class: `selo ${cor}`, title }, texto);
export const seloInternado = () => h('span', { class: 'selo internado', title: 'Paciente internado' }, '🏥 Internado');

export const EXAME_STATUS = {
  atrasado: ['Atrasado', 'vermelho'],
  vence_hoje: ['Vence hoje', 'amarelo'],
  no_prazo: ['No prazo', 'verde'],
  recebido: ['Laudo recebido', 'azul'],
  cancelado: ['Cancelado', 'cinza'],
};
export function seloExame(e) {
  if (e.situacao === 'cancelado') return selo('Cancelado', 'cinza', e.motivo_cancelamento || '');
  if (e.comunicado_em) return selo(e.comunicacao_tipo === 'internacao' ? 'Comunicado pela internação' : 'Enviado ao tutor', 'verde');
  if (e.recebido_em) return selo('Laudo recebido · comunicar', 'azul');
  const [t, c] = EXAME_STATUS[e.classificacao] || [e.classificacao, 'cinza'];
  return selo(t, c);
}
export const RETORNO_STATUS = {
  aguardando_agendamento: ['Aguardando agendamento', 'amarelo'],
  tutor_contatado: ['Tutor contatado', 'azul'],
  agendado: ['Retorno agendado', 'azul'],
  realizado: ['Retorno realizado', 'verde'],
  nao_compareceu: ['Tutor não compareceu', 'vermelho'],
  recusou: ['Tutor recusou', 'cinza'],
  dispensado: ['Retorno dispensado', 'cinza'],
  suspenso_internacao: ['Suspenso por internação', 'cinza'],
};
export const RETORNO_TIPO = { clinico: 'Retorno clínico', exames: 'Avaliação de exames', pos_alta: 'Retorno pós-alta' };
export function seloRetorno(r) {
  let [t, c] = RETORNO_STATUS[r.status] || [r.status, 'cinza'];
  if (['aguardando_agendamento', 'tutor_contatado', 'agendado'].includes(r.status)) {
    if (r.classificacao === 'vencido') c = 'vermelho';
    else if (r.classificacao === 'hoje') c = 'amarelo';
    else if (r.status === 'aguardando_agendamento') c = 'azul';
  }
  return selo(t, c);
}
export function corLinhaRetorno(r) {
  if (r.classificacao === 'vencido') return 'linha-vermelha';
  if (r.classificacao === 'hoje') return 'linha-amarela';
  if (r.classificacao === 'proximo') return 'linha-azul';
  if (r.status === 'realizado') return 'linha-verde';
  return 'linha-cinza';
}
export function corLinhaExame(e) {
  if (e.situacao === 'cancelado') return 'linha-cinza';
  if (e.comunicado_em) return 'linha-verde';
  if (e.recebido_em) return 'linha-azul';
  return { atrasado: 'linha-vermelha', vence_hoje: 'linha-amarela', no_prazo: 'linha-verde' }[e.classificacao] || '';
}

// ---------- Toasts
export function toast(msg, tipo = 'ok') {
  const t = h('div', { class: `toast ${tipo === 'ok' ? '' : tipo}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 7000 : 3500);
}

// ---------- Modal
export function modal({ titulo, corpo, rodape, largo = false, aoFechar }) {
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); aoFechar && aoFechar(); };
  const esc = (e) => { if (e.key === 'Escape') fechar(); };
  const caixa = h('div', { class: `modal ${largo ? 'largo' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'cab' }, h('h2', null, titulo), h('button', { class: 'btn fantasma icone fechar', onclick: fechar, 'aria-label': 'Fechar' }, '✕')),
    h('div', { class: 'corpo' }, corpo),
    rodape ? h('div', { class: 'rodape' }, rodape) : null);
  const fundo = h('div', { class: 'fundo-modal', onmousedown: (e) => { if (e.target === fundo) fechar(); } }, caixa);
  document.body.append(fundo);
  document.addEventListener('keydown', esc);
  setTimeout(() => { const f = caixa.querySelector('input:not([type=hidden]):not([readonly]), select, textarea'); f && f.focus(); }, 30);
  return { fechar, caixa };
}

// Confirmação para ações que encerram/alteram significativamente um acompanhamento
export function confirmar({ titulo = 'Confirmar', mensagem, botao = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      titulo, corpo: h('p', { style: { margin: 0 } }, mensagem),
      rodape: [
        h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'),
        h('button', { class: `btn ${perigo ? 'perigo' : 'primario'}`, onclick: () => { ok = true; m.fechar(); } }, botao),
      ],
      aoFechar: () => resolve(ok),
    });
  });
}

// Formulário em modal: campos [{nome, rotulo, tipo, obrigatorio, valor, opcoes, ajuda}]
export function formulario({ titulo, campos, botao = 'Salvar', aviso, aoEnviar, largo }) {
  const els = {};
  const corpo = h('form', { class: 'grade-form', onsubmit: (e) => { e.preventDefault(); enviar(); } },
    aviso ? h('div', { class: `aviso ${aviso.cor || 'azul'} largo` }, aviso.texto) : null,
    campos.map((c) => {
      let input;
      if (c.tipo === 'select') {
        input = h('select', { name: c.nome, required: c.obrigatorio }, (c.opcoes || []).map(([v, t]) => h('option', { value: v, selected: String(v) === String(c.valor ?? '') }, t)));
      } else if (c.tipo === 'textarea') {
        input = h('textarea', { name: c.nome, required: c.obrigatorio, maxlength: c.max || 1000, placeholder: c.placeholder || '' });
        input.value = c.valor ?? '';
      } else {
        input = h('input', { name: c.nome, type: c.tipo || 'text', required: c.obrigatorio, value: c.valor ?? '', placeholder: c.placeholder || '', maxlength: c.max || 200, min: c.min, max: c.maxData, autocomplete: c.autocomplete || 'off', readOnly: c.somenteLeitura || false });
      }
      els[c.nome] = input;
      return h('div', { class: `campo ${c.largo ? 'largo' : ''}` }, h('label', { class: c.obrigatorio ? 'req' : '' }, c.rotulo), input, c.ajuda ? h('span', { class: 'ajuda' }, c.ajuda) : null);
    }),
    h('button', { type: 'submit', class: 'oculto' }));
  const btn = h('button', { class: 'btn primario', onclick: () => enviar() }, botao);
  const m = modal({ titulo, corpo, largo, rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), btn] });
  async function enviar() {
    if (!corpo.reportValidity()) return;
    const valores = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value.trim()]));
    btn.disabled = true;
    try { const r = await aoEnviar(valores); if (r !== false) m.fechar(); }
    catch (e) { toast(e.message, 'erro'); }
    finally { btn.disabled = false; }
  }
  return m;
}

// Menu "⋯" com ações secundárias
export function menuAcoes(itens) {
  const lista = h('div', { class: 'lista oculto' }, itens.filter(Boolean).map((it) =>
    h('button', { class: it.perigo ? 'perigo' : '', onclick: (e) => { e.stopPropagation(); lista.classList.add('oculto'); it.acao(); } }, it.texto)));
  const btn = h('button', { class: 'btn peq fantasma icone', title: 'Mais ações', 'aria-label': 'Mais ações', onclick: (e) => {
    e.stopPropagation();
    document.querySelectorAll('.suspenso .lista').forEach((l) => l !== lista && l.classList.add('oculto'));
    lista.classList.toggle('oculto');
  } }, '⋯');
  return h('div', { class: 'suspenso' }, btn, lista);
}
document.addEventListener('click', () => document.querySelectorAll('.suspenso .lista').forEach((l) => l.classList.add('oculto')));

// Botão que executa uma ação assíncrona com proteção contra duplo clique
export function botaoAcao(texto, classe, acao, title) {
  const b = h('button', { class: `btn peq ${classe || ''}`, title, onclick: async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await acao(); } catch (err) { toast(err.message, 'erro'); } finally { b.disabled = false; }
  } }, texto);
  return b;
}

// Tabela (vira cartões no celular)
export function tabela(colunas, linhas, { vazio = 'Nada por aqui.', classeLinha } = {}) {
  if (!linhas.length) return h('div', { class: 'vazio' }, h('div', { class: 'grande' }, '✓'), vazio);
  return h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela responsiva' },
    h('thead', null, h('tr', null, colunas.map((c) => h('th', null, c.titulo)))),
    h('tbody', null, linhas.map((l) => h('tr', { class: classeLinha ? classeLinha(l) : '' },
      colunas.map((c) => h('td', { 'data-rot': c.titulo, class: c.semRotulo ? 'sem-rot' : '' }, c.valor(l))))))));
}

// ---------- Exportação Excel/CSV (separador ";" e BOM para o Excel em português)
export function exportarCsv(nome, colunas, linhas) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas maliciosas
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '﻿' + [colunas.map((c) => esc(c.titulo)).join(';'),
    ...linhas.map((l) => colunas.map((c) => esc(c.valor(l))).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `${nome}_${hojeISO()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function carregando() { return h('div', { class: 'vazio' }, h('div', { class: 'spinner', style: { margin: '0 auto 10px' } }), 'Carregando…'); }

export const ICONES = {
  pata: '<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="40" r="13" fill="currentColor"/><circle cx="15" cy="25" r="6.5" fill="currentColor"/><circle cx="26" cy="13" r="6.5" fill="currentColor"/><circle cx="38" cy="13" r="6.5" fill="currentColor"/><circle cx="49" cy="25" r="6.5" fill="currentColor"/></svg>',
  busca: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
