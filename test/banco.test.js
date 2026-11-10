'use strict';
// Testes obrigatórios (seção 20) executados contra PostgreSQL real com o ambiente Supabase simulado.
// Uso: TEST_PGHOST=/tmp/pgt TEST_PGPORT=54329 node --test test/
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client, types } = require('pg');
types.setTypeParser(1082, (v) => v);

const conn = { host: process.env.TEST_PGHOST || '/tmp/pgt', port: Number(process.env.TEST_PGPORT || 54329), user: 'postgres' };
const DB = 'patinhas_teste';
let pool;
const U = {};            // usuários de teste
const L = {}, T = {};    // laboratórios e tipos de exame

// Executa uma chamada como usuário logado (papel authenticated + JWT), numa transação própria.
async function como(usuario, sql, params = [], hoje = '2026-11-06') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (usuario) {
      await c.query("SELECT set_config('role', 'authenticated', true), set_config('request.jwt.claim.sub', $1, true)", [usuario.id]);
    } else {
      await c.query("SELECT set_config('role', 'anon', true)");
    }
    await c.query("SELECT set_config('app.hoje', $1, true)", [hoje]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}
const um = async (...a) => (await como(...a))[0];
const sistema = (sql, params) => pool.query(sql, params).then((r) => r.rows);

async function criarUsuario(nome, login, perfil, situacao = 'ativo') {
  const id = crypto.randomUUID();
  await sistema('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${login}@teste.local`]);
  await sistema('INSERT INTO perfis (id, nome_completo, login, perfil, situacao) VALUES ($1,$2,$3,$4,$5)', [id, nome, login, perfil, situacao]);
  return { id, nome, login, perfil };
}

async function novoPaciente(sufixo, especie = 'Canina') {
  const tutor = await um(U.nathaly, 'SELECT salvar_tutor($1) AS id', [{ id_externo: 'T' + sufixo, nome: 'Tutor ' + sufixo, telefone: '(11) 9' + String(Math.abs(hash(sufixo))).padStart(8, '0').slice(0, 8) }]);
  const animal = await um(U.nathaly, 'SELECT salvar_animal($1) AS id', [{ id_externo: 'A' + sufixo, nome: 'Pet ' + sufixo, especie, tutor_id: tutor.id }]);
  return { tutorId: tutor.id, animalId: animal.id };
}
function hash(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

async function cadastrar(usuario, animalId, data, itens, extra = {}, hoje = data) {
  return (await um(usuario, 'SELECT cadastrar_exames($1) AS r', [{ animal_id: animalId, data_realizacao: data, itens, ...extra }], hoje)).r;
}
const exame = (id, hoje = '2026-11-06') => um(U.nathaly, 'SELECT * FROM v_exames WHERE id = $1', [id], hoje);
const retornosDe = (animalId, hoje = '2026-11-06') => como(U.nathaly, 'SELECT * FROM v_retornos WHERE animal_id = $1 ORDER BY id', [animalId], hoje);
const histDe = (animalId) => sistema('SELECT * FROM historico WHERE animal_id = $1 ORDER BY id', [animalId]);

before(async () => {
  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  pool = new Pool({ ...conn, database: DB, max: 12 });
  const c = await pool.connect();
  await c.query("SET client_min_messages = error");
  await c.query(fs.readFileSync(path.join(__dirname, 'supabase_stub.sql'), 'utf8'));
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).sort()) {
    await c.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', f), 'utf8'));
  }
  c.release();

  U.gestora = await criarUsuario('Bruna Gestora', 'bruna', 'admin');
  U.nathaly = await criarUsuario('Nathaly Souza', 'nathaly', 'recepcao');
  U.juliana = await criarUsuario('Juliana Lima', 'juliana', 'recepcao');

  // Configuração pela gestão (via API, como administradora)
  for (const [k, nome] of [['A', 'Laboratório A'], ['B', 'Laboratório B'], ['V', 'Dra. Vet Imagem']]) {
    L[k] = (await um(U.gestora, `INSERT INTO laboratorios (nome, tipo) VALUES ($1, $2) RETURNING id`, [nome, k === 'V' ? 'profissional' : 'laboratorio'])).id;
  }
  for (const [k, nome] of [['hemo', 'Hemograma'], ['us', 'Ultrassom'], ['eco', 'Ecocardiograma'], ['histo', 'Histopatológico'], ['bio', 'Bioquímico']]) {
    T[k] = (await um(U.gestora, `INSERT INTO tipos_exame (nome) VALUES ($1) RETURNING id`, [nome])).id;
  }
  const prazos = [['hemo', 'A', 1], ['hemo', 'B', 2], ['histo', 'A', 7], ['us', 'V', 0], ['eco', 'V', 3], ['bio', 'A', 2], ['bio', 'B', 1]];
  for (const [t, l, d] of prazos) await como(U.gestora, 'INSERT INTO prazos (tipo_exame_id, laboratorio_id, dias_uteis) VALUES ($1,$2,$3)', [T[t], L[l], d]);
  await como(U.gestora, "INSERT INTO feriados (data, descricao) VALUES ('2026-11-20', 'Dia da Consciência Negra')");
});

after(async () => { await pool.end(); });

