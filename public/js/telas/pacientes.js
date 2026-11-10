// Cadastro de Tutores e Pacientes: pesquisa rápida e cadastro sem duplicidade.
import { rpc, sb, consulta } from '../api.js';
import { h, limpar, toast, formulario, confirmar, seloInternado, telefone, ICONES } from '../ui.js';

export async function render(el, rota) {
  const entrada = h('input', { type: 'search', placeholder: 'Pesquise por ID, nome do tutor, nome do animal ou telefone…', autofocus: true, value: rota.params.get('q') || '' });
  const res = h('div');
  let t = null;
  const buscar = async () => {
    const q = entrada.value.trim();
    if (!el.isConnected) return;
    if (location.hash.startsWith('#/pacientes')) history.replaceState(null, '', q ? `#/pacientes?q=${encodeURIComponent(q)}` : '#/pacientes');
    if (q.length < 2) return limpar(res, h('div', { class: 'vazio' }, h('div', { class: 'grande' }, '🐾'), 'Digite ao menos 2 caracteres para pesquisar. Sempre pesquise antes de cadastrar, para evitar duplicidade.'));
    const tutores = await rpc('buscar_cadastros', { q });
    limpar(res, tutores.length ? tutores.map((tu) => cartaoTutor(tu, buscar)) : h('div', { class: 'vazio' },
      h('p', null, `Nenhum cadastro encontrado para "${q}".`),
      h('a', { class: 'btn primario', href: `#/novo?q=${encodeURIComponent(q)}` }, '+ Novo atendimento (cadastrar tutor)')));
  };
  entrada.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
  limpar(el,
    h('div', { class: 'cabecalho' }, h('h1', null, 'Tutores e Pacientes'),
      h('div', { class: 'acoes' }, h('a', { class: 'btn primario', href: '#/novo' }, '+ Novo atendimento'))),
    h('div', { class: 'cartao', style: { marginBottom: '16px' } }, h('div', { class: 'corpo' }, h('div', { class: 'busca-grande' }, h('span', { html: ICONES.busca }), entrada))),
    res);
  await buscar();
  return { atualizar: buscar };
}

function cartaoTutor(tu, aoMudar) {
  return h('div', { class: 'resultado-tutor' },
    h('div', { class: 'acoes-linha' },
      h('div', null, h('b', null, tu.nome), h('span', { class: 'fraco' }, `  ·  ID ${tu.id_externo}  ·  `), telefone(tu.telefone)),
      h('div', { style: { marginLeft: 'auto' }, class: 'acoes-linha' },
        h('button', { class: 'btn peq', onclick: () => formTutor(tu, aoMudar) }, 'Editar tutor'),
        h('a', { class: 'btn peq primario', href: `#/novo?tutor=${tu.id}` }, '+ Atendimento / outro animal'))),
    tu.observacoes ? h('div', { class: 'fraco' }, tu.observacoes) : null,
    h('div', { class: 'animais' }, tu.animais.length ? tu.animais.map((a) => h('a', { class: 'chip-animal', href: `#/paciente/${a.id}` },
      `🐾 ${a.nome}`, h('span', { class: 'fraco' }, `${a.especie} · ID ${a.id_externo}`), a.internado ? seloInternado() : null))
      : h('span', { class: 'fraco' }, 'Nenhum animal cadastrado para este tutor.')));
}

export function formTutor(tu, aoMudar, sugestao = '') {
  const pareceId = /^\d+$/.test(sugestao);
  const pareceTel = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(sugestao);
  formulario({
    titulo: tu ? `Editar tutor — ${tu.nome}` : 'Novo tutor',
    campos: [
      { nome: 'id_externo', rotulo: 'ID do tutor no sistema veterinário', obrigatorio: true, valor: tu ? tu.id_externo : (pareceId ? sugestao : ''), max: 40 },
      { nome: 'nome', rotulo: 'Nome completo', obrigatorio: true, valor: tu ? tu.nome : (!pareceId && !pareceTel ? sugestao : ''), max: 150 },
      { nome: 'telefone', rotulo: 'Telefone / WhatsApp', tipo: 'tel', valor: tu ? tu.telefone || '' : (pareceTel ? sugestao : ''), placeholder: '(11) 98765-4321', max: 20 },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: tu ? tu.observacoes || '' : '', largo: true },
    ],
    aviso: { texto: 'Dados pessoais protegidos (LGPD): registre somente o necessário para o atendimento.' },
    aoEnviar: async (v) => {
      const p = { ...v, id: tu ? tu.id : null, versao: tu ? tu.versao : undefined };
      try { await rpc('salvar_tutor', { p }); }
      catch (e) {
        if (e.codigo !== 'PAD01') throw e;
        if (!(await confirmar({ titulo: 'Possível duplicidade', mensagem: e.message, botao: 'É outra pessoa — cadastrar' }))) return false;
        await rpc('salvar_tutor', { p: { ...p, confirmar: true } });
      }
      toast(tu ? 'Tutor atualizado.' : 'Tutor cadastrado.');
      aoMudar && aoMudar();
    },
  });
}

export function formAnimal(a, tutor, aoMudar) {
  formulario({
    titulo: a ? `Editar paciente — ${a.nome}` : `Novo animal de ${tutor.nome}`,
    campos: [
      { nome: 'id_externo', rotulo: 'ID do animal no sistema veterinário', obrigatorio: true, valor: a ? a.id_externo : '', max: 40 },
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: a ? a.nome : '', max: 100 },
      { nome: 'especie', rotulo: 'Espécie', obrigatorio: true, valor: a ? a.especie : '', placeholder: 'Canina, Felina…', max: 60 },
    ],
    aviso: a ? null : { texto: 'Cadastrar o animal não abre atendimento nem cria retorno. Para isso, use "Novo atendimento" ou "Cadastrar exames" na ficha.' },
    aoEnviar: async (v) => {
      const p = { ...v, id: a ? a.id : null, tutor_id: tutor.id, versao: a ? a.versao : undefined };
      let id;
      try { id = await rpc('salvar_animal', { p }); }
      catch (e) {
        if (e.codigo !== 'PAD01') throw e;
        if (!(await confirmar({ titulo: 'Possível duplicidade', mensagem: e.message, botao: 'É outro animal — cadastrar' }))) return false;
        id = await rpc('salvar_animal', { p: { ...p, confirmar: true } });
      }
      toast(a ? 'Paciente atualizado.' : 'Paciente cadastrado.');
      if (!a) location.hash = `#/paciente/${id}`; else aoMudar && aoMudar();
    },
  });
}

// Troca de tutor responsável (correção de cadastro)
export async function escolherTutor(atualId) {
  const tutores = await consulta(sb.from('tutores').select('id, nome, id_externo').order('nome').limit(1000));
  return tutores.filter((t) => t.id !== atualId);
}
