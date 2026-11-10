'use strict';
// Teste de interface no navegador (Chrome headless) contra o ambiente local (PostgREST + banco real).
// Uso: node test/e2e/interface.e2e.js  (com servidor-local.js rodando)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:4321';
const SAIDA = process.env.SAIDA || path.join(__dirname, 'capturas');
fs.mkdirSync(SAIDA, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let passo = 0;
const erros = [];

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=pt-BR'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 860 });
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/realtime|websocket|fonts\.g|ERR_|404/i.test(m.text())) erros.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const falhasHttp = [];
  page.on('response', async (r) => { if (r.status() >= 400 && r.url().includes('/rest/')) falhasHttp.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} → ${(await r.text().catch(() => '')).slice(0, 160)}`); });

  const foto = async (nome) => { passo += 1; await espera(350); await page.screenshot({ path: path.join(SAIDA, `${String(passo).padStart(2, '0')}_${nome}.png`), fullPage: true }); };
  const texto = () => page.evaluate(() => document.body.innerText);
  const deveConter = async (t, ctx) => {
    for (let i = 0; i < 30; i++) { if ((await texto()).includes(t)) return; await espera(200); }
    throw new Error(`[${ctx}] texto esperado não apareceu: "${t}"`);
  };
  const clicarTexto = async (t, seletor = 'button, a') => {
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate((t, s) => {
        const el = [...document.querySelectorAll(s)].reverse().find((e) => e.offsetParent !== null && e.textContent.trim() === t && !e.disabled);
        if (el) { el.click(); return true; } return false;
      }, t, seletor);
      if (ok) { await espera(300); return; }
      await espera(200);
    }
    throw new Error(`botão não encontrado: "${t}"`);
  };
  const preencher = async (seletor, valor) => { await page.waitForSelector(seletor, { visible: true }); await page.$eval(seletor, (el) => { el.value = ''; }); await page.type(seletor, valor); };
  const escolher = async (seletor, textoOpcao) => {
    await page.waitForSelector(seletor, { visible: true });
    await page.$eval(seletor, (el, t) => { const o = [...el.options].find((x) => x.textContent.includes(t)); if (!o) throw new Error('opção ' + t); el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); }, textoOpcao);
  };
  const modalSalvar = async (rotulo = 'Salvar') => { await clicarTexto(rotulo, '.modal .rodape button'); await espera(700); };
  const entrar = async (login, senha) => {
    await page.goto(BASE + '/#/painel', { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[autocomplete=username]');
    await page.type('input[autocomplete=username]', login);
    await page.type('input[autocomplete=current-password]', senha);
    await page.click('button[type=submit]');
    await deveConter('Central da Recepção', 'login');
    await page.waitForSelector('.grade-ind');
  };
  const sair = async () => { await clicarTexto('Sair'); await page.waitForSelector('input[autocomplete=username]'); };

  try {
    // ---------------- Login com senha errada
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[autocomplete=username]');
    await foto('tela_login');
    await page.type('input[autocomplete=username]', 'nathaly');
    await page.type('input[autocomplete=current-password]', 'errada');
    await page.click('button[type=submit]');
    await deveConter('Login ou senha incorretos', 'senha errada');

    // ---------------- Gestora configura laboratórios, exames, prazos e feriados
    await entrar('bruna', 'Gestora123');
    await deveConter('Usuário: Bruna', 'identificação do usuário');
    await page.goto(BASE + '/#/config?aba=labs'); await espera(600);
    for (const nome of ['Laboratório A', 'Laboratório B']) {
      await clicarTexto('+ Novo'); await preencher('.modal input[name=nome]', nome); await modalSalvar();
      await deveConter(nome, 'lab');
    }
    await clicarTexto('Tipos de exame');
    for (const nome of ['Hemograma', 'Ultrassom', 'Ecocardiograma']) {
      await clicarTexto('+ Novo tipo'); await preencher('.modal input[name=nome]', nome); await modalSalvar();
      await deveConter(nome, 'tipo');
    }
    await clicarTexto('Prazos de exames');
    for (const [tipo, lab, dias] of [['Hemograma', 'Laboratório A', '1'], ['Ultrassom', 'Laboratório B', '0'], ['Ecocardiograma', 'Laboratório B', '3']]) {
      await clicarTexto('+ Novo prazo');
      await escolher('.modal select[name=tipo]', tipo); await escolher('.modal select[name=lab]', lab); await preencher('.modal input[name=dias]', dias);
      await modalSalvar();
    }
    await deveConter('3 dia(s) útil(eis)', 'prazos');
    await foto('configuracoes_prazos');
    await clicarTexto('Feriados');
    await clicarTexto('Adicionar feriados nacionais de 2026');
    await modalSalvar('Adicionar');
    await deveConter('Dia Nacional de Zumbi', 'feriados');
    await foto('configuracoes_feriados');
    await page.goto(BASE + '/#/usuarios'); await deveConter('Gestão de Usuários', 'usuarios');
    await deveConter('Nathaly Souza', 'lista usuarios');
    await foto('gestao_usuarios');
    await sair();

    // ---------------- Recepção: cadastro de tutor e dois animais
    await entrar('nathaly', 'Nathaly123');
    await foto('painel_vazio');
    await page.goto(BASE + '/#/pacientes'); await espera(500);
    await clicarTexto('+ Novo tutor');
    await preencher('.modal input[name=id_externo]', '1001');
    await preencher('.modal input[name=nome]', 'Maria Oliveira');
    await preencher('.modal input[name=telefone]', '(11) 98888-7777');
    await modalSalvar();
    await page.type('.busca-grande input', 'Maria'); await deveConter('Maria Oliveira', 'busca tutor');
    await clicarTexto('+ Animal');
    await preencher('.modal input[name=id_externo]', '5001'); await preencher('.modal input[name=nome]', 'Mel'); await preencher('.modal input[name=especie]', 'Canina');
    await modalSalvar();
    await deveConter('Acompanhamentos, exames e retornos', 'ficha da Mel');
    // Tentativa de duplicar o ID do tutor
    await page.goto(BASE + '/#/pacientes'); await espera(400);
    await clicarTexto('+ Novo tutor');
    await preencher('.modal input[name=id_externo]', '1001'); await preencher('.modal input[name=nome]', 'Outra Pessoa');
    await modalSalvar();
    await deveConter('Já existe um tutor com o ID 1001', 'duplicidade');
    await clicarTexto('Cancelar', '.modal button');

    // ---------------- Cadastro de três exames no mesmo formulário (a partir da ficha)
    await page.type('.busca-grande input', 'Mel'); await deveConter('Mel', 'busca animal');
    await clicarTexto('🐾 MelCanina · ID 5001', '.chip-animal').catch(async () => { await page.click('.chip-animal'); });
    await deveConter('Cadastrar exames', 'ficha');
    await clicarTexto('+ Cadastrar exames');
    await page.waitForSelector('.modal .linha-exame select');
    const linha = async (i, tipo, lab) => {
      await escolher(`.modal .linha-exame:nth-child(${i}) select`, tipo);
      await espera(200);
      await escolher(`.modal .linha-exame:nth-child(${i}) select:nth-of-type(1) ~ *`, '').catch(() => {});
      await page.$$eval('.modal .linha-exame', (els, i, lab) => {
        const s = els[i - 1].querySelectorAll('select')[1]; const o = [...s.options].find((x) => x.textContent.includes(lab));
        s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
      }, i, lab);
    };
    await linha(1, 'Hemograma', 'Laboratório A');
    await clicarTexto('+ Adicionar outro exame'); await linha(2, 'Ultrassom', 'Laboratório B');
    await clicarTexto('+ Adicionar outro exame'); await linha(3, 'Ecocardiograma', 'Laboratório B');
    await espera(600);
    await deveConter('Previsão: 09/11/2026', 'previsão hemograma (sexta → segunda)');
    await foto('cadastro_exames');
    await modalSalvar('Cadastrar exames');
    await deveConter('0 de 3 laudos recebidos', 'agrupamento');
    await deveConter('Retorno clínico', 'retorno clínico automático');
    await foto('ficha_apos_cadastro');

    // ---------------- Laudos: recebe 2 de 3 → retorno de exames NÃO liberado
    await clicarTexto('Laudo recebido');
    await deveConter('1 de 3 laudos recebidos', 'recebe 1');
    await clicarTexto('Laudo recebido');
    await deveConter('2 de 3 laudos recebidos', 'recebe 2');
    await deveConter('Exames pendentes: Hemograma', 'aviso exames pendentes');
    if ((await texto()).includes('Avaliação de exames')) throw new Error('retorno de exames liberado antes da hora');
    await clicarTexto('Enviado ao tutor');
    await deveConter('Enviado ao tutor', 'comunicação');
    await clicarTexto('Laudo recebido');
    await deveConter('3 de 3 laudos recebidos', 'recebe 3');
    await deveConter('Avaliação de exames', 'retorno de exames liberado');
    await deveConter('Nathaly Souza — Registrou o recebimento do laudo', 'histórico na ficha');
    await foto('ficha_laudos_recebidos');

    // ---------------- Agendar retorno de exames
    await page.$$eval('.acomp tr', (trs) => { const tr = trs.find((t) => t.textContent.includes('Avaliação de exames')); [...tr.querySelectorAll('button')].find((b) => b.textContent === 'Agendar').click(); });
    await espera(400);
    await preencher('.modal input[name=hora]', '1430');
    await modalSalvar('Confirmar agendamento');
    await deveConter('Retorno agendado', 'agendamento');

    // ---------------- Internação e alta
    await clicarTexto('🏥 Paciente internado');
    await modalSalvar('Ativar internação');
    await deveConter('Internado desde', 'internação');
    await deveConter('Suspenso por internação', 'retornos suspensos');
    await foto('ficha_internado');
    await page.goto(BASE + '/#/internados'); await deveConter('Mel', 'lista internados');
    await foto('internados');
    await clicarTexto('Registrar alta');
    await page.click('.modal input[value=sim]');
    await page.$eval('.modal input[type=date]', (el) => { el.value = '2026-11-20'; });
    await modalSalvar('Registrar alta');
    await deveConter('Nenhum paciente internado', 'alta');

    // ---------------- Dashboard, listas e filtros
    await page.goto(BASE + '/#/painel'); await page.waitForSelector('.grade-ind'); await espera(600);
    await foto('painel');
    await page.goto(BASE + '/#/retornos?g=proximo'); await deveConter('Próximos', 'retornos'); await espera(500);
    await foto('retornos_proximos');
    await page.goto(BASE + '/#/exames?f=todos'); await deveConter('Consultar todos', 'exames'); await espera(500);
    await deveConter('3 exame(s)', 'lista todos os exames');
    await foto('exames_consulta');
    await page.goto(BASE + '/#/historico'); await deveConter('Histórico de Atividades', 'histórico'); await espera(500);
    await deveConter('Internação ativada', 'histórico ações');
    await foto('historico');

    // ---------------- Permissão: recepção não acessa configurações
    await page.goto(BASE + '/#/config'); await deveConter('Acesso restrito aos administradores', 'bloqueio config');
    const temMenuGestao = await page.evaluate(() => [...document.querySelectorAll('.menu a')].some((a) => a.textContent.includes('Configurações')));
    if (temMenuGestao) throw new Error('menu de gestão visível para recepção');
    // E o banco recusa mesmo chamando a API diretamente pelo navegador:
    const tentativa = await page.evaluate(async () => {
      const { sb } = await import('/js/api.js');
      const r1 = await sb.from('prazos').update({ dias_uteis: 99 }).neq('id', 0).select();
      const r2 = await sb.rpc('relatorio_gerencial', { p_inicio: '2026-11-01', p_fim: '2026-11-30' });
      const r3 = await sb.from('historico').delete().neq('id', 0).select();
      return { alterados: (r1.data || []).length, erroRelatorio: r2.error && r2.error.message, apagados: (r3.data || []).length, erroDelete: r3.error && r3.error.message };
    });
    if (tentativa.alterados !== 0 || !tentativa.erroRelatorio || tentativa.apagados !== 0) throw new Error('permissão no banco falhou: ' + JSON.stringify(tentativa));
    console.log('Tentativa direta pela API (recepção):', JSON.stringify(tentativa));

    // ---------------- Celular
    await page.setViewport({ width: 390, height: 844, isMobile: true }); await espera(1500);
    await page.goto(BASE + '/#/painel'); await page.waitForSelector('.grade-ind'); await espera(600);
    await foto('celular_painel');
    await page.goto(BASE + '/#/exames?f=todos'); await espera(900);
    await foto('celular_exames');
    await page.setViewport({ width: 1366, height: 860 });
    await sair();

    // ---------------- Persistência: outra funcionária entra e vê tudo
    await entrar('juliana', 'Juliana123');
    await page.goto(BASE + '/#/pacientes?q=Mel'); await deveConter('Maria Oliveira', 'persistência');
    await page.goto(BASE + '/#/relatorios'); await deveConter('Acesso restrito', 'relatórios só admin');
    await sair();
    await entrar('bruna', 'Gestora123');
    await page.goto(BASE + '/#/relatorios'); await deveConter('Laboratórios — atrasos e tempo real de entrega', 'relatórios'); await espera(500);
    await foto('relatorios');

    console.log(`OK — ${passo} capturas salvas em ${SAIDA}`);
  } catch (e) {
    await foto('ERRO').catch(() => {});
    console.error('FALHA:', e.message);
    process.exitCode = 1;
  } finally {
    if (falhasHttp.length) console.log('Respostas de erro da API (esperadas nos testes de bloqueio/duplicidade):\n' + falhasHttp.join('\n'));
    const inesperados = erros.filter((e) => !/status of (400|403|409)/.test(e));
    if (inesperados.length) { console.error('Erros no navegador:\n' + inesperados.join('\n')); process.exitCode = 1; }
    await browser.close();
  }
})();