// ---------------------------------------------------------------- 1
test('1. Tutor com dois animais diferentes', async () => {
  const t = await um(U.nathaly, 'SELECT salvar_tutor($1) AS id', [{ id_externo: '1001', nome: 'Maria Oliveira', telefone: '(11) 98888-7777' }]);
  const a1 = await um(U.nathaly, 'SELECT salvar_animal($1) AS id', [{ id_externo: '5001', nome: 'Mel', especie: 'Canina', tutor_id: t.id }]);
  const a2 = await um(U.nathaly, 'SELECT salvar_animal($1) AS id', [{ id_externo: '5002', nome: 'Thor', especie: 'Felina', tutor_id: t.id }]);
  const animais = await como(U.nathaly, 'SELECT * FROM animais WHERE tutor_id = $1 ORDER BY id', [t.id]);
  assert.equal(animais.length, 2);
  assert.notEqual(a1.id, a2.id);
  // Duplicação acidental bloqueada: mesmo ID externo, mesmo telefone, mesmo nome de animal no tutor
  await assert.rejects(como(U.juliana, 'SELECT salvar_tutor($1)', [{ id_externo: '1001', nome: 'Outra' }]), /Já existe um tutor com o ID 1001/);
  await assert.rejects(como(U.juliana, 'SELECT salvar_tutor($1)', [{ id_externo: '1999', nome: 'M. Oliveira', telefone: '11988887777' }]), (e) => e.code === 'PAD01');
  await assert.rejects(como(U.juliana, 'SELECT salvar_animal($1)', [{ id_externo: '5003', nome: 'mel', especie: 'Canina', tutor_id: t.id }]), (e) => e.code === 'PAD01');
  // Pesquisa por ID, nome do tutor, nome do animal e telefone
  for (const q of ['1001', 'oliveira', 'thor', '98888']) {
    const r = (await um(U.nathaly, 'SELECT buscar_cadastros($1) AS r', [q])).r;
    assert.equal(r.length, 1, `busca "${q}"`);
    assert.equal(r[0].animais.length, 2);
  }
  // Abrir/editar a ficha não cria atendimento nem retorno
  await como(U.nathaly, 'SELECT salvar_animal($1)', [{ id: a1.id, id_externo: '5001', nome: 'Mel', especie: 'Canina (SRD)', tutor_id: t.id }]);
  assert.equal((await como(U.nathaly, 'SELECT * FROM atendimentos WHERE animal_id = $1', [a1.id])).length, 0);
  assert.equal((await retornosDe(a1.id)).length, 0);
});

// ---------------------------------------------------------------- 2, 3, 4
test('2/3/4. Vários exames na mesma data, laboratórios e prazos diferentes, prazo atravessando fim de semana', async () => {
  const p = await novoPaciente('mel2');
  // Sexta-feira 06/11/2026
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-06', [
    { tipo_exame_id: T.hemo, laboratorio_id: L.A },   // 1 dia útil → segunda 09/11
    { tipo_exame_id: T.us, laboratorio_id: L.V },     // 0 dia → própria data 06/11
    { tipo_exame_id: T.eco, laboratorio_id: L.V },    // 3 dias úteis → quarta 11/11
  ]);
  assert.equal(r.exames.length, 3);
  assert.equal(r.atendimento_novo, true);
  const ex = await Promise.all(r.exames.map((id) => exame(id)));
  assert.deepEqual(ex.map((e) => e.data_prevista), ['2026-11-09', '2026-11-06', '2026-11-11']);
  assert.deepEqual(ex.map((e) => e.prazo_dias), [1, 0, 3]);
  assert.ok(ex.every((e) => e.atendimento_id === r.atendimento_id), 'agrupados no mesmo acompanhamento');
  // Mais um exame no mesmo dia → agrupado automaticamente no mesmo acompanhamento
  const r2 = await cadastrar(U.juliana, p.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.B }]);
  assert.equal(r2.atendimento_id, r.atendimento_id);
  assert.equal((await exame(r2.exames[0])).data_prevista, '2026-11-10'); // Lab B: 2 dias úteis
  // Mesmo exame/laboratório repetido pede confirmação
  await assert.rejects(cadastrar(U.juliana, p.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }]), (e) => e.code === 'PAD01');
  // Retorno clínico automático gerado uma única vez para o novo acompanhamento (15 dias)
  const rets = await retornosDe(p.animalId);
  assert.equal(rets.length, 1);
  assert.equal(rets[0].tipo, 'clinico');
  assert.equal(rets[0].data_prevista, '2026-11-21');
});

// ---------------------------------------------------------------- 5
test('5. Prazo atravessando feriado', async () => {
  const p = await novoPaciente('fer');
  // Quinta 19/11; sexta 20/11 é feriado; 2 dias úteis → seg 23 (1), ter 24 (2)
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-19', [{ tipo_exame_id: T.hemo, laboratorio_id: L.B }]);
  assert.equal((await exame(r.exames[0], '2026-11-19')).data_prevista, '2026-11-24');
  // Função de dias úteis isolada
  assert.equal((await um(U.nathaly, "SELECT soma_dias_uteis('2026-11-19', 1) AS d")).d, '2026-11-23');
  assert.equal((await um(U.nathaly, "SELECT soma_dias_uteis('2026-11-21', 0) AS d")).d, '2026-11-21');
});

// ---------------------------------------------------------------- 6, 7, 8, 9, 10
test('6. Exame recebido antes do vencimento', async () => {
  const p = await novoPaciente('antes');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-02', [{ tipo_exame_id: T.histo, laboratorio_id: L.A }], {}, '2026-11-02');
  const e0 = await exame(r.exames[0], '2026-11-04');
  assert.equal(e0.data_prevista, '2026-11-11');
  assert.equal(e0.classificacao, 'no_prazo');
  await como(U.juliana, 'SELECT exame_receber($1)', [r.exames[0]], '2026-11-04');
  const e1 = await exame(r.exames[0], '2026-11-04');
  assert.equal(e1.classificacao, 'recebido');
  assert.equal(e1.recebido_com_atraso, false);
  assert.equal(e1.recebido_por_nome, 'Juliana Lima');
  // Duplo clique / dois funcionários: segunda marcação é recusada informando quem já marcou
  await assert.rejects(como(U.nathaly, 'SELECT exame_receber($1)', [r.exames[0]], '2026-11-04'), /já registrado como recebido por Juliana Lima/);
});

