# Patinhas de Assis | Central da Recepção

Sistema web da recepção do Hospital Veterinário Patinhas de Assis (São Bernardo do Campo/SP): exames, laudos, cobranças de laboratório, retornos, internação, histórico auditável, relatórios e gestão de usuários — substituindo as planilhas de Excel.

Funciona com **três serviços que você já usa**: **Supabase** (banco de dados e login), **Vercel** (site no ar) e **GitHub** (código e backup diário).

---

## 1. Como funciona (resumo)

| Peça | O que faz |
|---|---|
| **Supabase** | Banco PostgreSQL com todas as regras: cálculo de dias úteis e feriados, permissões por perfil, histórico que ninguém consegue apagar, prevenção de duplicidades. Também cuida do login de cada funcionária e da atualização em tempo real. |
| **Vercel** | Publica o site (pasta `public/`) e roda três funções seguras (pasta `api/`): configuração, criação do primeiro administrador e Gestão de Usuários. |
| **GitHub** | Guarda o código. A cada alteração, a Vercel atualiza o site sozinha. Também roda o **backup diário** do banco. |

**Segurança em camadas:** a interface esconde o que a recepção não pode usar, mas quem realmente decide é o **banco** — mesmo que alguém tente chamar a API diretamente, a recepção não altera prazos, configurações, usuários nem o histórico (isso foi testado).

### Modelo de dados (principais tabelas)

```
perfis (funcionários) ── login do Supabase Auth
tutores 1──N animais 1──N atendimentos (acompanhamentos)
                              ├──N exames ──N cobrancas
                              └──N retornos (clínico | avaliação de exames | pós-alta)
animais 1──N internacoes
laboratorios, tipos_exame, prazos (lab × exame, em dias úteis), feriados, configuracoes
historico (somente inserção: quem, quando, o quê, antes → depois)
```

### Telas

Central da Recepção (indicadores clicáveis) · Exames · Retornos · Tutores e Pacientes (com ficha e linha do tempo) · Internação · Histórico de Atividades · Relatórios* · Configurações* · Gestão de Usuários*
(*somente administradores)

---

## 2. Colocar no ar — passo a passo

### Passo A — Supabase (banco de dados)

1. Entre em **supabase.com** → **New project**.
   - Nome: `central-patinhas` · Região: **South America (São Paulo)** · crie e **anote** a senha do banco.
2. Quando o projeto terminar de criar: menu lateral → **SQL Editor** → **New query**.
3. Abra o arquivo **`supabase/instalar_tudo.sql`**, copie **tudo**, cole e clique em **Run**. Deve aparecer "Success".
4. Menu **Authentication** → **Sign In / Providers** (ou *Providers*):
   - Desligue **"Allow new users to sign up"** (ninguém pode criar conta sozinho; só a gestão cria).
   - Em **Email**, altere **"Email OTP Expiration"** para `86400` (o link de senha passa a valer 24 horas).
   - Se houver "Minimum password length", coloque `8`.
5. Menu **Project Settings → API Keys** (ou *API*). Anote três valores:
   - **Project URL** (ex.: `https://abcd.supabase.co`)
   - **anon / publishable key**
   - **service_role / secret key** ⚠️ esta é secreta — nunca coloque no código.

### Passo B — GitHub (código)

O código deste projeto vai para um repositório **privado** no seu GitHub (ex.: `central-patinhas`). Se for subir pelo Prompt de Comando, dentro da pasta do projeto:

```
git init
git add .
git commit -m "Central da Recepção"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/central-patinhas.git
git push -u origin main
```

### Passo C — Vercel (site no ar)

