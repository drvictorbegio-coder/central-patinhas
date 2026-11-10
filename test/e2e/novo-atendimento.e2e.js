'use strict';
// Teste no navegador do cadastro em uma tela (Novo atendimento). Requer servidor-local.js rodando.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4321';
const SAIDA = process.env.SAIDA || path.join(__dirname, 'capturas');
fs.mkdirSync(SAIDA, { recursive: true });
const VENDOR = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'vendor', 'supabase.js'));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  // O CDN não é acessível no ambiente de teste: serve a mesma biblioteca localmente
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) return r.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: VENDOR });
    if (/fonts\.g/.test(r.url())) return r.abort();
    r.continue();
  });
  const texto = () => page.evaluate(() => document.body.innerText);
  const deve = async (t) => { for (let i = 0; i < 40; i++) { if ((await texto()).includes(t)) return; await espera(150); } throw new Error('não apareceu: ' + t); };
  const clicar = async (t, sel = 'button, a') => {
    for (let i = 0; i < 40; i++) {
      const ok = await page.evaluate((t, s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent && x.textContent.trim().startsWith(t) && !x.disabled); if (e) { e.click(); return true; } return false; }, t, sel);
      if (ok) { await espera(250); return; } await espera(150);
    }
    throw new Error('botão não encontrado: ' + t);
  };
  const digitarNoCampo = async (rotulo, valor) => page.evaluate((rot, v) => {
    const c = [...document.querySelectorAll('.campo')].find((x) => x.offsetParent && x.querySelector('label')?.textContent.trim() === rot);
    const i = c.querySelector('input, select'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
  }, rotulo, valor);
  const foto = (n) => page.screenshot({ path: path.join(SAIDA, n + '.png'), fullPage: true });

  try {
    await page.goto(BASE + '/#/novo', { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[autocomplete=username]');
    await page.type('input[autocomplete=username]', 'nathaly');
    await page.type('input[autocomplete=current-password]', 'Nathaly123');
    await page.click('button[type=submit]');
    await deve('Quem é o tutor?');
    // 1. Tutor novo (pesquisa vazia → formulário aparece já preenchido)
    await page.type('.busca-grande input', 'Carla Mendes');
    await deve('Cadastrar tutor novo');
    await digitarNoCampo('ID do tutor no sistema veterinário', '3001');
    await digitarNoCampo('Telefone / WhatsApp', '(11) 91111-2222');
    await foto('w1_tutor');
    await clicar('Avançar');
    // 2. Animal novo
    await deve('Qual é o paciente?');
    await digitarNoCampo('ID do animal no sistema veterinário', '7001');
    await digitarNoCampo('Nome', 'Pipoca');
    await digitarNoCampo('Espécie', 'Canina');
    await foto('w2_paciente');
    await clicar('Avançar');
    // 3. Com exame
    await deve('Este atendimento tem exame?');
    await page.click('input[name=comexame][value=sim]');
    await page.waitForSelector('.linha-exame select');
    await page.$eval('.linha-exame select', (s) => { s.value = [...s.options].find((o) => o.text === 'Hemograma').value; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await espera(300);
    await page.$eval('.linha-exame', (l) => { const s = l.querySelectorAll('select')[1]; s.value = [...s.options].find((o) => o.text.startsWith('Laboratório A')).value; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await deve('Resultado previsto:');
    await foto('w3_atendimento');
    await clicar('Avançar');
    // 4. Conferir e concluir
    await deve('Confira antes de salvar');
    await foto('w4_conferir');
    await clicar('✓ Concluir cadastro');
    await deve('Cadastro concluído!');
    await foto('w5_concluido');

    // Segundo cadastro: mesmo tutor (pesquisa), outro animal, SEM exame
    await clicar('+ Novo atendimento');
    await deve('Quem é o tutor?');
    await page.type('.busca-grande input', 'Carla');
    await deve('Já cadastrado? Clique no tutor:');
    await clicar('Carla Mendes', '.item-escolha');
    await deve('Escolha o animal:');
    await clicar('+ Outro animal', '.chip-animal');
    await digitarNoCampo('ID do animal no sistema veterinário', '7002');
    await digitarNoCampo('Nome', 'Biscoito');
    await digitarNoCampo('Espécie', 'Felina');
    await clicar('Avançar');
    await page.click('input[name=comexame][value=nao]');
    await deve('Sem exame: programe o retorno.');
    await clicar('30 dias');
    await foto('w6_sem_exame');
    await clicar('Avançar');
    await deve('Retorno previsto para');
    await clicar('✓ Concluir cadastro');
    await deve('Cadastro concluído!');
    await clicar('Abrir ficha do paciente');
    await deve('Biscoito');
    await deve('Retorno clínico');
    await foto('w7_ficha');
    console.log('OK — cadastro em uma tela funcionando');
  } catch (e) {
    await foto('w_ERRO').catch(() => {});
    console.error('FALHA:', e.message); process.exitCode = 1;
  } finally {
    if (erros.length) { console.error('Erros JS:', erros.join(' | ')); process.exitCode = 1; }
    await browser.close();
  }
})();