test('7/8. Exame atrasado; cobrado hoje e novamente pendente no próximo dia útil', async () => {
  const p = await novoPaciente('atraso');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-03', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }], {}, '2026-11-03'); // previsão 04/11
  const id = r.exames[0];
  assert.equal((await exame(id, '2026-11-04')).classificacao, 'vence_hoje');
  await assert.rejects(como(U.nathaly, 'SELECT exame_cobrar($1)', [id], '2026-11-04'), /dentro do prazo/);
  // Sexta 06/11: atrasado e aguardando cobrança
  let e = await exame(id, '2026-11-06');
  assert.equal(e.classificacao, 'atrasado');
  assert.equal(e.precisa_cobranca, true);
  await como(U.juliana, 'SELECT exame_cobrar($1)', [id], '2026-11-06');
  e = await exame(id, '2026-11-06');
  assert.equal(e.classificacao, 'atrasado', 'continua atrasado até o laudo chegar');
  assert.equal(e.precisa_cobranca, false, 'sai da lista de cobrança no dia');
  assert.equal(e.ultima_cobranca_por_nome, 'Juliana Lima');
  await assert.rejects(como(U.nathaly, 'SELECT exame_cobrar($1)', [id], '2026-11-06'), /já foi registrada hoje por Juliana Lima/);
  // Sábado e domingo: não volta (próximo dia útil é segunda)
  assert.equal((await exame(id, '2026-11-07')).precisa_cobranca, false);
  assert.equal((await exame(id, '2026-11-08')).precisa_cobranca, false);
  // Segunda 09/11: volta para a lista de cobrança
  assert.equal((await exame(id, '2026-11-09')).precisa_cobranca, true);
  await como(U.nathaly, 'SELECT exame_cobrar($1)', [id], '2026-11-09');
  e = await exame(id, '2026-11-09');
  assert.equal(e.qtd_cobrancas, 2, 'histórico de cobranças mantido');
  const cob = await sistema('SELECT c.data_cobranca, p.nome_completo FROM cobrancas c JOIN perfis p ON p.id = c.cobrado_por WHERE exame_id = $1 ORDER BY 1', [id]);
  assert.deepEqual(cob.map((c) => [c.data_cobranca, c.nome_completo]), [['2026-11-06', 'Juliana Lima'], ['2026-11-09', 'Nathaly Souza']]);
  // Painel conta corretamente
  const painel = (await um(U.nathaly, 'SELECT painel_contadores() AS p', [], '2026-11-10')).p;
  assert.ok(painel.exames.atrasados >= 1);
});

test('9/10. Laudo recebido sem comunicação; resultado comunicado pela internação', async () => {
  const p = await novoPaciente('com');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-05', [
    { tipo_exame_id: T.hemo, laboratorio_id: L.A }, { tipo_exame_id: T.bio, laboratorio_id: L.A }], {}, '2026-11-05');
  const [h, b] = r.exames;
  await como(U.nathaly, 'SELECT exame_receber($1)', [h]);
  let e = await exame(h);
  assert.equal(e.aguardando_comunicacao, true, 'recebido NÃO significa comunicado');
  assert.equal(e.comunicado_em, null);
  await assert.rejects(como(U.nathaly, "SELECT exame_comunicar($1, 'tutor')", [b]), /recebimento do laudo/);
  await como(U.juliana, "SELECT exame_comunicar($1, 'internacao')", [h]);
  e = await exame(h);
  assert.equal(e.aguardando_comunicacao, false);
  assert.equal(e.comunicacao_tipo, 'internacao');
  assert.equal(e.comunicado_por_nome, 'Juliana Lima');
  // Comunicar um resultado não encerra pendências dos outros exames do acompanhamento
  e = await exame(b);
  assert.equal(e.recebido_em, null);
  assert.equal(e.classificacao, 'no_prazo');
  await como(U.nathaly, 'SELECT exame_receber($1)', [b]);
  assert.equal((await exame(b)).aguardando_comunicacao, true);
});