1. **vercel.com** → **Add New… → Project** → importe `central-patinhas`.
2. Antes de clicar em Deploy, abra **Environment Variables** e cadastre:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do passo A5 |
| `SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
| `SETUP_TOKEN` | invente uma frase longa (ex.: `patinhas-gestao-2026-inicio`) |

3. Clique em **Deploy**. O endereço fica parecido com `central-patinhas.vercel.app` (dá para colocar domínio próprio em *Settings → Domains*).

### Passo D — Primeiro administrador

1. Abra o endereço do site. Como ainda não há usuários, aparece **Configuração inicial**.
2. Informe o `SETUP_TOKEN`, seu nome, seu login (ex.: `bruna`) e sua senha.
3. Pronto: entre com seu login. Essa tela some para sempre depois do primeiro administrador. (Opcional: apague a variável `SETUP_TOKEN` na Vercel.)

### Passo E — Cadastrar as funcionárias

1. **Gestão de Usuários → + Novo usuário** → nome, login (ex.: `nathaly`) e perfil (*Recepção* ou *Administrador*).
2. O sistema mostra um **link de uso único** → botão **Enviar pelo WhatsApp**.
3. A funcionária abre o link, cria a própria senha e já pode entrar. Ninguém (nem a gestão) vê a senha.
4. Esqueceu a senha? Ela clica em "Esqueci minha senha" na tela de login; o pedido aparece para a gestão, que clica em **Gerar link de acesso**.
5. Desligamento: **Desativar** (o histórico dela continua salvo). Afastamento: **Bloquear** / **Reativar**.

### Passo F — Configurar a operação (gestão)

Em **Configurações**: cadastre laboratórios/profissionais, tipos de exame, os **prazos em dias úteis** de cada combinação, os feriados (há um botão que adiciona os nacionais do ano; acrescente os municipais de São Bernardo) e o prazo padrão do retorno clínico (começa em 15 dias).

---

## 3. Backup e restauração

**Automático (GitHub):** o arquivo `.github/workflows/backup.yml` gera um backup todo dia às 03:17 e guarda por 90 dias.

1. Supabase → botão **Connect** → copie a *connection string* "Session pooler" (troque `[YOUR-PASSWORD]` pela senha do banco).
2. GitHub → repositório → **Settings → Secrets and variables → Actions → New repository secret**
   - Nome: `SUPABASE_DB_URL` · Valor: a connection string.
3. Para testar na hora: aba **Actions → Backup diario do banco → Run workflow**. Os arquivos ficam em cada execução, em *Artifacts*.

> Recomendação: o plano **Pro** do Supabase também faz backups diários próprios e evita que o projeto seja pausado por inatividade. Para um sistema que roda 24 h, vale considerar.

**Restaurar** (em um projeto Supabase novo, **sem** rodar o `instalar_tudo.sql`), pelo Prompt de Comando com as ferramentas do PostgreSQL instaladas:

```
psql "CONNECTION_STRING_DO_PROJETO_NOVO" -f patinhas_usuarios_AAAA-MM-DD_HHMM.sql
psql "CONNECTION_STRING_DO_PROJETO_NOVO" -f patinhas_public_AAAA-MM-DD_HHMM.sql
```

Depois, no SQL Editor do projeto novo, ative o tempo real:
`ALTER PUBLICATION supabase_realtime ADD TABLE public.historico;`
e troque as três chaves do Supabase nas variáveis da Vercel.

---

## 4. Regras implementadas (principais)

- **Previsão do exame**: dias úteis (seg–sex), sem feriados; o 1º dia útil após a realização é o dia 1; prazo 0 = mesmo dia. Calculada **pelo banco**, congelada no registro; mudar o prazo depois não altera exames antigos. Recepção não altera previsão.
- **Classificação automática**: Dentro do prazo · Vence hoje · Atrasado · Laudo recebido. Recebimento e comunicação são independentes.
- **Cobrança**: só para atrasados; tira da lista de cobrança no dia e volta no **próximo dia útil** se o laudo não chegar; todas as cobranças ficam guardadas.
- **Agrupamento**: exames do mesmo animal na mesma data entram no mesmo acompanhamento; é possível vincular datas diferentes ou abrir outro acompanhamento no mesmo dia.
- **Retornos**: retorno clínico automático ao abrir atendimento (prazo configurável, data ajustável); alerta só a partir da data prevista; retorno de **avaliação de exames** criado uma única vez quando **todos** os laudos do grupo chegam (não exige comunicação ao tutor); não cria se já houver retorno clínico compatível agendado.
- **Internação**: exames seguem normalmente (atraso, cobrança, recebimento, "comunicado pela internação"); retornos ambulatoriais ficam suspensos; na alta o sistema pergunta se precisa de retorno (Sim → reativa/cria sem duplicar; Não → dispensado após a alta).
- **Histórico**: nome, ID, data/hora do servidor, ação, paciente, valor anterior → novo. Imutável no banco (nem a chave de serviço apaga).
- **Duas pessoas ao mesmo tempo**: o banco serializa as ações do mesmo acompanhamento; se duas marcam o mesmo laudo, a segunda vê "já registrado por X às HH:MM"; edições com versão evitam sobrescrever o trabalho da colega.
- **Tempo real**: qualquer ação atualiza as telas abertas das outras funcionárias.
- **Sessão**: individual por login; fechar o navegador encerra o acesso; 60 min sem uso encerra a sessão (computadores compartilhados entre turnos).
- **LGPD**: só dados necessários; acesso apenas com login ativo; repositório privado; backups privados; histórico de quem acessou e alterou.

---

## 5. Testes realizados

- `test/banco.test.js` — **20 testes automatizados** contra PostgreSQL real com o ambiente do Supabase simulado, cobrindo os **24 cenários obrigatórios** (tutor com dois animais, vários exames na mesma data, laboratórios/prazos diferentes, fim de semana, feriado, recebido antes do prazo, atrasado, cobrança e volta no próximo dia útil, laudo sem comunicação, comunicação pela internação, laudos parciais, liberação do retorno de exames, retorno clínico com exames pendentes, internado com exame atrasado, alta com e sem retorno, vários animais/atendimentos, criação e bloqueio de usuário, tentativa de acessar configuração proibida, registro de nome/data/hora, duas funcionárias simultâneas, duplicidades e persistência).
- `test/e2e/interface.e2e.js` — teste no **navegador (Chrome)** do fluxo completo: login, configuração pela gestão, cadastro de tutor/animal, bloqueio de duplicidade, cadastro de 3 exames, recebimento parcial e total, agendamento, internação e alta, painel, listas, histórico, bloqueio da recepção (inclusive tentando a API diretamente), celular e relatórios.

Para rodar (desenvolvedores): `npm install` e, com um PostgreSQL local preparado por `test/reset.sh`, `npm test`.

---

## 6. Estrutura do projeto

```
public/            site (HTML, CSS, JavaScript; sem etapa de build)
  js/telas/        uma tela por arquivo
  vendor/          biblioteca do Supabase (cópia local)
api/               funções da Vercel (config, setup, usuarios)
supabase/          SQL do banco (instalar_tudo.sql + migrações separadas)
.github/workflows/ backup diário
test/              testes do banco e da interface
```

**Módulo de Orçamentos (futuro):** a estrutura já prevê — nova tela em `public/js/telas/`, item no menu (`TELAS` em `public/js/app.js`), tabela ligada a `atendimentos`/`animais`, funções RPC no mesmo padrão e registro em `historico` via `registrar()`.
