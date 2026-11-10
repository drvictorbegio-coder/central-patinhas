-- =====================================================================
-- Patinhas de Assis | Central da Recepção — 0001: estrutura
-- Banco: Supabase (PostgreSQL). Login: Supabase Auth (auth.users).
-- =====================================================================

-- Data de hoje no fuso de São Paulo.
-- "app.hoje" só pode ser definido por conexão direta ao banco (suíte de testes);
-- a API do Supabase não permite que o navegador altere essa configuração.
CREATE OR REPLACE FUNCTION public.hoje() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.hoje', true), '')::date,
                  (now() AT TIME ZONE 'America/Sao_Paulo')::date)
$$;

-- ---------- Funcionários (perfil de cada login do Supabase Auth)
CREATE TABLE public.perfis (
  id             uuid PRIMARY KEY REFERENCES auth.users(id),
  nome_completo  text NOT NULL CHECK (length(trim(nome_completo)) >= 2),
  login          text NOT NULL CHECK (login ~ '^[a-z0-9._-]{3,40}$'),
  perfil         text NOT NULL CHECK (perfil IN ('admin','recepcao')),
  situacao       text NOT NULL DEFAULT 'pendente'
                 CHECK (situacao IN ('pendente','ativo','bloqueado','inativo')),
  ultimo_acesso  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid REFERENCES public.perfis(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX perfis_login_uk ON public.perfis (lower(login));

CREATE TABLE public.solicitacoes_senha (
  id              serial PRIMARY KEY,
  login_informado text NOT NULL,
  usuario_id      uuid REFERENCES public.perfis(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atendida_em     timestamptz,
  atendida_por    uuid REFERENCES public.perfis(id)
);

-- ---------- Configurações administrativas
CREATE TABLE public.laboratorios (
  id        serial PRIMARY KEY,
  nome      text NOT NULL CHECK (length(trim(nome)) >= 2),
  tipo      text NOT NULL DEFAULT 'laboratorio' CHECK (tipo IN ('laboratorio','profissional')),
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX laboratorios_nome_uk ON public.laboratorios (lower(nome));

CREATE TABLE public.tipos_exame (
  id        serial PRIMARY KEY,
  nome      text NOT NULL CHECK (length(trim(nome)) >= 2),
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tipos_exame_nome_uk ON public.tipos_exame (lower(nome));

CREATE TABLE public.prazos (
  id             serial PRIMARY KEY,
  laboratorio_id int NOT NULL REFERENCES public.laboratorios(id),
  tipo_exame_id  int NOT NULL REFERENCES public.tipos_exame(id),
  dias_uteis     int NOT NULL CHECK (dias_uteis BETWEEN 0 AND 120),
  ativo          boolean NOT NULL DEFAULT true,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prazos_combinacao_uk UNIQUE (laboratorio_id, tipo_exame_id)
);

CREATE TABLE public.feriados (
  data       date PRIMARY KEY,
  descricao  text NOT NULL CHECK (length(trim(descricao)) >= 2)
);

CREATE TABLE public.configuracoes (
  chave          text PRIMARY KEY,
  valor          jsonb NOT NULL,
  descricao      text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.configuracoes (chave, valor, descricao) VALUES
  ('retorno_clinico_dias', '15', 'Prazo padrão (dias corridos) do retorno clínico de um novo atendimento');

-- ---------- Dias úteis
CREATE OR REPLACE FUNCTION public.eh_dia_util(d date) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM public.feriados f WHERE f.data = d)
$$;

-- Prazo positivo: o primeiro dia útil POSTERIOR à realização é o dia 1. Prazo zero: a própria data.
CREATE OR REPLACE FUNCTION public.soma_dias_uteis(inicio date, n int) RETURNS date LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE d date := inicio; c int := 0;
BEGIN
  IF n IS NULL OR n <= 0 THEN RETURN inicio; END IF;
  LOOP
    d := d + 1;
    IF public.eh_dia_util(d) THEN c := c + 1; EXIT WHEN c >= n; END IF;
  END LOOP;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.proximo_dia_util(d date) RETURNS date LANGUAGE sql STABLE
SET search_path = public AS $$ SELECT public.soma_dias_uteis(d, 1) $$;

-- Dias úteis decorridos entre a (exclusivo) e b (inclusivo)
CREATE OR REPLACE FUNCTION public.dias_uteis_entre(a date, b date) RETURNS int LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT CASE WHEN b IS NULL OR a IS NULL OR b <= a THEN 0 ELSE
    (SELECT count(*)::int FROM generate_series(a + 1, b, interval '1 day') g WHERE public.eh_dia_util(g::date)) END
$$;

-- ---------- Tutores e animais
CREATE TABLE public.tutores (
  id               serial PRIMARY KEY,
  id_externo       text NOT NULL CHECK (length(trim(id_externo)) >= 1),
  nome             text NOT NULL CHECK (length(trim(nome)) >= 2),
  telefone         text,
  telefone_digitos text GENERATED ALWAYS AS (regexp_replace(coalesce(telefone, ''), '\D', '', 'g')) STORED,
  observacoes      text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid REFERENCES public.perfis(id),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid REFERENCES public.perfis(id),
  versao           int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX tutores_id_externo_uk ON public.tutores (lower(trim(id_externo)));
CREATE INDEX tutores_nome_idx ON public.tutores (lower(nome));
CREATE INDEX tutores_tel_idx ON public.tutores (telefone_digitos);

CREATE TABLE public.animais (
  id             serial PRIMARY KEY,
  id_externo     text NOT NULL CHECK (length(trim(id_externo)) >= 1),
  nome           text NOT NULL CHECK (length(trim(nome)) >= 1),
  especie        text NOT NULL CHECK (length(trim(especie)) >= 2),
  tutor_id       int NOT NULL REFERENCES public.tutores(id),
  internado      boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid REFERENCES public.perfis(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES public.perfis(id),
  versao         int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX animais_id_externo_uk ON public.animais (lower(trim(id_externo)));
CREATE INDEX animais_tutor_idx ON public.animais (tutor_id);
CREATE INDEX animais_nome_idx ON public.animais (lower(nome));

-- ---------- Atendimentos (acompanhamentos)
CREATE TABLE public.atendimentos (
  id             serial PRIMARY KEY,
  animal_id      int NOT NULL REFERENCES public.animais(id),
  data_abertura  date NOT NULL,
  descricao      text,
  origem         text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','exames','internacao')),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid REFERENCES public.perfis(id)
);
CREATE INDEX atendimentos_animal_idx ON public.atendimentos (animal_id, data_abertura);

-- ---------- Exames
CREATE TABLE public.exames (
  id                  serial PRIMARY KEY,
  atendimento_id      int NOT NULL REFERENCES public.atendimentos(id),
  animal_id           int NOT NULL REFERENCES public.animais(id),
  tipo_exame_id       int NOT NULL REFERENCES public.tipos_exame(id),
  laboratorio_id      int NOT NULL REFERENCES public.laboratorios(id),
  data_realizacao     date NOT NULL,
  prazo_dias          int NOT NULL,
  data_prevista       date NOT NULL,
  observacoes         text,
  situacao            text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','cancelado')),
  motivo_cancelamento text,
  recebido_em         timestamptz,
  recebido_por        uuid REFERENCES public.perfis(id),
  comunicado_em       timestamptz,
  comunicado_por      uuid REFERENCES public.perfis(id),
  comunicacao_tipo    text CHECK (comunicacao_tipo IN ('tutor','internacao')),
  ultima_cobranca     date,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid REFERENCES public.perfis(id),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por      uuid REFERENCES public.perfis(id),
  versao              int NOT NULL DEFAULT 1,
  CHECK (comunicado_em IS NULL OR recebido_em IS NOT NULL),
  CHECK ((comunicado_em IS NULL) = (comunicacao_tipo IS NULL))
);
CREATE INDEX exames_atendimento_idx ON public.exames (atendimento_id);
CREATE INDEX exames_animal_idx ON public.exames (animal_id);
CREATE INDEX exames_pendentes_idx ON public.exames (data_prevista) WHERE situacao = 'ativo' AND recebido_em IS NULL;

CREATE TABLE public.cobrancas (
  id            serial PRIMARY KEY,
  exame_id      int NOT NULL REFERENCES public.exames(id),
  data_cobranca date NOT NULL,
  cobrado_em    timestamptz NOT NULL DEFAULT now(),
  cobrado_por   uuid NOT NULL REFERENCES public.perfis(id),
  CONSTRAINT cobrancas_dia_uk UNIQUE (exame_id, data_cobranca)
);

-- ---------- Internações
CREATE TABLE public.internacoes (
  id              serial PRIMARY KEY,
  animal_id       int NOT NULL REFERENCES public.animais(id),
  inicio          timestamptz NOT NULL DEFAULT now(),
  iniciada_por    uuid NOT NULL REFERENCES public.perfis(id),
  alta            timestamptz,
  alta_por        uuid REFERENCES public.perfis(id),
  precisa_retorno boolean,
  observacoes     text
);
CREATE UNIQUE INDEX internacoes_aberta_uk ON public.internacoes (animal_id) WHERE alta IS NULL;

-- ---------- Retornos
CREATE TABLE public.retornos (
  id                     serial PRIMARY KEY,
  atendimento_id         int NOT NULL REFERENCES public.atendimentos(id),
  animal_id              int NOT NULL REFERENCES public.animais(id),
  tipo                   text NOT NULL CHECK (tipo IN ('clinico','exames','pos_alta')),
  internacao_id          int REFERENCES public.internacoes(id),
  status                 text NOT NULL DEFAULT 'aguardando_agendamento' CHECK (status IN (
                           'aguardando_agendamento','tutor_contatado','agendado','realizado',
                           'nao_compareceu','recusou','dispensado','suspenso_internacao')),
  status_antes_suspensao text,
  data_prevista          date NOT NULL,
  data_contato           timestamptz,
  data_agendamento       timestamptz,
  data_consulta          date,
  hora_consulta          time,
  data_realizado         date,
  motivo                 text,
  observacoes            text,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  criado_por             uuid REFERENCES public.perfis(id),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_por         uuid REFERENCES public.perfis(id),
  versao                 int NOT NULL DEFAULT 1,
  CHECK (tipo <> 'pos_alta' OR internacao_id IS NOT NULL)
);
-- Um retorno clínico e um de exames por acompanhamento; um pós-alta por internação.
CREATE UNIQUE INDEX retornos_atend_tipo_uk ON public.retornos (atendimento_id, tipo) WHERE tipo IN ('clinico','exames');
CREATE UNIQUE INDEX retornos_pos_alta_uk ON public.retornos (internacao_id) WHERE tipo = 'pos_alta';
CREATE INDEX retornos_animal_idx ON public.retornos (animal_id);
CREATE INDEX retornos_status_idx ON public.retornos (status, data_prevista);

-- ---------- Histórico de atividades (somente inserção)
CREATE TABLE public.historico (
  id           bigserial PRIMARY KEY,
  ocorrido_em  timestamptz NOT NULL DEFAULT now(),
  usuario_id   uuid REFERENCES public.perfis(id),
  usuario_nome text NOT NULL,
  acao         text NOT NULL,
  descricao    text NOT NULL,
  entidade     text,
  entidade_id  int,
  animal_id    int REFERENCES public.animais(id),
  tutor_id     int REFERENCES public.tutores(id),
  antes        jsonb,
  depois       jsonb
);
CREATE INDEX historico_data_idx ON public.historico (ocorrido_em DESC);
CREATE INDEX historico_animal_idx ON public.historico (animal_id, ocorrido_em);
CREATE INDEX historico_usuario_idx ON public.historico (usuario_id, ocorrido_em);
CREATE INDEX historico_acao_idx ON public.historico (acao);

-- Preparação para o futuro módulo de Orçamentos: os orçamentos deverão referenciar
-- public.atendimentos(id) e public.animais(id), registrar ações em public.historico
-- por meio de public.registrar() e seguir o mesmo padrão de RLS/RPC deste projeto.