// ---------------------------------------------------------------- 11, 12, 13
test('11/12/13. Laudos parciais, retorno clínico com exames pendentes e liberação do retorno de exames', async () => {
  const p = await novoPaciente('mel13');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-06', [
    { tipo_exame_id: T.hemo, laboratorio_id: L.A }, { tipo_exame_id: T.us, laboratorio_id: L.V }, { tipo_exame_id: T.eco, laboratorio_id: L.V }]);
  const [hemo, us, eco] = r.exames;
  await como(U.nathaly, 'SELECT exame_receber($1)', [hemo]);
  await como(U.juliana, 'SELECT exame_receber($1)', [us]);
  let rets = await retornosDe(p.animalId);
  assert.equal(rets.length, 1, 'retorno de exames ainda não liberado');
  assert.equal(rets[0].tipo, 'clinico');
  assert.equal(rets[0].exames_pendentes, 1, 'retorno clínico com aviso de exames pendentes');
  assert.equal(rets[0].exames_pendentes_nomes, 'Ecocardiograma');
  // Paciente aparece nos dois módulos
  const pend = await como(U.nathaly, "SELECT * FROM v_exames WHERE animal_id = $1 AND recebido_em IS NULL", [p.animalId]);
  assert.equal(pend.length, 1);
  // Último laudo chega → cria UMA pendência de retorno de exames (sem exigir comunicação ao tutor)
  await como(U.nathaly, 'SELECT exame_receber($1)', [eco]);
  rets = await retornosDe(p.animalId);
  const rx = rets.filter((x) => x.tipo === 'exames');
  assert.equal(rx.length, 1);
  assert.equal(rx[0].status, 'aguardando_agendamento');
  assert.equal(rx[0].data_prevista, '2026-11-06');
  assert.equal(rx[0].classificacao, 'hoje');
  // Desfazer/refazer recebimento não duplica
  await como(U.nathaly, 'SELECT exame_desfazer_recebimento($1)', [eco]);
  await como(U.nathaly, 'SELECT exame_receber($1)', [eco]);
  assert.equal((await retornosDe(p.animalId)).filter((x) => x.tipo === 'exames').length, 1);
  // Agendar e registrar comparecimento
  const ret = rx[0];
  await como(U.juliana, "SELECT retorno_acao($1, 'agendar', $2)", [ret.id, { data_consulta: '2026-11-12', hora_consulta: '14:30' }]);
  let atual = (await retornosDe(p.animalId)).find((x) => x.id === ret.id);
  assert.equal(atual.status, 'agendado');
  assert.equal(atual.data_consulta, '2026-11-12');
  assert.ok(atual.data_agendamento);
  assert.equal(atual.classificacao, 'proximo', 'futuro não é pendência urgente');
  await como(U.nathaly, "SELECT retorno_acao($1, 'realizado', '{}')", [ret.id], '2026-11-12');
  atual = (await retornosDe(p.animalId, '2026-11-12')).find((x) => x.id === ret.id);
  assert.equal(atual.status, 'realizado');
  assert.equal(atual.data_realizado, '2026-11-12');
});

test('12b. Não cria retorno de exames quando já existe retorno clínico compatível agendado', async () => {
  const p = await novoPaciente('compat');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }]);
  const clin = (await retornosDe(p.animalId))[0];
  await como(U.nathaly, "SELECT retorno_acao($1, 'agendar', $2)", [clin.id, { data_consulta: '2026-11-20' }]);
  await como(U.nathaly, 'SELECT exame_receber($1)', [r.exames[0]], '2026-11-09');
  const rets = await retornosDe(p.animalId, '2026-11-09');
  assert.equal(rets.filter((x) => x.tipo === 'exames').length, 0);
  const h = await histDe(p.animalId);
  assert.ok(h.some((x) => x.acao === 'retorno_exames_compativel'));
});

// ---------------------------------------------------------------- 14, 15, 16
test('14/15. Paciente internado com exame atrasado; alta com necessidade de retorno', async () => {
  const p = await novoPaciente('int1');
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-03', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }], {}, '2026-11-03');
  const id = r.exames[0];
  await como(U.juliana, 'SELECT internar($1)', [p.animalId], '2026-11-06');
  let a = await um(U.nathaly, 'SELECT * FROM animais WHERE id = $1', [p.animalId]);
  assert.equal(a.internado, true);
  // Exames continuam: atrasado, cobrável, recebível, comunicável pela internação
  let e = await exame(id);
  assert.equal(e.classificacao, 'atrasado');
  assert.equal(e.internado, true);
  assert.equal(e.precisa_cobranca, true);
  await como(U.nathaly, 'SELECT exame_cobrar($1)', [id]);
  // Retorno ambulatorial suspenso (sem alerta)
  let rets = await retornosDe(p.animalId);
  assert.equal(rets[0].status, 'suspenso_internacao');
  assert.equal(rets[0].classificacao, 'suspenso');
  await assert.rejects(como(U.nathaly, "SELECT retorno_acao($1, 'agendar', $2)", [rets[0].id, { data_consulta: '2026-11-10' }]), /suspenso/);
  // Laudo chega durante a internação → retorno de exames criado já suspenso
  await como(U.nathaly, 'SELECT exame_receber($1)', [id], '2026-11-07');
  await como(U.nathaly, "SELECT exame_comunicar($1, 'internacao')", [id], '2026-11-07');
  rets = await retornosDe(p.animalId, '2026-11-07');
  assert.equal(rets.length, 2);
  assert.ok(rets.every((x) => x.status === 'suspenso_internacao'));
  const lista = await como(U.nathaly, 'SELECT * FROM v_internacoes WHERE alta IS NULL AND animal_id = $1', [p.animalId]);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].iniciada_por_nome, 'Juliana Lima');
  // Alta exige resposta
  await assert.rejects(como(U.nathaly, 'SELECT dar_alta($1, NULL)', [p.animalId], '2026-11-10'), /precisará de retorno/);
  const res = (await um(U.nathaly, "SELECT dar_alta($1, true, '2026-11-17') AS r", [p.animalId], '2026-11-10')).r;
  assert.equal(res.reativados, 2);
  assert.equal(res.criado, null, 'reativa em vez de duplicar');
  rets = await retornosDe(p.animalId, '2026-11-10');
  assert.equal(rets.length, 2);
  assert.ok(rets.every((x) => x.status === 'aguardando_agendamento' && x.data_prevista === '2026-11-17'));
  assert.ok(rets.every((x) => x.classificacao === 'proximo'));
  const i = await um(U.nathaly, 'SELECT * FROM v_internacoes WHERE animal_id = $1', [p.animalId]);
  assert.equal(i.alta_por_nome, 'Nathaly Souza');
  assert.equal(i.precisa_retorno, true);
  a = await um(U.nathaly, 'SELECT * FROM animais WHERE id = $1', [p.animalId]);
  assert.equal(a.internado, false);
  await assert.rejects(como(U.nathaly, "SELECT dar_alta($1, false)", [p.animalId], '2026-11-10'), /não está internado/);
});

