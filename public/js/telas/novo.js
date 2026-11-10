// Novo atendimento em uma única tela, por passos:
// 1 Tutor → 2 Paciente → 3 Atendimento (com exame ou sem exame) → 4 Conferir e salvar.
// Nada é gravado até o "Concluir"; aí tudo é salvo de uma vez (uma única transação no banco).
import { rpc, sb, cache } from '../api.js';
import { h, limpar, toast, confirmar, fmtData, hojeISO, somarDias, seloInternado, ICONES } from '../ui.js';
import { diasRetorno } from '../formExames.js';

const PASSOS = ['Tutor', 'Paciente', 'Atendimento', 'Conferir'];
const ESPECIES = ['Canina', 'Felina', 'Ave', 'Roedor', 'Lagomorfo (coelho)', 'Réptil', 'Outra'];

export async function render(el) {
  const [tipos, labs, prazos, dias] = await Promise.all([cache.tipos(), cache.laboratorios(), cache.prazos(), diasRetorno()]);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const labsAtivos = labs.filter((l) => l.ativo);
  const prazoDe = (tipo, lab) => prazos.find((p) => p.tipo_exame_id === Number(tipo) && p.laboratorio_id === Number(lab) && p.ativo);

  // Estado do cadastro
  const st = {
    passo: 0,
    tutor: null,          // tutor existente (da pesquisa) — com .animais
    tutorNovo: null,      // { id_externo, nome, telefone, observacoes }
    animal: null,         // animal existente
    animalNovo: null,     // { id_externo, nome, especie }
    data: hojeISO(),
    descricao: '',
    comExame: null,       // true | false
    itens: [],            // [{ tipo_exame_id, laboratorio_id, observacoes }]
    gerarRetorno: false,
    dataRetorno: somarDias(hojeISO(), dias),
  };

  const elPassos = h('div', { class: 'passos' });
  const elCorpo = h('div', { class: 'cartao' });
  limpar(el,
    h('div', { class: 'cabecalho' }, h('div', null, h('h1', null, 'Novo atendimento'),
      h('p', { class: 'fraco', style: { margin: '4px 0 0' } }, 'Tutor, paciente e exames em uma única tela. Nada é salvo até você clicar em "Concluir".'))),
    elPassos, elCorpo);

  function desenhar() {
    limpar(elPassos, PASSOS.map((p, i) => h('div', { class: `passo ${i === st.passo ? 'atual' : ''} ${i < st.passo ? 'feito' : ''}` },
      h('span', { class: 'bola' }, i < st.passo ? '✓' : i + 1), h('span', { class: 'nome' }, p))));
    [passoTutor, passoAnimal, passoAtendimento, passoConferir][st.passo]();
    window.scrollTo({ top: 0 });
  }
  const ir = (n) => { st.passo = n; desenhar(); };
  const rodape = (...botoes) => h('div', { class: 'rodape-passo' }, botoes);
  const voltar = () => h('button', { class: 'btn', onclick: () => ir(st.passo - 1) }, '← Voltar');
  const campo = (rot, input, { req = false, ajuda } = {}) => h('div', { class: 'campo' }, h('label', { class: req ? 'req' : '' }, rot), input, ajuda ? h('span', { class: 'ajuda' }, ajuda) : null);
  const inp = (valor, attrs = {}) => { const i = h('input', { type: 'text', autocomplete: 'off', ...attrs }); i.value = valor || ''; return i; };

  // ---------------------------------------------------------------- 1. TUTOR
  function passoTutor() {
    const busca = inp('', { type: 'search', placeholder: 'Pesquise por ID, nome do tutor, nome do animal ou telefone…' });
    const resultados = h('div');
    const formNovo = h('div', { class: 'oculto' });
    let t = null;

    const selecionarExistente = (tu) => { st.tutor = tu; st.tutorNovo = null; st.animal = null; st.animalNovo = null; ir(1); };
    const abrirNovo = (sugestao = '') => {
      const pareceId = /^\d+$/.test(sugestao);
      const pareceTel = /^[\d\s()+-]{10,}$/.test(sugestao) && !pareceId;
      const n = st.tutorNovo || {};
      const f = {
        id_externo: inp(n.id_externo || (pareceId ? sugestao : ''), { maxlength: 40 }),
        nome: inp(n.nome || (!pareceId && !pareceTel ? sugestao : ''), { maxlength: 150 }),
        telefone: inp(n.telefone || (pareceTel ? sugestao : ''), { type: 'tel', placeholder: '(11) 98765-4321', maxlength: 20 }),
        observacoes: inp(n.observacoes || '', { maxlength: 300, placeholder: 'Opcional' }),
      };
      limpar(formNovo, h('div', { class: 'secao-novo' },
        h('h3', null, 'Cadastrar tutor novo'),
        h('div', { class: 'grade-form' },
          campo('ID do tutor no sistema veterinário', f.id_externo, { req: true }),
          campo('Nome completo', f.nome, { req: true }),
          campo('Telefone / WhatsApp', f.telefone),
          campo('Observações', f.observacoes)),
        rodape(h('span'), h('button', { class: 'btn primario', onclick: () => {
          const v = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()]));
          if (!v.id_externo) return toast('Informe o ID do tutor.', 'aviso');
          if (v.nome.length < 2) return toast('Informe o nome completo do tutor.', 'aviso');
          if (v.telefone && !/^\d{10,13}$/.test(v.telefone.replace(/\D/g, ''))) return toast('Telefone inválido. Use DDD + número.', 'aviso');
          st.tutorNovo = v; st.tutor = null; st.animal = null;
          ir(1);
        } }, 'Avançar →'))));
      formNovo.classList.remove('oculto');
      (f.id_externo.value ? f.nome : f.id_externo).focus();
    };

    const buscar = async () => {
      const q = busca.value.trim();
      if (q.length < 2) { limpar(resultados); return; }
      const tutores = await rpc('buscar_cadastros', { q }).catch(() => []);
      limpar(resultados, tutores.length
        ? [h('div', { class: 'rotulo', style: { margin: '10px 0 6px' } }, 'Já cadastrado? Clique no tutor:'),
          tutores.map((tu) => h('button', { class: 'item-escolha', onclick: () => selecionarExistente(tu) },
            h('b', null, tu.nome), h('span', { class: 'fraco' }, ` · ID ${tu.id_externo}${tu.telefone ? ' · ' + tu.telefone : ''}`),
            h('div', { class: 'fraco' }, tu.animais.length ? `Animais: ${tu.animais.map((a) => a.nome).join(', ')}` : 'Sem animais cadastrados')))]
        : h('div', { class: 'aviso azul', style: { marginTop: '10px' } }, `Nenhum tutor encontrado para "${q}". Cadastre abaixo.`));
      if (!tutores.length) abrirNovo(q);
    };
    busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });

    limpar(elCorpo, h('div', { class: 'corpo' },
      h('h2', null, 'Quem é o tutor?'),
      h('p', { class: 'fraco' }, 'Pesquise primeiro para não cadastrar em duplicidade.'),
      h('div', { class: 'busca-grande' }, h('span', { html: ICONES.busca }), busca),
      resultados,
      h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => abrirNovo(busca.value.trim()) }, '+ Tutor novo')),
      formNovo));
    if (st.tutorNovo) abrirNovo();
    busca.focus();
  }

  // ---------------------------------------------------------------- 2. PACIENTE
  function passoAnimal() {
    const nomeTutor = st.tutor ? st.tutor.nome : st.tutorNovo.nome;
    const existentes = st.tutor ? st.tutor.animais : [];
    const formNovo = h('div', { class: existentes.length && !st.animalNovo ? 'oculto' : '' });
    const n = st.animalNovo || {};
    const f = {
      id_externo: inp(n.id_externo, { maxlength: 40 }),
      nome: inp(n.nome, { maxlength: 100 }),
      especie: inp(n.especie, { list: 'lista-especies', placeholder: 'Canina, Felina…', maxlength: 60 }),
    };
    limpar(formNovo, h('div', { class: 'secao-novo' },
      h('h3', null, existentes.length ? 'Cadastrar outro animal' : 'Cadastrar o animal'),
      h('div', { class: 'grade-form' },
        campo('ID do animal no sistema veterinário', f.id_externo, { req: true }),
        campo('Nome', f.nome, { req: true }),
        campo('Espécie', f.especie, { req: true })),
      h('datalist', { id: 'lista-especies' }, ESPECIES.map((e) => h('option', { value: e })))));

    const avancarNovo = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()]));
      if (!v.id_externo) return toast('Informe o ID do animal.', 'aviso');
      if (!v.nome) return toast('Informe o nome do animal.', 'aviso');
      if (v.especie.length < 2) return toast('Informe a espécie.', 'aviso');
      st.animalNovo = v; st.animal = null; ir(2);
    };

    limpar(elCorpo, h('div', { class: 'corpo' },
      h('h2', null, 'Qual é o paciente?'),
      h('p', { class: 'fraco' }, 'Tutor: ', h('b', null, nomeTutor), st.tutorNovo ? ' (novo)' : ''),
      existentes.length ? h('div', null,
        h('div', { class: 'rotulo', style: { marginBottom: '6px' } }, 'Escolha o animal:'),
        h('div', { class: 'animais' }, existentes.map((a) => h('button', { class: 'chip-animal', onclick: () => { st.animal = a; st.animalNovo = null; ir(2); } },
          `🐾 ${a.nome}`, h('span', { class: 'fraco' }, `${a.especie} · ID ${a.id_externo}`), a.internado ? seloInternado() : null)),
          h('button', { class: 'chip-animal', onclick: () => { formNovo.classList.remove('oculto'); f.id_externo.focus(); } }, '+ Outro animal'))) : null,
      formNovo,
      rodape(voltar(), h('button', { class: `btn primario ${existentes.length && !st.animalNovo ? 'oculto' : ''}`, id: 'avancar-animal', onclick: avancarNovo }, 'Avançar →'))));
    formNovo.addEventListener('focusin', () => document.getElementById('avancar-animal')?.classList.remove('oculto'));
    if (!existentes.length) f.id_externo.focus();
  }

  // ---------------------------------------------------------------- 3. ATENDIMENTO
  function passoAtendimento() {
    const data = h('input', { type: 'date', value: st.data, max: hojeISO() });
    const descricao = inp(st.descricao, { placeholder: 'Ex.: consulta dermatológica, check-up… (opcional)', maxlength: 200 });
    const blocoExames = h('div');
    const blocoSemExame = h('div');
    const linhas = h('div');

    // --- linhas de exame
    function novaLinha(item = {}) {
      const tipo = h('select', null, h('option', { value: '' }, 'Selecione o exame…'), tiposAtivos.map((t) => h('option', { value: t.id, selected: t.id === item.tipo_exame_id }, t.nome)));
      const lab = h('select');
      const prev = h('div', { class: 'prev' }, '—');
      const obs = inp(item.observacoes, { placeholder: 'Observações (opcional)', maxlength: 300 });
      const atualizarPrev = async () => {
        const p = prazoDe(tipo.value, lab.value);
        if (!p || !data.value) { prev.textContent = '—'; return; }
        const { data: d } = await sb.rpc('soma_dias_uteis', { inicio: data.value, n: p.dias_uteis });
        prev.textContent = d ? `Resultado previsto: ${fmtData(d)}` : '—';
      };
      const atualizarLabs = () => {
        const comPrazo = labsAtivos.filter((l) => prazoDe(tipo.value, l.id));
        const atual = lab.value || String(item.laboratorio_id || '');
        limpar(lab, h('option', { value: '' }, tipo.value && !comPrazo.length ? 'Nenhum laboratório com prazo configurado' : 'Selecione…'),
          comPrazo.map((l) => h('option', { value: l.id, selected: String(l.id) === atual || comPrazo.length === 1 }, `${l.nome} — ${prazoDe(tipo.value, l.id).dias_uteis} dia(s) útil(eis)`)));
        atualizarPrev();
      };
      tipo.addEventListener('change', atualizarLabs); lab.addEventListener('change', atualizarPrev);
      const linha = h('div', { class: 'linha-exame' },
        h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Exame'), tipo),
        h('div', { class: 'campo' }, h('label', { class: 'req' }, 'Laboratório / profissional'), lab),
        prev,
        h('button', { type: 'button', class: 'btn peq fantasma', title: 'Remover', onclick: () => { if (linhas.children.length > 1) linha.remove(); } }, '✕'),
        h('div', { class: 'campo', style: { gridColumn: '1 / -1' } }, obs));
      linha._valor = () => ({ tipo_exame_id: Number(tipo.value), laboratorio_id: Number(lab.value), observacoes: obs.value.trim() || null });
      linha._ok = () => tipo.value && lab.value;
      linha._prev = atualizarPrev;
      linhas.append(linha);
      atualizarLabs();
      if (!item.tipo_exame_id) tipo.focus();
    }

    // --- retorno
    const chkRetorno = h('input', { type: 'checkbox', checked: st.gerarRetorno });
    const dataRetExame = h('input', { type: 'date', value: st.dataRetorno, min: hojeISO() });
    const dataRetSem = h('input', { type: 'date', value: st.dataRetorno, min: hojeISO() });
    const sincronizar = (origem) => { st.dataRetorno = origem.value; dataRetExame.value = origem.value; dataRetSem.value = origem.value; };
    dataRetExame.addEventListener('change', () => sincronizar(dataRetExame));
    dataRetSem.addEventListener('change', () => sincronizar(dataRetSem));
    const blocoRetExame = h('div', { class: st.gerarRetorno ? '' : 'oculto', style: { maxWidth: '220px' } }, campo('Data prevista do retorno clínico', dataRetExame));
    chkRetorno.addEventListener('change', () => blocoRetExame.classList.toggle('oculto', !chkRetorno.checked));

    limpar(blocoExames,
      h('div', { class: 'rotulo', style: { marginBottom: '6px' } }, 'Exames realizados'),
      linhas,
      h('button', { type: 'button', class: 'btn peq', onclick: () => novaLinha() }, '+ Adicionar outro exame'),
      h('div', { class: 'aviso azul', style: { marginTop: '12px' } }, 'A previsão de cada resultado é calculada sozinha (dias úteis, sem feriados). Quando todos os laudos chegarem, o sistema avisa para agendar o retorno de avaliação dos exames.'),
      h('label', { class: 'check', style: { marginTop: '12px' } }, chkRetorno, 'Também programar um retorno clínico (independente dos exames)'),
      blocoRetExame);
    limpar(blocoSemExame,
      h('div', { class: 'aviso amarelo' }, h('b', null, 'Sem exame: programe o retorno.'), ' O alerta aparece para a recepção na data prevista.'),
      h('div', { class: 'linha-form', style: { marginTop: '12px' } },
        campo('Data prevista do retorno', dataRetSem, { req: true }),
        h('div', { class: 'acoes-linha' }, [7, 15, 30].map((d) => h('button', { type: 'button', class: 'btn peq', onclick: () => { dataRetSem.value = somarDias(data.value || hojeISO(), d); sincronizar(dataRetSem); } }, `${d} dias`)))));

    const radios = h('div', { class: 'opcoes-radio grande' },
      h('label', null, h('input', { type: 'radio', name: 'comexame', value: 'sim', checked: st.comExame === true }), '🧪 Com exame'),
      h('label', null, h('input', { type: 'radio', name: 'comexame', value: 'nao', checked: st.comExame === false }), '📅 Sem exame'));
    const mostrar = () => {
      blocoExames.classList.toggle('oculto', st.comExame !== true);
      blocoSemExame.classList.toggle('oculto', st.comExame !== false);
      if (st.comExame && !linhas.children.length) novaLinha();
    };
    radios.addEventListener('change', (e) => { st.comExame = e.target.value === 'sim'; mostrar(); });
    data.addEventListener('change', () => {
      [...linhas.children].forEach((l) => l._prev());
      if (data.value) { dataRetSem.value = somarDias(data.value, dias); sincronizar(dataRetSem); }
    });

    st.itens.forEach((it) => novaLinha(it));
    mostrar();

    const paciente = st.animal ? st.animal.nome : st.animalNovo.nome;
    limpar(elCorpo, h('div', { class: 'corpo' },
      h('h2', null, `Atendimento de ${paciente}`),
      h('div', { class: 'grade-form' }, campo('Data do atendimento', data, { req: true }), h('div', { class: 'campo', style: { gridColumn: 'span 2' } }, h('label', null, 'Descrição'), descricao)),
      h('h3', { style: { margin: '18px 0 8px' } }, 'Este atendimento tem exame?'),
      radios, h('div', { style: { marginTop: '14px' } }, blocoExames, blocoSemExame),
      rodape(voltar(), h('button', { class: 'btn primario', onclick: () => {
        if (!data.value || data.value > hojeISO()) return toast('Informe a data do atendimento (não pode ser futura).', 'aviso');
        if (st.comExame === null) return toast('Responda: o atendimento tem exame ou não?', 'aviso');
        st.data = data.value; st.descricao = descricao.value.trim();
        if (st.comExame) {
          const ls = [...linhas.children];
          if (!ls.length || !ls.every((l) => l._ok())) return toast('Selecione o exame e o laboratório em todas as linhas.', 'aviso');
          st.itens = ls.map((l) => l._valor());
          st.gerarRetorno = chkRetorno.checked;
          if (st.gerarRetorno && !dataRetExame.value) return toast('Informe a data do retorno clínico.', 'aviso');
        } else {
          if (!dataRetSem.value) return toast('Informe a data prevista do retorno.', 'aviso');
          if (dataRetSem.value < st.data) return toast('O retorno não pode ser antes do atendimento.', 'aviso');
          st.itens = [];
        }
        ir(3);
      } }, 'Avançar →'))));
  }

  // ---------------------------------------------------------------- 4. CONFERIR
  function passoConferir() {
    const tutor = st.tutor || st.tutorNovo;
    const animal = st.animal || st.animalNovo;
    const nomeTipo = (id) => (tipos.find((t) => t.id === id) || {}).nome;
    const nomeLab = (id) => (labs.find((l) => l.id === id) || {}).nome;
    const linha = (rot, ...v) => h('div', { class: 'linha-resumo' }, h('span', { class: 'fraco' }, rot), h('div', null, ...v));
    const novo = h('span', { class: 'selo azul' }, 'novo');
    const btn = h('button', { class: 'btn primario grande-btn', onclick: () => salvar(btn) }, '✓ Concluir cadastro');
    limpar(elCorpo, h('div', { class: 'corpo' },
      h('h2', null, 'Confira antes de salvar'),
      h('div', { class: 'resumo' },
        linha('Tutor', h('b', null, tutor.nome), ` · ID ${tutor.id_externo} `, st.tutorNovo ? novo : null, h('button', { class: 'btn peq fantasma', onclick: () => ir(0) }, 'alterar')),
        linha('Paciente', h('b', null, animal.nome), ` · ${animal.especie} · ID ${animal.id_externo} `, st.animalNovo ? novo : null, h('button', { class: 'btn peq fantasma', onclick: () => ir(1) }, 'alterar')),
        linha('Atendimento', fmtData(st.data), st.descricao ? ` — ${st.descricao}` : '', h('button', { class: 'btn peq fantasma', onclick: () => ir(2) }, 'alterar')),
        st.comExame
          ? linha('Exames', h('ul', { style: { margin: 0, paddingLeft: '18px' } }, st.itens.map((i) => h('li', null, `${nomeTipo(i.tipo_exame_id)} — ${nomeLab(i.laboratorio_id)}`))))
          : linha('Exames', 'Sem exame'),
        linha('Retorno', st.comExame
          ? (st.gerarRetorno ? `Retorno clínico previsto para ${fmtData(st.dataRetorno)} + retorno de avaliação quando os laudos chegarem` : 'Retorno de avaliação será liberado quando todos os laudos chegarem')
          : `Retorno previsto para ${fmtData(st.dataRetorno)}`)),
      rodape(voltar(), btn)));
  }

  async function salvar(btn, extra = {}) {
    const p = {
      tutor: st.tutor ? { id: st.tutor.id } : st.tutorNovo,
      animal: st.animal ? { id: st.animal.id } : st.animalNovo,
      data: st.data, descricao: st.descricao || null, com_exame: st.comExame, itens: st.itens,
      gerar_retorno: st.comExame ? st.gerarRetorno : true,
      data_retorno: !st.comExame || st.gerarRetorno ? st.dataRetorno : null,
      ...extra,
    };
    btn.disabled = true;
    try {
      const r = await rpc('registrar_atendimento_completo', { p });
      concluido(r);
    } catch (e) {
      btn.disabled = false;
      if (e.codigo !== 'PAD01') return toast(e.message, 'erro');
      // Possível duplicidade: pergunta e reenvia confirmando só aquele ponto
      const qual = /tutor/i.test(e.message) && !/animal chamado/i.test(e.message) ? 'confirmar_tutor'
        : /animal chamado/i.test(e.message) ? 'confirmar_animal'
          : /acompanhamento aberto/i.test(e.message) ? 'confirmar_atendimento' : 'confirmar_duplicado';
      if (await confirmar({ titulo: 'Possível duplicidade', mensagem: e.message, botao: 'Continuar mesmo assim' })) salvar(btn, { ...extra, [qual]: true });
    }
  }

  function concluido(r) {
    const animal = st.animal || st.animalNovo;
    limpar(elPassos);
    limpar(elCorpo, h('div', { class: 'corpo', style: { textAlign: 'center', padding: '36px 16px' } },
      h('div', { style: { fontSize: '2.6rem' } }, '✅'),
      h('h2', null, 'Cadastro concluído!'),
      h('p', { class: 'suave' }, r.com_exame
        ? `${r.exames.length} exame(s) de ${animal.nome} cadastrado(s). A previsão de cada resultado já está no painel.`
        : `Atendimento de ${animal.nome} registrado, com retorno previsto para ${fmtData(st.dataRetorno)}.`),
      h('div', { class: 'acoes-linha', style: { justifyContent: 'center', marginTop: '16px' } },
        h('a', { class: 'btn primario', href: '#/novo', onclick: (e) => { e.preventDefault(); render(el); } }, '+ Novo atendimento'),
        h('a', { class: 'btn', href: `#/paciente/${r.animal_id}` }, 'Abrir ficha do paciente'),
        h('a', { class: 'btn', href: '#/painel' }, 'Ir para a Central'))));
    toast('Cadastro salvo.');
  }

  desenhar();
  return {};
}