test('15b. Alta com retorno sem retornos suspensos cria um único retorno pós-alta', async () => {
  const p = await novoPaciente('int2');
  await como(U.nathaly, 'SELECT internar($1)', [p.animalId]);
  const res = (await um(U.nathaly, "SELECT dar_alta($1, true, '2026-11-20') AS r", [p.animalId], '2026-11-09')).r;
  assert.ok(res.criado);
  const rets = await retornosDe(p.animalId, '2026-11-09');
  assert.equal(rets.length, 1);
  assert.equal(rets[0].tipo, 'pos_alta');
  assert.equal(rets[0].data_prevista, '2026-11-20');
});

test('16. Alta hospitalar sem necessidade de retorno', async () => {
  const p = await novoPaciente('int3');
  await como(U.nathaly, 'SELECT criar_atendimento($1)', [{ animal_id: p.animalId, data: '2026-11-04' }]);
  await como(U.nathaly, 'SELECT internar($1)', [p.animalId]);
  const res = (await um(U.juliana, 'SELECT dar_alta($1, false) AS r', [p.animalId], '2026-11-09')).r;
  assert.equal(res.dispensados, 1);
  const rets = await retornosDe(p.animalId, '2026-11-09');
  assert.equal(rets.length, 1);
  assert.equal(rets[0].status, 'dispensado');
  assert.equal(rets[0].motivo, 'Dispensado após alta hospitalar');
  const h = await histDe(p.animalId);
  assert.ok(h.some((x) => x.acao === 'retorno_dispensado' && x.usuario_nome === 'Juliana Lima'));
  // Histórico da internação permanece
  assert.equal((await sistema('SELECT * FROM internacoes WHERE animal_id = $1', [p.animalId])).length, 1);
});

// ---------------------------------------------------------------- 17
test('17. Tutor com vários animais e atendimentos diferentes (sem agrupamento indevido)', async () => {
  const t = await um(U.nathaly, 'SELECT salvar_tutor($1) AS id', [{ id_externo: '2002', nome: 'Carlos Pereira', telefone: '(11) 97777-1111' }]);
  const bob = (await um(U.nathaly, 'SELECT salvar_animal($1) AS id', [{ id_externo: '6001', nome: 'Bob', especie: 'Canina', tutor_id: t.id }])).id;
  const nina = (await um(U.nathaly, 'SELECT salvar_animal($1) AS id', [{ id_externo: '6002', nome: 'Nina', especie: 'Felina', tutor_id: t.id }])).id;
  const r1 = await cadastrar(U.nathaly, bob, '2026-11-05', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }], {}, '2026-11-06');
  const r2 = await cadastrar(U.nathaly, nina, '2026-11-05', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }], {}, '2026-11-06');
  const r3 = await cadastrar(U.nathaly, bob, '2026-11-06', [{ tipo_exame_id: T.bio, laboratorio_id: L.B }]);
  assert.notEqual(r1.atendimento_id, r2.atendimento_id, 'animais diferentes');
  assert.notEqual(r1.atendimento_id, r3.atendimento_id, 'datas diferentes');
  // Mesmo dia, mas outro atendimento explicitamente
  const r4 = await cadastrar(U.nathaly, bob, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }], { atendimento: 'novo', gerar_retorno: false });
  assert.notEqual(r4.atendimento_id, r3.atendimento_id);
  // Vincular manualmente exame de outra data ao mesmo acompanhamento
  await como(U.nathaly, 'SELECT exame_vincular($1, $2)', [r3.exames[0], r1.atendimento_id]);
  assert.equal((await exame(r3.exames[0])).atendimento_id, r1.atendimento_id);
  await assert.rejects(como(U.nathaly, 'SELECT exame_vincular($1, $2)', [r3.exames[0], r2.atendimento_id]), /mesmo paciente/);
  // Retorno de exames de Bob não é liberado por laudos de Nina
  await como(U.nathaly, 'SELECT exame_receber($1)', [r2.exames[0]]);
  assert.equal((await retornosDe(bob)).filter((x) => x.tipo === 'exames').length, 0);
  assert.equal((await retornosDe(nina)).filter((x) => x.tipo === 'exames').length, 1);
});

// ---------------------------------------------------------------- 18, 19, 20
test('18. Criação de usuário pela administração', async () => {
  const id = crypto.randomUUID();
  await sistema('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, 'paula@teste.local']);
  await como(U.gestora, "SELECT admin_criar_perfil($1, 'Paula Recepção', 'paula', 'recepcao')", [id]);
  let p = await um(U.gestora, 'SELECT * FROM perfis WHERE id = $1', [id]);
  assert.equal(p.situacao, 'pendente');
  // Pendente ainda não acessa dados
  await assert.rejects(como({ id }, 'SELECT painel_contadores()'), /Sessão inválida/);
  // Define a senha pelo link → conta ativa
  await como({ id }, 'SELECT ativar_minha_conta()');
  p = await um(U.gestora, 'SELECT * FROM perfis WHERE id = $1', [id]);
  assert.equal(p.situacao, 'ativo');
  assert.ok(await um({ id }, 'SELECT painel_contadores() AS p'));
  // Recepção não cria usuários; login duplicado recusado
  const id2 = crypto.randomUUID();
  await sistema('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id2, 'x@teste.local']);
  await assert.rejects(como(U.nathaly, "SELECT admin_criar_perfil($1, 'Intrusa', 'intrusa', 'admin')", [id2]), /restrito aos administradores/);
  await assert.rejects(como(U.gestora, "SELECT admin_criar_perfil($1, 'Outra Paula', 'paula', 'recepcao')", [id2]), /já está em uso/);
  // Recepção não consegue se promover
  await assert.rejects(como({ id }, "UPDATE perfis SET perfil = 'admin' WHERE id = $1", [id]));
  U.paula = { id, nome: 'Paula Recepção' };
});

test('19. Bloqueio e desativação de usuário desligado, sem perder histórico', async () => {
  const p = await novoPaciente('paulah');
  await como(U.paula, 'SELECT criar_atendimento($1)', [{ animal_id: p.animalId, data: '2026-11-06' }]);
  const antes = await sistema("SELECT count(*)::int n FROM historico WHERE usuario_id = $1", [U.paula.id]);
  await como(U.gestora, "SELECT admin_alterar_usuario($1, '{\"situacao\":\"bloqueado\"}')", [U.paula.id]);
  await assert.rejects(como(U.paula, 'SELECT painel_contadores()'), /bloqueado|Sessão inválida/);
  assert.equal((await como(U.paula, 'SELECT * FROM tutores')).length, 0, 'RLS: bloqueada não lê dados');
  await assert.rejects(como(U.paula, 'SELECT registrar_acesso()'), /bloqueado/);
  await como(U.gestora, "SELECT admin_alterar_usuario($1, '{\"situacao\":\"inativo\"}')", [U.paula.id]);
  const depois = await sistema("SELECT count(*)::int n FROM historico WHERE usuario_id = $1", [U.paula.id]);
  assert.equal(depois[0].n, antes[0].n, 'histórico da funcionária preservado');
  const evt = await sistema("SELECT * FROM historico WHERE acao IN ('usuario_bloqueado','usuario_desativado') ORDER BY id");
  assert.equal(evt.length, 2);
  assert.ok(evt.every((x) => x.usuario_nome === 'Bruna Gestora'));
  // Reativar
  await como(U.gestora, "SELECT admin_alterar_usuario($1, '{\"situacao\":\"ativo\"}')", [U.paula.id]);
  assert.ok(await um(U.paula, 'SELECT painel_contadores() AS p'));
  // Não pode remover o último administrador nem se bloquear
  await assert.rejects(como(U.gestora, "SELECT admin_alterar_usuario($1, '{\"situacao\":\"bloqueado\"}')", [U.gestora.id]), /próprio acesso/);
  await assert.rejects(como(U.gestora, "SELECT admin_alterar_usuario($1, '{\"perfil\":\"recepcao\"}')", [U.gestora.id]), /pelo menos um administrador/);
  await assert.rejects(sistema('DELETE FROM perfis WHERE id = $1', [U.paula.id]), /Exclusão não permitida/);
});

test('20. Funcionária tentando acessar configurações proibidas (bloqueado no banco)', async () => {
  await assert.rejects(como(U.nathaly, 'INSERT INTO prazos (tipo_exame_id, laboratorio_id, dias_uteis) VALUES ($1, $2, 5)', [T.histo, L.B]));
  // UPDATE direto: a RLS não deixa a recepção alcançar nenhuma linha
  assert.equal((await como(U.nathaly, 'UPDATE prazos SET dias_uteis = 0 RETURNING id')).length, 0);
  assert.equal((await sistema('SELECT count(*)::int n FROM prazos WHERE dias_uteis = 0'))[0].n, 1, 'só o prazo zero original');
  assert.equal((await como(U.nathaly, "UPDATE configuracoes SET valor = '1' RETURNING chave")).length, 0);
  assert.equal((await sistema("SELECT valor FROM configuracoes WHERE chave = 'retorno_clinico_dias'"))[0].valor, 15);
  await assert.rejects(como(U.nathaly, "INSERT INTO feriados VALUES ('2026-12-24', 'Véspera')"));
  await assert.rejects(como(U.nathaly, "INSERT INTO laboratorios (nome) VALUES ('Lab pirata')"));
  await assert.rejects(como(U.nathaly, 'SELECT relatorio_gerencial($1, $2)', ['2026-11-01', '2026-11-30']), /restrito/);
  // Recepção não altera previsão nem grava direto nas tabelas operacionais
  const ex = (await como(U.nathaly, 'SELECT id, versao FROM exames LIMIT 1'))[0];
  await assert.rejects(como(U.nathaly, "SELECT exame_corrigir($1, '{\"data_prevista\":\"2026-12-31\"}')", [ex.id]), /Somente administradores/);
  await assert.rejects(como(U.nathaly, "UPDATE exames SET data_prevista = '2026-12-31' WHERE id = $1", [ex.id]));
  await assert.rejects(como(U.nathaly, "INSERT INTO historico (usuario_nome, acao, descricao) VALUES ('Fake', 'x', 'x')"));
  // Ninguém apaga ou edita o histórico — nem a chave de serviço
  await assert.rejects(sistema("UPDATE historico SET descricao = 'apagado'"), /não pode ser alterado/);
  await assert.rejects(sistema('DELETE FROM historico'), /não pode ser alterado/);
  await assert.rejects(sistema('DELETE FROM exames WHERE id = $1', [ex.id]), /Exclusão não permitida/);
  // Visitante sem login não lê nada
  await assert.rejects(como(null, 'SELECT * FROM tutores'));
  // Administradora pode alterar; mudança NÃO é retroativa e fica registrada
  const antes = (await exame(ex.id)).data_prevista;
  await como(U.gestora, 'UPDATE prazos SET dias_uteis = 10 WHERE tipo_exame_id = $1 AND laboratorio_id = $2', [T.hemo, L.A]);
  assert.equal((await exame(ex.id)).data_prevista, antes, 'previsão original preservada');
  const h = await sistema("SELECT * FROM historico WHERE acao = 'configuracao_alterada' AND entidade = 'prazos' ORDER BY id DESC LIMIT 1");
  assert.equal(h[0].usuario_nome, 'Bruna Gestora');
  assert.equal(h[0].antes.dias_uteis, 1);
  assert.equal(h[0].depois.dias_uteis, 10);
  await como(U.gestora, 'UPDATE prazos SET dias_uteis = 1 WHERE tipo_exame_id = $1 AND laboratorio_id = $2', [T.hemo, L.A]);
  // Correção administrativa gera nova entrada no histórico
  await como(U.gestora, "SELECT exame_corrigir($1, '{\"data_prevista\":\"2026-12-01\"}')", [ex.id]);
  const c = await sistema("SELECT * FROM historico WHERE acao = 'correcao_administrativa' AND entidade_id = $1", [ex.id]);
  assert.equal(c.length, 1);
  assert.equal(c[0].depois.data_prevista, '2026-12-01');
});

// ---------------------------------------------------------------- 21
test('21. Registro correto do nome, data e horário de cada alteração', async () => {
  const p = await novoPaciente('audit');
  const inicio = new Date(Date.now() - 1000);
  const r = await cadastrar(U.nathaly, p.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }]);
  await como(U.juliana, 'SELECT exame_receber($1)', [r.exames[0]]);
  await como(U.nathaly, "SELECT exame_comunicar($1, 'tutor')", [r.exames[0]]);
  await como(U.juliana, 'SELECT salvar_tutor($1)', [{ id: p.tutorId, id_externo: 'Taudit', nome: 'Tutor Auditado', telefone: '(11) 91234-5678', versao: 1 }]);
  const h = await sistema('SELECT * FROM historico WHERE animal_id = $1 OR (tutor_id = $2 AND entidade = $3) ORDER BY id', [p.animalId, p.tutorId, 'tutor']);
  const acoes = h.map((x) => [x.acao, x.usuario_nome]);
  for (const esperado of [['exame_cadastrado', 'Nathaly Souza'], ['laudo_recebido', 'Juliana Lima'], ['resultado_enviado_tutor', 'Nathaly Souza'], ['tutor_alterado', 'Juliana Lima']]) {
    assert.ok(acoes.some((a) => a[0] === esperado[0] && a[1] === esperado[1]), `histórico deve conter ${esperado}`);
  }
  for (const x of h) {
    assert.ok(x.usuario_id, 'identificador interno do usuário');
    assert.ok(new Date(x.ocorrido_em) >= inicio && new Date(x.ocorrido_em) <= new Date(Date.now() + 1000), 'horário do servidor');
  }
  const alt = h.find((x) => x.acao === 'tutor_alterado');
  assert.equal(alt.antes.nome, 'Tutor audit');
  assert.equal(alt.depois.nome, 'Tutor Auditado');
  // Não há como informar outro nome: o banco usa o login
  const outro = h.find((x) => x.acao === 'laudo_recebido');
  assert.equal(outro.usuario_id, U.juliana.id);
  // Conflito de edição simultânea do mesmo cadastro (versão desatualizada)
  await assert.rejects(como(U.nathaly, 'SELECT salvar_tutor($1)', [{ id: p.tutorId, id_externo: 'Taudit', nome: 'Outro Nome', versao: 1 }]), (e) => e.code === 'PAV01' && /Juliana Lima/.test(e.message));
});

// ---------------------------------------------------------------- 22
test('22. Duas funcionárias usando o sistema simultaneamente', async () => {
  const p = await novoPaciente('simult');
  // Cadastro simultâneo de exames do mesmo animal e data → um único acompanhamento
  const [a, b] = await Promise.all([
    cadastrar(U.nathaly, p.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }]),
    cadastrar(U.juliana, p.animalId, '2026-11-06', [{ tipo_exame_id: T.us, laboratorio_id: L.V }]),
  ]);
  assert.equal(a.atendimento_id, b.atendimento_id);
  assert.equal((await retornosDe(p.animalId)).filter((x) => x.tipo === 'clinico').length, 1);
  // As duas marcam o mesmo laudo ao mesmo tempo → apenas uma gravação
  const res = await Promise.allSettled([
    como(U.nathaly, 'SELECT exame_receber($1)', [a.exames[0]]),
    como(U.juliana, 'SELECT exame_receber($1)', [a.exames[0]]),
  ]);
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.match(res.find((x) => x.status === 'rejected').reason.message, /já registrado como recebido/);
  // Cada uma recebe o último laudo de exames diferentes do mesmo grupo ao mesmo tempo → retorno de exames criado uma única vez
  const p2 = await novoPaciente('simult2');
  const g = await cadastrar(U.nathaly, p2.animalId, '2026-11-06', [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }, { tipo_exame_id: T.us, laboratorio_id: L.V }]);
  await Promise.all([
    como(U.nathaly, 'SELECT exame_receber($1)', [g.exames[0]]),
    como(U.juliana, 'SELECT exame_receber($1)', [g.exames[1]]),
  ]);
  assert.equal((await retornosDe(p2.animalId)).filter((x) => x.tipo === 'exames').length, 1);
});

// ---------------------------------------------------------------- 23
test('23. Prevenção de duplicidades em retornos e acompanhamentos', async () => {
  const p = await novoPaciente('dup');
  const at = (await um(U.nathaly, 'SELECT criar_atendimento($1) AS id', [{ animal_id: p.animalId, data: '2026-11-06' }])).id;
  await assert.rejects(como(U.juliana, 'SELECT criar_atendimento($1)', [{ animal_id: p.animalId, data: '2026-11-06' }]), (e) => e.code === 'PAD01');
  await assert.rejects(como(U.juliana, 'SELECT retorno_criar($1)', [{ atendimento_id: at, data_prevista: '2026-11-30' }]), /já possui retorno clínico/);
  await assert.rejects(sistema("INSERT INTO retornos (atendimento_id, animal_id, tipo, data_prevista) VALUES ($1, $2, 'clinico', '2026-12-01')", [at, p.animalId]), /retornos_atend_tipo_uk/);
  // Confirmação explícita permite um segundo acompanhamento no mesmo dia (caso real)
  const at2 = (await um(U.juliana, 'SELECT criar_atendimento($1) AS id', [{ animal_id: p.animalId, data: '2026-11-06', confirmar: true, gerar_retorno: false }])).id;
  assert.notEqual(at, at2);
  await como(U.nathaly, 'SELECT internar($1)', [p.animalId]);
  await assert.rejects(como(U.juliana, 'SELECT internar($1)', [p.animalId]), /já está internado/);
  // Painel não conta suspensos como pendência urgente
  const painel = (await um(U.nathaly, 'SELECT painel_contadores() AS p')).p;
  assert.ok(painel.retornos.suspensos >= 1);
});

// ---------------------------------------------------------------- 24
test('24. Persistência dos dados após encerrar a sessão e acessar novamente', async () => {
  const p = await novoPaciente('persist');
  await cadastrar(U.nathaly, p.animalId, '2026-11-06', [{ tipo_exame_id: T.histo, laboratorio_id: L.A }]);
  // "Sai" (encerra todas as conexões) e "entra" novamente em outra conexão
  const novo = new Pool({ ...conn, database: DB, max: 2 });
  const c = await novo.connect();
  await c.query('BEGIN');
  await c.query("SELECT set_config('role', 'authenticated', true), set_config('request.jwt.claim.sub', $1, true)", [U.juliana.id]);
  const rows = (await c.query('SELECT * FROM v_exames WHERE animal_id = $1', [p.animalId])).rows;
  await c.query('COMMIT');
  c.release();
  await novo.end();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tipo_nome, 'Histopatológico');
  assert.equal(rows[0].criado_por_nome, 'Nathaly Souza');
});

// ---------------------------------------------------------------- extra
test('Relatório gerencial usa os dados reais do banco', async () => {
  const rel = (await um(U.gestora, "SELECT relatorio_gerencial('2026-11-01', '2026-11-30') AS r", [], '2026-11-10')).r;
  const total = (await sistema("SELECT count(*)::int n FROM exames WHERE situacao = 'ativo' AND data_realizacao BETWEEN '2026-11-01' AND '2026-11-30'"))[0].n;
  assert.equal(rel.exames.total, total);
  assert.ok(rel.exames.por_laboratorio.length >= 2);
  assert.ok(rel.exames.cobrancas >= 3);
  assert.ok(rel.retornos.previstos >= 1);
  assert.ok(rel.retornos.dispensados >= 1);
});

// ---------------------------------------------------------------- cadastro em uma tela
test('Novo atendimento em uma tela: tutor+animal novos com exames, e sem exame com retorno', async () => {
  const comExame = (await um(U.nathaly, 'SELECT registrar_atendimento_completo($1) AS r', [{
    tutor: { id_externo: 'W100', nome: 'Wizard Tutora', telefone: '(11) 95555-0000' },
    animal: { id_externo: 'WA100', nome: 'Luna', especie: 'Felina' },
    data: '2026-11-06', com_exame: true,
    itens: [{ tipo_exame_id: T.hemo, laboratorio_id: L.A }, { tipo_exame_id: T.us, laboratorio_id: L.V }],
  }])).r;
  assert.equal(comExame.exames.length, 2);
  assert.equal((await retornosDe(comExame.animal_id)).length, 0, 'com exame: sem retorno clínico automático (vem o de avaliação)');
  // Mesmo tutor, outro animal, sem exame → retorno obrigatório
  await assert.rejects(como(U.nathaly, 'SELECT registrar_atendimento_completo($1)', [{ tutor: { id: comExame.tutor_id }, animal: { id_externo: 'WA101', nome: 'Sol', especie: 'Canina' }, data: '2026-11-06', com_exame: false }]), /data prevista do retorno/);
  const sem = (await um(U.nathaly, 'SELECT registrar_atendimento_completo($1) AS r', [{
    tutor: { id: comExame.tutor_id }, animal: { id_externo: 'WA101', nome: 'Sol', especie: 'Canina' },
    data: '2026-11-06', com_exame: false, data_retorno: '2026-11-20' }])).r;
  const rets = await retornosDe(sem.animal_id);
  assert.equal(rets.length, 1);
  assert.equal(rets[0].data_prevista, '2026-11-20');
  // Falha no meio (exame sem prazo) não deixa tutor/animal gravados pela metade
  await assert.rejects(como(U.nathaly, 'SELECT registrar_atendimento_completo($1)', [{
    tutor: { id_externo: 'W200', nome: 'Meio Gravado' }, animal: { id_externo: 'WA200', nome: 'Nada', especie: 'Canina' },
    data: '2026-11-06', com_exame: true, itens: [{ tipo_exame_id: T.histo, laboratorio_id: L.V }] }]), /Não há prazo configurado/);
  assert.equal((await sistema("SELECT count(*)::int n FROM tutores WHERE id_externo = 'W200'"))[0].n, 0);
  // Animal de outro tutor é recusado
  await assert.rejects(como(U.nathaly, 'SELECT registrar_atendimento_completo($1)', [{ tutor: { id: comExame.tutor_id }, animal: { id: 1 }, com_exame: false, data_retorno: '2026-11-30', data: '2026-11-06' }]), /não pertence a este tutor/);
});
