-- Patinhas de Assis | Central da Recepção — INSTALAÇÃO COMPLETA DO BANCO (Supabase → SQL Editor → Run, uma única vez)

-- >>> supabase/migrations/0001_estrutura.sql
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

-- >>> supabase/migrations/0002_regras.sql
-- =====================================================================
-- 0002: identidade, histórico automático, proteções e regras de negócio
-- Todas as gravações operacionais passam por funções (RPC) que validam
-- o usuário logado, aplicam as regras e registram o histórico.
-- =====================================================================

-- ---------- Identidade do usuário logado
CREATE OR REPLACE FUNCTION public.is_ativo() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND situacao = 'ativo')
$$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND situacao = 'ativo' AND perfil = 'admin')
$$;

CREATE OR REPLACE FUNCTION public._exigir_usuario() RETURNS public.perfis LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis;
BEGIN
  SELECT * INTO u FROM public.perfis WHERE id = auth.uid();
  IF u.id IS NULL OR u.situacao <> 'ativo' THEN
    RAISE EXCEPTION 'Sessão inválida ou acesso bloqueado. Entre novamente.' USING ERRCODE = '42501';
  END IF;
  RETURN u;
END $$;

CREATE OR REPLACE FUNCTION public._exigir_admin() RETURNS public.perfis LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis;
BEGIN
  u := public._exigir_usuario();
  IF u.perfil <> 'admin' THEN
    RAISE EXCEPTION 'Acesso restrito aos administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN u;
END $$;

-- ---------- Histórico automático (nome, ID, data/hora do servidor, ação, registro, antes/depois)
CREATE OR REPLACE FUNCTION public.registrar(
  p_acao text, p_descricao text, p_entidade text DEFAULT NULL, p_entidade_id int DEFAULT NULL,
  p_animal_id int DEFAULT NULL, p_tutor_id int DEFAULT NULL, p_antes jsonb DEFAULT NULL, p_depois jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis; v_tutor int := p_tutor_id;
BEGIN
  SELECT * INTO u FROM public.perfis WHERE id = auth.uid();
  IF v_tutor IS NULL AND p_animal_id IS NOT NULL THEN
    SELECT tutor_id INTO v_tutor FROM public.animais WHERE id = p_animal_id;
  END IF;
  INSERT INTO public.historico (usuario_id, usuario_nome, acao, descricao, entidade, entidade_id, animal_id, tutor_id, antes, depois)
  VALUES (u.id, coalesce(u.nome_completo, 'Sistema'), p_acao, p_descricao, p_entidade, p_entidade_id,
          p_animal_id, v_tutor, p_antes, p_depois);
END $$;

-- Campos alterados entre dois registros (para "valor anterior" e "novo valor")
CREATE OR REPLACE FUNCTION public._diff(a jsonb, b jsonb, campos text[]) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text; antes jsonb := '{}'; depois jsonb := '{}';
BEGIN
  FOREACH c IN ARRAY campos LOOP
    IF (a -> c) IS DISTINCT FROM (b -> c) THEN
      antes := antes || jsonb_build_object(c, a -> c);
      depois := depois || jsonb_build_object(c, b -> c);
    END IF;
  END LOOP;
  IF depois = '{}'::jsonb THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('antes', antes, 'depois', depois);
END $$;

CREATE OR REPLACE FUNCTION public._d(d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(d, 'DD/MM/YYYY') $$;
CREATE OR REPLACE FUNCTION public._dh(t timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(t AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') $$;
CREATE OR REPLACE FUNCTION public._nome(u uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT nome_completo FROM public.perfis WHERE id = u), 'Sistema') $$;

-- =====================================================================
-- PROTEÇÕES NO BANCO
-- =====================================================================

-- Histórico imutável — ninguém altera nem apaga (nem administrador, nem a chave de serviço).
CREATE OR REPLACE FUNCTION public.trg_historico_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de atividades não pode ser alterado nem apagado.';
END $$;
CREATE TRIGGER historico_sem_alteracao BEFORE UPDATE OR DELETE ON public.historico
  FOR EACH ROW EXECUTE FUNCTION public.trg_historico_imutavel();
CREATE TRIGGER historico_sem_truncate BEFORE TRUNCATE ON public.historico
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_historico_imutavel();

-- Sem exclusão física de registros operacionais (usa-se cancelamento/desativação).
CREATE OR REPLACE FUNCTION public.trg_sem_exclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão não permitida em %. Utilize cancelamento ou desativação.', TG_TABLE_NAME;
END $$;
CREATE TRIGGER perfis_sem_exclusao       BEFORE DELETE ON public.perfis       FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER tutores_sem_exclusao      BEFORE DELETE ON public.tutores      FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER animais_sem_exclusao      BEFORE DELETE ON public.animais      FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER atendimentos_sem_exclusao BEFORE DELETE ON public.atendimentos FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER exames_sem_exclusao       BEFORE DELETE ON public.exames       FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER cobrancas_sem_exclusao    BEFORE DELETE OR UPDATE ON public.cobrancas FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER retornos_sem_exclusao     BEFORE DELETE ON public.retornos     FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER internacoes_sem_exclusao  BEFORE DELETE ON public.internacoes  FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER laboratorios_sem_exclusao BEFORE DELETE ON public.laboratorios FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();
CREATE TRIGGER tipos_sem_exclusao        BEFORE DELETE ON public.tipos_exame  FOR EACH ROW EXECUTE FUNCTION public.trg_sem_exclusao();

-- Configurações: somente administrador logado (ou rotinas internas sem usuário, como migrações).
CREATE OR REPLACE FUNCTION public.trg_exige_admin() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada: somente administradores podem alterar %.', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Perfis: administrador altera tudo; o próprio usuário só registra o último acesso e ativa a conta pendente.
CREATE OR REPLACE FUNCTION public.trg_perfis_protecao() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.id = auth.uid()
     AND (NEW.nome_completo, NEW.login, NEW.perfil, NEW.criado_por, NEW.criado_em)
         IS NOT DISTINCT FROM (OLD.nome_completo, OLD.login, OLD.perfil, OLD.criado_por, OLD.criado_em)
     AND (NEW.situacao = OLD.situacao OR (OLD.situacao = 'pendente' AND NEW.situacao = 'ativo')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Permissão negada: somente administradores podem alterar usuários.' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER laboratorios_admin  BEFORE INSERT OR UPDATE ON public.laboratorios FOR EACH ROW EXECUTE FUNCTION public.trg_exige_admin();
CREATE TRIGGER tipos_exame_admin   BEFORE INSERT OR UPDATE ON public.tipos_exame  FOR EACH ROW EXECUTE FUNCTION public.trg_exige_admin();
CREATE TRIGGER prazos_admin        BEFORE INSERT OR UPDATE OR DELETE ON public.prazos FOR EACH ROW EXECUTE FUNCTION public.trg_exige_admin();
CREATE TRIGGER feriados_admin      BEFORE INSERT OR UPDATE OR DELETE ON public.feriados FOR EACH ROW EXECUTE FUNCTION public.trg_exige_admin();
CREATE TRIGGER configuracoes_admin BEFORE INSERT OR UPDATE OR DELETE ON public.configuracoes FOR EACH ROW EXECUTE FUNCTION public.trg_exige_admin();
CREATE TRIGGER perfis_protecao     BEFORE INSERT OR UPDATE ON public.perfis FOR EACH ROW EXECUTE FUNCTION public.trg_perfis_protecao();

-- Histórico de alterações de configuração (quem, quando, antes e depois).
CREATE OR REPLACE FUNCTION public.trg_auditar_config() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_desc text; v_nome text; r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_nome := CASE TG_TABLE_NAME
    WHEN 'laboratorios' THEN 'laboratório/profissional' WHEN 'tipos_exame' THEN 'tipo de exame'
    WHEN 'prazos' THEN 'prazo' WHEN 'feriados' THEN 'feriado' ELSE 'configuração' END;
  v_desc := CASE TG_OP WHEN 'INSERT' THEN 'Cadastrou ' WHEN 'UPDATE' THEN 'Alterou ' ELSE 'Removeu ' END || v_nome;
  IF TG_TABLE_NAME = 'prazos' THEN
    v_desc := v_desc || ': ' || (SELECT te.nome FROM public.tipos_exame te WHERE te.id = r.tipo_exame_id)
           || ' — ' || (SELECT l.nome FROM public.laboratorios l WHERE l.id = r.laboratorio_id)
           || ' (' || r.dias_uteis || ' dia(s) útil(eis))';
  ELSIF TG_TABLE_NAME IN ('laboratorios','tipos_exame') THEN
    v_desc := v_desc || ': ' || r.nome;
  ELSIF TG_TABLE_NAME = 'feriados' THEN
    v_desc := v_desc || ': ' || public._d(r.data) || ' — ' || r.descricao;
  ELSE
    v_desc := v_desc || ': ' || r.chave;
  END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) - 'atualizado_em' = to_jsonb(OLD) - 'atualizado_em' THEN RETURN NEW; END IF;
  PERFORM public.registrar('configuracao_alterada', v_desc, TG_TABLE_NAME, NULL, NULL, NULL,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN r;
END $$;
CREATE TRIGGER laboratorios_auditoria  AFTER INSERT OR UPDATE ON public.laboratorios FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_config();
CREATE TRIGGER tipos_exame_auditoria   AFTER INSERT OR UPDATE ON public.tipos_exame  FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_config();
CREATE TRIGGER prazos_auditoria        AFTER INSERT OR UPDATE OR DELETE ON public.prazos FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_config();
CREATE TRIGGER feriados_auditoria      AFTER INSERT OR UPDATE OR DELETE ON public.feriados FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_config();
CREATE TRIGGER configuracoes_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.configuracoes FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_config();

-- Exames: prazo e previsão calculados pelo banco e congelados no registro.
CREATE OR REPLACE FUNCTION public.trg_exames_previsao() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prazo int;
BEGIN
  IF (SELECT animal_id FROM public.atendimentos WHERE id = NEW.atendimento_id) IS DISTINCT FROM NEW.animal_id THEN
    RAISE EXCEPTION 'O exame precisa pertencer a um acompanhamento do mesmo animal.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT dias_uteis INTO v_prazo FROM public.prazos
     WHERE laboratorio_id = NEW.laboratorio_id AND tipo_exame_id = NEW.tipo_exame_id AND ativo;
    IF v_prazo IS NULL THEN
      RAISE EXCEPTION 'Não há prazo configurado para % no laboratório %. Peça à gestão para cadastrá-lo em Configurações.',
        (SELECT nome FROM public.tipos_exame WHERE id = NEW.tipo_exame_id),
        (SELECT nome FROM public.laboratorios WHERE id = NEW.laboratorio_id);
    END IF;
    NEW.prazo_dias := v_prazo;
    NEW.data_prevista := public.soma_dias_uteis(NEW.data_realizacao, v_prazo);
    RETURN NEW;
  END IF;

  IF (NEW.prazo_dias, NEW.data_prevista, NEW.data_realizacao, NEW.tipo_exame_id, NEW.laboratorio_id)
     IS DISTINCT FROM (OLD.prazo_dias, OLD.data_prevista, OLD.data_realizacao, OLD.tipo_exame_id, OLD.laboratorio_id) THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Permissão negada: somente administradores podem corrigir prazo, previsão, tipo, laboratório ou data do exame.'
        USING ERRCODE = '42501';
    END IF;
    IF (NEW.data_realizacao, NEW.tipo_exame_id, NEW.laboratorio_id)
       IS DISTINCT FROM (OLD.data_realizacao, OLD.tipo_exame_id, OLD.laboratorio_id)
       AND NEW.data_prevista IS NOT DISTINCT FROM OLD.data_prevista THEN
      SELECT dias_uteis INTO v_prazo FROM public.prazos
       WHERE laboratorio_id = NEW.laboratorio_id AND tipo_exame_id = NEW.tipo_exame_id AND ativo;
      IF v_prazo IS NULL THEN RAISE EXCEPTION 'Não há prazo configurado para este exame neste laboratório.'; END IF;
      NEW.prazo_dias := v_prazo;
      NEW.data_prevista := public.soma_dias_uteis(NEW.data_realizacao, v_prazo);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exames_previsao BEFORE INSERT OR UPDATE ON public.exames
  FOR EACH ROW EXECUTE FUNCTION public.trg_exames_previsao();

CREATE OR REPLACE FUNCTION public.trg_retornos_animal() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT animal_id FROM public.atendimentos WHERE id = NEW.atendimento_id) IS DISTINCT FROM NEW.animal_id THEN
    RAISE EXCEPTION 'O retorno precisa pertencer a um acompanhamento do mesmo animal.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retornos_animal BEFORE INSERT OR UPDATE OF atendimento_id, animal_id ON public.retornos
  FOR EACH ROW EXECUTE FUNCTION public.trg_retornos_animal();

-- =====================================================================
-- VISÕES OPERACIONAIS (classificações automáticas)
-- =====================================================================
CREATE VIEW public.v_exames WITH (security_invoker = true) AS
SELECT e.*,
  te.nome AS tipo_nome, l.nome AS laboratorio_nome, l.tipo AS laboratorio_tipo,
  a.nome AS animal_nome, a.id_externo AS animal_id_externo, a.especie, a.internado,
  t.id AS tutor_id, t.nome AS tutor_nome, t.id_externo AS tutor_id_externo, t.telefone AS tutor_telefone,
  at.data_abertura AS atendimento_data,
  CASE
    WHEN e.situacao = 'cancelado'  THEN 'cancelado'
    WHEN e.recebido_em IS NOT NULL THEN 'recebido'
    WHEN e.data_prevista < public.hoje() THEN 'atrasado'
    WHEN e.data_prevista = public.hoje() THEN 'vence_hoje'
    ELSE 'no_prazo'
  END AS classificacao,
  (e.situacao = 'ativo' AND e.recebido_em IS NULL AND e.data_prevista < public.hoje()
     AND (e.ultima_cobranca IS NULL OR public.proximo_dia_util(e.ultima_cobranca) <= public.hoje())) AS precisa_cobranca,
  (e.situacao = 'ativo' AND e.recebido_em IS NOT NULL AND e.comunicado_em IS NULL) AS aguardando_comunicacao,
  (e.recebido_em IS NOT NULL AND (e.recebido_em AT TIME ZONE 'America/Sao_Paulo')::date > e.data_prevista) AS recebido_com_atraso,
  (e.recebido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data_recebimento,
  (SELECT count(*)::int FROM public.exames g WHERE g.atendimento_id = e.atendimento_id AND g.situacao = 'ativo') AS grupo_total,
  (SELECT count(*)::int FROM public.exames g WHERE g.atendimento_id = e.atendimento_id AND g.situacao = 'ativo' AND g.recebido_em IS NOT NULL) AS grupo_recebidos,
  uc.nome_completo  AS criado_por_nome,
  ur.nome_completo  AS recebido_por_nome,
  uco.nome_completo AS comunicado_por_nome,
  ua.nome_completo  AS atualizado_por_nome,
  (SELECT count(*)::int FROM public.cobrancas c WHERE c.exame_id = e.id) AS qtd_cobrancas,
  (SELECT max(c.cobrado_em) FROM public.cobrancas c WHERE c.exame_id = e.id) AS ultima_cobranca_em,
  (SELECT p.nome_completo FROM public.cobrancas c JOIN public.perfis p ON p.id = c.cobrado_por
     WHERE c.exame_id = e.id ORDER BY c.cobrado_em DESC LIMIT 1) AS ultima_cobranca_por_nome
FROM public.exames e
JOIN public.tipos_exame te ON te.id = e.tipo_exame_id
JOIN public.laboratorios l ON l.id = e.laboratorio_id
JOIN public.animais a ON a.id = e.animal_id
JOIN public.tutores t ON t.id = a.tutor_id
JOIN public.atendimentos at ON at.id = e.atendimento_id
LEFT JOIN public.perfis uc  ON uc.id  = e.criado_por
LEFT JOIN public.perfis ur  ON ur.id  = e.recebido_por
LEFT JOIN public.perfis uco ON uco.id = e.comunicado_por
LEFT JOIN public.perfis ua  ON ua.id  = e.atualizado_por;

CREATE VIEW public.v_retornos WITH (security_invoker = true) AS
SELECT r.*,
  a.nome AS animal_nome, a.id_externo AS animal_id_externo, a.especie, a.internado,
  t.id AS tutor_id, t.nome AS tutor_nome, t.id_externo AS tutor_id_externo, t.telefone AS tutor_telefone,
  at.data_abertura AS atendimento_data,
  CASE WHEN r.status = 'agendado' THEN coalesce(r.data_consulta, r.data_prevista) ELSE r.data_prevista END AS data_referencia,
  (SELECT count(*)::int FROM public.exames e WHERE e.atendimento_id = r.atendimento_id AND e.situacao = 'ativo' AND e.recebido_em IS NULL) AS exames_pendentes,
  (SELECT string_agg(te.nome, ', ' ORDER BY te.nome) FROM public.exames e JOIN public.tipos_exame te ON te.id = e.tipo_exame_id
     WHERE e.atendimento_id = r.atendimento_id AND e.situacao = 'ativo' AND e.recebido_em IS NULL) AS exames_pendentes_nomes,
  CASE
    WHEN r.status IN ('aguardando_agendamento','tutor_contatado','agendado') THEN
      CASE
        WHEN (CASE WHEN r.status = 'agendado' THEN coalesce(r.data_consulta, r.data_prevista) ELSE r.data_prevista END) < public.hoje() THEN 'vencido'
        WHEN (CASE WHEN r.status = 'agendado' THEN coalesce(r.data_consulta, r.data_prevista) ELSE r.data_prevista END) = public.hoje() THEN 'hoje'
        ELSE 'proximo'
      END
    WHEN r.status = 'suspenso_internacao' THEN 'suspenso'
    ELSE 'encerrado'
  END AS classificacao,
  ua.nome_completo AS atualizado_por_nome,
  uc.nome_completo AS criado_por_nome
FROM public.retornos r
JOIN public.animais a ON a.id = r.animal_id
JOIN public.tutores t ON t.id = a.tutor_id
JOIN public.atendimentos at ON at.id = r.atendimento_id
LEFT JOIN public.perfis ua ON ua.id = r.atualizado_por
LEFT JOIN public.perfis uc ON uc.id = r.criado_por;

CREATE VIEW public.v_internacoes WITH (security_invoker = true) AS
SELECT i.*, a.nome AS animal_nome, a.id_externo AS animal_id_externo, a.especie,
  t.id AS tutor_id, t.nome AS tutor_nome, t.id_externo AS tutor_id_externo, t.telefone AS tutor_telefone,
  pi.nome_completo AS iniciada_por_nome, pa.nome_completo AS alta_por_nome,
  (SELECT count(*)::int FROM public.exames e WHERE e.animal_id = i.animal_id AND e.situacao = 'ativo' AND e.recebido_em IS NULL) AS exames_aguardando,
  (SELECT count(*)::int FROM public.exames e WHERE e.animal_id = i.animal_id AND e.situacao = 'ativo' AND e.recebido_em IS NULL AND e.data_prevista < public.hoje()) AS exames_atrasados,
  (SELECT count(*)::int FROM public.exames e WHERE e.animal_id = i.animal_id AND e.situacao = 'ativo' AND e.recebido_em IS NOT NULL AND e.comunicado_em IS NULL) AS exames_a_comunicar
FROM public.internacoes i
JOIN public.animais a ON a.id = i.animal_id
JOIN public.tutores t ON t.id = a.tutor_id
LEFT JOIN public.perfis pi ON pi.id = i.iniciada_por
LEFT JOIN public.perfis pa ON pa.id = i.alta_por;

-- =====================================================================
-- RPC — TUTORES E ANIMAIS
-- =====================================================================
CREATE OR REPLACE FUNCTION public._txt(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(v), '') $$;

CREATE OR REPLACE FUNCTION public.salvar_tutor(p jsonb) RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario();
  v_id int := nullif(p->>'id', '')::int;
  v_ext text := public._txt(p->>'id_externo');
  v_nome text := public._txt(p->>'nome');
  v_tel text := public._txt(p->>'telefone');
  v_obs text := public._txt(p->>'observacoes');
  v_old public.tutores; v_new public.tutores; v_dup record; v_diff jsonb;
BEGIN
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Informe o ID do tutor no sistema veterinário.'; END IF;
  IF v_nome IS NULL OR length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o nome completo do tutor.'; END IF;
  IF v_tel IS NOT NULL AND length(regexp_replace(v_tel, '\D', '', 'g')) NOT BETWEEN 10 AND 13 THEN
    RAISE EXCEPTION 'Telefone inválido. Use DDD + número, por exemplo (11) 98765-4321.';
  END IF;

  SELECT id, nome INTO v_dup FROM public.tutores WHERE lower(trim(id_externo)) = lower(v_ext) AND id IS DISTINCT FROM v_id;
  IF v_dup.id IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe um tutor com o ID %: %. Pesquise antes de cadastrar.', v_ext, v_dup.nome USING ERRCODE = '23505';
  END IF;

  IF v_id IS NULL THEN
    IF NOT coalesce((p->>'confirmar')::boolean, false) THEN
      SELECT id, nome, id_externo INTO v_dup FROM public.tutores
       WHERE (v_tel IS NOT NULL AND telefone_digitos = regexp_replace(v_tel, '\D', '', 'g'))
          OR lower(nome) = lower(v_nome) LIMIT 1;
      IF v_dup.id IS NOT NULL THEN
        RAISE EXCEPTION 'Possível cadastro duplicado: já existe o tutor % (ID %) com o mesmo nome ou telefone. Confirme se é outra pessoa.',
          v_dup.nome, v_dup.id_externo USING ERRCODE = 'PAD01';
      END IF;
    END IF;
    INSERT INTO public.tutores (id_externo, nome, telefone, observacoes, criado_por, atualizado_por)
    VALUES (v_ext, v_nome, v_tel, v_obs, u.id, u.id) RETURNING * INTO v_new;
    PERFORM public.registrar('tutor_cadastrado', 'Cadastrou o tutor ' || v_nome || ' (ID ' || v_ext || ')',
      'tutor', v_new.id, NULL, v_new.id, NULL, jsonb_build_object('id_externo', v_ext, 'nome', v_nome, 'telefone', v_tel));
    RETURN v_new.id;
  END IF;

  SELECT * INTO v_old FROM public.tutores WHERE id = v_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Tutor não encontrado.'; END IF;
  IF p ? 'versao' AND (p->>'versao')::int <> v_old.versao THEN
    RAISE EXCEPTION 'Este cadastro foi alterado por % enquanto você editava. Recarregue e tente novamente.',
      public._nome(v_old.atualizado_por) USING ERRCODE = 'PAV01';
  END IF;
  UPDATE public.tutores SET id_externo = v_ext, nome = v_nome, telefone = v_tel, observacoes = v_obs,
         atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = v_id RETURNING * INTO v_new;
  v_diff := public._diff(to_jsonb(v_old), to_jsonb(v_new), ARRAY['id_externo','nome','telefone','observacoes']);
  IF v_diff IS NOT NULL THEN
    PERFORM public.registrar('tutor_alterado', 'Alterou o cadastro do tutor ' || v_nome, 'tutor', v_id, NULL, v_id,
      v_diff->'antes', v_diff->'depois');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.salvar_animal(p jsonb) RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario();
  v_id int := nullif(p->>'id', '')::int;
  v_ext text := public._txt(p->>'id_externo');
  v_nome text := public._txt(p->>'nome');
  v_esp text := public._txt(p->>'especie');
  v_tutor int := nullif(p->>'tutor_id', '')::int;
  v_old public.animais; v_new public.animais; v_dup record; v_diff jsonb;
BEGIN
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Informe o ID do animal no sistema veterinário.'; END IF;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do animal.'; END IF;
  IF v_esp IS NULL OR length(v_esp) < 2 THEN RAISE EXCEPTION 'Informe a espécie.'; END IF;
  IF v_tutor IS NULL OR NOT EXISTS (SELECT 1 FROM public.tutores WHERE id = v_tutor) THEN
    RAISE EXCEPTION 'Selecione o tutor responsável.';
  END IF;

  SELECT a.id, a.nome, t.nome AS tutor INTO v_dup FROM public.animais a JOIN public.tutores t ON t.id = a.tutor_id
   WHERE lower(trim(a.id_externo)) = lower(v_ext) AND a.id IS DISTINCT FROM v_id;
  IF v_dup.id IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe um animal com o ID %: % (tutor %). Pesquise antes de cadastrar.', v_ext, v_dup.nome, v_dup.tutor
      USING ERRCODE = '23505';
  END IF;

  IF v_id IS NULL THEN
    IF NOT coalesce((p->>'confirmar')::boolean, false) THEN
      SELECT id, id_externo INTO v_dup FROM public.animais WHERE tutor_id = v_tutor AND lower(nome) = lower(v_nome) LIMIT 1;
      IF v_dup.id IS NOT NULL THEN
        RAISE EXCEPTION 'Este tutor já tem um animal chamado % (ID %). Confirme se é outro animal.', v_nome, v_dup.id_externo
          USING ERRCODE = 'PAD01';
      END IF;
    END IF;
    INSERT INTO public.animais (id_externo, nome, especie, tutor_id, criado_por, atualizado_por)
    VALUES (v_ext, v_nome, v_esp, v_tutor, u.id, u.id) RETURNING * INTO v_new;
    PERFORM public.registrar('animal_cadastrado', 'Cadastrou o paciente ' || v_nome || ' (' || v_esp || ', ID ' || v_ext || ')',
      'animal', v_new.id, v_new.id, v_tutor, NULL, jsonb_build_object('id_externo', v_ext, 'nome', v_nome, 'especie', v_esp));
    RETURN v_new.id;
  END IF;

  SELECT * INTO v_old FROM public.animais WHERE id = v_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.'; END IF;
  IF p ? 'versao' AND (p->>'versao')::int <> v_old.versao THEN
    RAISE EXCEPTION 'Este cadastro foi alterado por % enquanto você editava. Recarregue e tente novamente.',
      public._nome(v_old.atualizado_por) USING ERRCODE = 'PAV01';
  END IF;
  UPDATE public.animais SET id_externo = v_ext, nome = v_nome, especie = v_esp, tutor_id = v_tutor,
         atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = v_id RETURNING * INTO v_new;
  v_diff := public._diff(to_jsonb(v_old), to_jsonb(v_new), ARRAY['id_externo','nome','especie','tutor_id']);
  IF v_diff IS NOT NULL THEN
    PERFORM public.registrar('animal_alterado', 'Alterou o cadastro do paciente ' || v_nome, 'animal', v_id, v_id, v_tutor,
      v_diff->'antes', v_diff->'depois');
  END IF;
  RETURN v_id;
END $$;

-- Pesquisa por ID, nome do tutor, nome do animal ou telefone.
CREATE OR REPLACE FUNCTION public.buscar_cadastros(q text) RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := lower(btrim(coalesce(q, ''))); dig text := regexp_replace(coalesce(q, ''), '\D', '', 'g'); res jsonb;
BEGIN
  PERFORM public._exigir_usuario();
  IF length(v) < 2 THEN RETURN '[]'::jsonb; END IF;
  WITH alvo AS (
    SELECT t.id FROM public.tutores t
     WHERE lower(t.id_externo) = v OR lower(t.nome) LIKE '%' || v || '%'
        OR (length(dig) >= 4 AND t.telefone_digitos LIKE '%' || dig || '%')
    UNION
    SELECT a.tutor_id FROM public.animais a
     WHERE lower(a.id_externo) = v OR lower(a.nome) LIKE '%' || v || '%'
    LIMIT 30
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'id_externo', t.id_externo, 'nome', t.nome, 'telefone', t.telefone, 'observacoes', t.observacoes, 'versao', t.versao,
      'animais', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'id_externo', a.id_externo, 'nome', a.nome,
                    'especie', a.especie, 'internado', a.internado) ORDER BY a.nome), '[]') FROM public.animais a WHERE a.tutor_id = t.id)
    ) ORDER BY t.nome), '[]')
    INTO res FROM public.tutores t WHERE t.id IN (SELECT id FROM alvo);
  RETURN res;
END $$;

-- =====================================================================
-- RPC — ATENDIMENTOS E RETORNO CLÍNICO AUTOMÁTICO
-- =====================================================================
CREATE OR REPLACE FUNCTION public._criar_atendimento(p_animal int, p_data date, p_descricao text, p_origem text,
  p_gerar_retorno boolean, p_data_retorno date) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario();
  v_animal public.animais; v_id int; v_dias int; v_prev date; v_ret int;
BEGIN
  SELECT * INTO v_animal FROM public.animais WHERE id = p_animal;
  INSERT INTO public.atendimentos (animal_id, data_abertura, descricao, origem, criado_por)
  VALUES (p_animal, p_data, p_descricao, p_origem, u.id) RETURNING id INTO v_id;
  PERFORM public.registrar('atendimento_criado', 'Abriu acompanhamento de ' || public._d(p_data) || ' para ' || v_animal.nome
    || coalesce(' — ' || p_descricao, ''), 'atendimento', v_id, p_animal);

  IF p_gerar_retorno THEN
    SELECT (valor #>> '{}')::int INTO v_dias FROM public.configuracoes WHERE chave = 'retorno_clinico_dias';
    v_prev := coalesce(p_data_retorno, p_data + coalesce(v_dias, 15));
    INSERT INTO public.retornos (atendimento_id, animal_id, tipo, status, status_antes_suspensao, data_prevista, criado_por, atualizado_por)
    VALUES (v_id, p_animal, 'clinico',
            CASE WHEN v_animal.internado THEN 'suspenso_internacao' ELSE 'aguardando_agendamento' END,
            CASE WHEN v_animal.internado THEN 'aguardando_agendamento' END, v_prev, u.id, u.id)
    RETURNING id INTO v_ret;
    PERFORM public.registrar('retorno_criado', 'Retorno clínico previsto para ' || public._d(v_prev)
      || CASE WHEN v_animal.internado THEN ' (suspenso: paciente internado)' ELSE '' END, 'retorno', v_ret, p_animal);
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.criar_atendimento(p jsonb) RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_animal int := nullif(p->>'animal_id', '')::int;
  v_data date := coalesce(nullif(p->>'data', '')::date, public.hoje());
  v_ret date := nullif(p->>'data_retorno', '')::date;
  v_ex int;
BEGIN
  PERFORM public._exigir_usuario();
  IF NOT EXISTS (SELECT 1 FROM public.animais WHERE id = v_animal) THEN RAISE EXCEPTION 'Selecione o paciente.'; END IF;
  IF v_data > public.hoje() THEN RAISE EXCEPTION 'A data do atendimento não pode ser futura.'; END IF;
  IF v_ret IS NOT NULL AND v_ret < v_data THEN RAISE EXCEPTION 'A data prevista do retorno não pode ser anterior ao atendimento.'; END IF;
  PERFORM pg_advisory_xact_lock(7101, v_animal);
  IF NOT coalesce((p->>'confirmar')::boolean, false) THEN
    SELECT id INTO v_ex FROM public.atendimentos WHERE animal_id = v_animal AND data_abertura = v_data LIMIT 1;
    IF v_ex IS NOT NULL THEN
      RAISE EXCEPTION 'Este paciente já tem um acompanhamento aberto em %. Deseja mesmo abrir outro?', public._d(v_data)
        USING ERRCODE = 'PAD01';
    END IF;
  END IF;
  RETURN public._criar_atendimento(v_animal, v_data, public._txt(p->>'descricao'), 'manual',
    coalesce((p->>'gerar_retorno')::boolean, true), v_ret);
END $$;

-- =====================================================================
-- RPC — EXAMES
-- =====================================================================

-- Libera o retorno de avaliação de exames quando TODOS os laudos do acompanhamento chegaram.
CREATE OR REPLACE FUNCTION public._verificar_retorno_exames(p_atendimento int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_pend int; v_animal public.animais; v_at public.atendimentos; rc public.retornos; v_ret int;
BEGIN
  SELECT * INTO v_at FROM public.atendimentos WHERE id = p_atendimento;
  SELECT count(*) FILTER (WHERE situacao = 'ativo'),
         count(*) FILTER (WHERE situacao = 'ativo' AND recebido_em IS NULL)
    INTO v_total, v_pend FROM public.exames WHERE atendimento_id = p_atendimento;
  IF v_total = 0 OR v_pend > 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.retornos WHERE atendimento_id = p_atendimento AND tipo = 'exames') THEN RETURN; END IF;

  SELECT * INTO v_animal FROM public.animais WHERE id = v_at.animal_id;
  -- Retorno compatível já agendado (para hoje ou depois) ou realizado hoje: a avaliação acontece nele.
  SELECT * INTO rc FROM public.retornos WHERE atendimento_id = p_atendimento AND tipo = 'clinico';
  IF rc.id IS NOT NULL AND (
       (rc.status = 'agendado' AND coalesce(rc.data_consulta, rc.data_prevista) >= public.hoje())
    OR (rc.status = 'realizado' AND rc.data_realizado >= public.hoje())) THEN
    PERFORM public.registrar('retorno_exames_compativel',
      'Todos os laudos do acompanhamento de ' || public._d(v_at.data_abertura) || ' foram recebidos; a avaliação será feita no retorno clínico '
      || CASE WHEN rc.status = 'agendado' THEN 'já agendado para ' || public._d(coalesce(rc.data_consulta, rc.data_prevista)) ELSE 'realizado hoje' END,
      'retorno', rc.id, v_at.animal_id);
    RETURN;
  END IF;

  INSERT INTO public.retornos (atendimento_id, animal_id, tipo, status, status_antes_suspensao, data_prevista, criado_por, atualizado_por)
  VALUES (p_atendimento, v_at.animal_id, 'exames',
          CASE WHEN v_animal.internado THEN 'suspenso_internacao' ELSE 'aguardando_agendamento' END,
          CASE WHEN v_animal.internado THEN 'aguardando_agendamento' END, public.hoje(), auth.uid(), auth.uid())
  ON CONFLICT DO NOTHING RETURNING id INTO v_ret;
  IF v_ret IS NOT NULL THEN
    PERFORM public.registrar('retorno_exames_liberado',
      'Todos os laudos do acompanhamento de ' || public._d(v_at.data_abertura) || ' foram recebidos — retorno para avaliação dos exames liberado'
      || CASE WHEN v_animal.internado THEN ' (suspenso: paciente internado)' ELSE ' para agendamento' END,
      'retorno', v_ret, v_at.animal_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cadastrar_exames(p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario();
  v_animal public.animais;
  v_data date := nullif(p->>'data_realizacao', '')::date;
  v_modo text := coalesce(nullif(p->>'atendimento', ''), 'auto');
  v_at int; v_novo boolean := false;
  it jsonb; v_tipo public.tipos_exame; v_lab public.laboratorios; v_ex public.exames; v_ids int[] := '{}';
BEGIN
  SELECT * INTO v_animal FROM public.animais WHERE id = nullif(p->>'animal_id', '')::int;
  IF v_animal.id IS NULL THEN RAISE EXCEPTION 'Selecione o paciente.'; END IF;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data de realização.'; END IF;
  IF v_data > public.hoje() THEN RAISE EXCEPTION 'A data de realização não pode ser futura.'; END IF;
  IF v_data < public.hoje() - 366 THEN RAISE EXCEPTION 'Data de realização muito antiga. Verifique.'; END IF;
  IF jsonb_typeof(p->'itens') <> 'array' OR jsonb_array_length(p->'itens') = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos um exame.';
  END IF;

  -- Evita que dois cadastros simultâneos criem acompanhamentos duplicados para o mesmo animal.
  PERFORM pg_advisory_xact_lock(7101, v_animal.id);

  IF v_modo = 'auto' THEN
    SELECT id INTO v_at FROM public.atendimentos WHERE animal_id = v_animal.id AND data_abertura = v_data ORDER BY id DESC LIMIT 1;
  ELSIF v_modo <> 'novo' THEN
    SELECT id INTO v_at FROM public.atendimentos WHERE id = v_modo::int AND animal_id = v_animal.id;
    IF v_at IS NULL THEN RAISE EXCEPTION 'Acompanhamento inválido para este paciente.'; END IF;
  END IF;
  IF v_at IS NULL THEN
    v_at := public._criar_atendimento(v_animal.id, v_data, public._txt(p->>'descricao'), 'exames',
      coalesce((p->>'gerar_retorno')::boolean, true), nullif(p->>'data_retorno', '')::date);
    v_novo := true;
  END IF;
  PERFORM 1 FROM public.atendimentos WHERE id = v_at FOR UPDATE;

  FOR it IN SELECT * FROM jsonb_array_elements(p->'itens') LOOP
    SELECT * INTO v_tipo FROM public.tipos_exame WHERE id = nullif(it->>'tipo_exame_id', '')::int AND ativo;
    SELECT * INTO v_lab FROM public.laboratorios WHERE id = nullif(it->>'laboratorio_id', '')::int AND ativo;
    IF v_tipo.id IS NULL THEN RAISE EXCEPTION 'Selecione o tipo de exame em todas as linhas.'; END IF;
    IF v_lab.id IS NULL THEN RAISE EXCEPTION 'Selecione o laboratório/profissional em todas as linhas.'; END IF;
    IF NOT coalesce((p->>'confirmar_duplicado')::boolean, false) AND EXISTS (
         SELECT 1 FROM public.exames WHERE atendimento_id = v_at AND tipo_exame_id = v_tipo.id
            AND laboratorio_id = v_lab.id AND situacao = 'ativo' AND NOT (id = ANY (v_ids))) THEN
      RAISE EXCEPTION '% (%) já está cadastrado neste acompanhamento de %. Deseja cadastrar novamente?',
        v_tipo.nome, v_lab.nome, public._d(v_data) USING ERRCODE = 'PAD01';
    END IF;
    INSERT INTO public.exames (atendimento_id, animal_id, tipo_exame_id, laboratorio_id, data_realizacao, prazo_dias, data_prevista,
                               observacoes, criado_por, atualizado_por)
    VALUES (v_at, v_animal.id, v_tipo.id, v_lab.id, v_data, 0, v_data, public._txt(it->>'observacoes'), u.id, u.id)
    RETURNING * INTO v_ex;
    v_ids := v_ids || v_ex.id;
    PERFORM public.registrar('exame_cadastrado',
      'Cadastrou ' || v_tipo.nome || ' (' || v_lab.nome || ') realizado em ' || public._d(v_data) || ' — previsão '
      || public._d(v_ex.data_prevista) || ' (' || v_ex.prazo_dias || ' dia(s) útil(eis))',
      'exame', v_ex.id, v_animal.id, NULL, NULL,
      jsonb_build_object('tipo', v_tipo.nome, 'laboratorio', v_lab.nome, 'data_realizacao', v_data,
                         'prazo_dias', v_ex.prazo_dias, 'data_prevista', v_ex.data_prevista));
  END LOOP;
  RETURN jsonb_build_object('atendimento_id', v_at, 'atendimento_novo', v_novo, 'exames', to_jsonb(v_ids));
END $$;

CREATE OR REPLACE FUNCTION public._carregar_exame(p_id int) RETURNS public.exames LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.exames; v_at int;
BEGIN
  SELECT atendimento_id INTO v_at FROM public.exames WHERE id = p_id;
  IF v_at IS NULL THEN RAISE EXCEPTION 'Exame não encontrado.'; END IF;
  PERFORM 1 FROM public.atendimentos WHERE id = v_at FOR UPDATE;  -- serializa ações do mesmo acompanhamento
  SELECT * INTO e FROM public.exames WHERE id = p_id FOR UPDATE;
  RETURN e;
END $$;

CREATE OR REPLACE FUNCTION public._exame_rotulo(e public.exames) RETURNS text LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT te.nome || ' (' || l.nome || ', ' || public._d(e.data_realizacao) || ')'
    FROM public.tipos_exame te, public.laboratorios l WHERE te.id = e.tipo_exame_id AND l.id = e.laboratorio_id
$$;

CREATE OR REPLACE FUNCTION public.exame_receber(p_id int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id);
BEGIN
  IF e.situacao <> 'ativo' THEN RAISE EXCEPTION 'Este exame está cancelado.'; END IF;
  IF e.recebido_em IS NOT NULL THEN
    RAISE EXCEPTION 'Laudo já registrado como recebido por % em %.', public._nome(e.recebido_por), public._dh(e.recebido_em)
      USING ERRCODE = 'PAV01';
  END IF;
  UPDATE public.exames SET recebido_em = now(), recebido_por = u.id, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = p_id;
  PERFORM public.registrar('laudo_recebido', 'Registrou o recebimento do laudo: ' || public._exame_rotulo(e)
    || CASE WHEN e.data_prevista < public.hoje() THEN ' (com atraso)' ELSE '' END, 'exame', p_id, e.animal_id,
    NULL, jsonb_build_object('status', 'aguardando_laudo'), jsonb_build_object('status', 'laudo_recebido'));
  PERFORM public._verificar_retorno_exames(e.atendimento_id);
END $$;

CREATE OR REPLACE FUNCTION public.exame_desfazer_recebimento(p_id int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id);
BEGIN
  IF e.recebido_em IS NULL THEN RAISE EXCEPTION 'O laudo deste exame não está marcado como recebido.' USING ERRCODE = 'PAV01'; END IF;
  IF e.comunicado_em IS NOT NULL THEN RAISE EXCEPTION 'Desfaça primeiro o registro de comunicação do resultado.'; END IF;
  UPDATE public.exames SET recebido_em = NULL, recebido_por = NULL, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = p_id;
  PERFORM public.registrar('recebimento_desfeito', 'Desfez o recebimento do laudo: ' || public._exame_rotulo(e),
    'exame', p_id, e.animal_id, NULL,
    jsonb_build_object('recebido_em', e.recebido_em, 'recebido_por', public._nome(e.recebido_por)), jsonb_build_object('recebido_em', NULL));
END $$;

CREATE OR REPLACE FUNCTION public.exame_comunicar(p_id int, p_tipo text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id);
BEGIN
  IF p_tipo NOT IN ('tutor','internacao') THEN RAISE EXCEPTION 'Tipo de comunicação inválido.'; END IF;
  IF e.situacao <> 'ativo' THEN RAISE EXCEPTION 'Este exame está cancelado.'; END IF;
  IF e.recebido_em IS NULL THEN RAISE EXCEPTION 'Registre primeiro o recebimento do laudo.'; END IF;
  IF e.comunicado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Resultado já registrado como comunicado por % em %.', public._nome(e.comunicado_por), public._dh(e.comunicado_em)
      USING ERRCODE = 'PAV01';
  END IF;
  UPDATE public.exames SET comunicado_em = now(), comunicado_por = u.id, comunicacao_tipo = p_tipo,
         atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_id;
  PERFORM public.registrar(CASE p_tipo WHEN 'tutor' THEN 'resultado_enviado_tutor' ELSE 'resultado_comunicado_internacao' END,
    CASE p_tipo WHEN 'tutor' THEN 'Marcou resultado enviado ao tutor: ' ELSE 'Marcou resultado comunicado pela internação: ' END
    || public._exame_rotulo(e), 'exame', p_id, e.animal_id);
END $$;

CREATE OR REPLACE FUNCTION public.exame_desfazer_comunicacao(p_id int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id);
BEGIN
  IF e.comunicado_em IS NULL THEN RAISE EXCEPTION 'Este resultado não está marcado como comunicado.' USING ERRCODE = 'PAV01'; END IF;
  UPDATE public.exames SET comunicado_em = NULL, comunicado_por = NULL, comunicacao_tipo = NULL,
         atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_id;
  PERFORM public.registrar('comunicacao_desfeita', 'Desfez o registro de comunicação do resultado: ' || public._exame_rotulo(e),
    'exame', p_id, e.animal_id, NULL,
    jsonb_build_object('comunicado_em', e.comunicado_em, 'comunicado_por', public._nome(e.comunicado_por), 'tipo', e.comunicacao_tipo),
    jsonb_build_object('comunicado_em', NULL));
END $$;

CREATE OR REPLACE FUNCTION public.exame_cobrar(p_id int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id); v_n int; v_quem text;
BEGIN
  IF e.situacao <> 'ativo' THEN RAISE EXCEPTION 'Este exame está cancelado.'; END IF;
  IF e.recebido_em IS NOT NULL THEN RAISE EXCEPTION 'O laudo deste exame já foi recebido.' USING ERRCODE = 'PAV01'; END IF;
  IF e.data_prevista >= public.hoje() THEN RAISE EXCEPTION 'Este exame ainda está dentro do prazo (previsão %).', public._d(e.data_prevista); END IF;
  IF e.ultima_cobranca = public.hoje() THEN
    SELECT p.nome_completo INTO v_quem FROM public.cobrancas c JOIN public.perfis p ON p.id = c.cobrado_por
     WHERE c.exame_id = p_id AND c.data_cobranca = public.hoje();
    RAISE EXCEPTION 'A cobrança deste exame já foi registrada hoje por %.', v_quem USING ERRCODE = 'PAV01';
  END IF;
  INSERT INTO public.cobrancas (exame_id, data_cobranca, cobrado_por) VALUES (p_id, public.hoje(), u.id);
  UPDATE public.exames SET ultima_cobranca = public.hoje(), atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = p_id;
  SELECT count(*) INTO v_n FROM public.cobrancas WHERE exame_id = p_id;
  PERFORM public.registrar('laboratorio_cobrado', 'Cobrou o laboratório sobre ' || public._exame_rotulo(e)
    || ' — ' || v_n || 'ª cobrança, ' || (public.hoje() - e.data_prevista) || ' dia(s) de atraso', 'exame', p_id, e.animal_id);
END $$;

CREATE OR REPLACE FUNCTION public.exame_cancelar(p_id int, p_motivo text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id);
BEGIN
  IF public._txt(p_motivo) IS NULL OR length(btrim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  IF e.situacao = 'cancelado' THEN RAISE EXCEPTION 'Este exame já está cancelado.' USING ERRCODE = 'PAV01'; END IF;
  UPDATE public.exames SET situacao = 'cancelado', motivo_cancelamento = btrim(p_motivo),
         atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_id;
  PERFORM public.registrar('exame_cancelado', 'Cancelou o exame ' || public._exame_rotulo(e) || '. Motivo: ' || btrim(p_motivo),
    'exame', p_id, e.animal_id, NULL, jsonb_build_object('situacao', 'ativo'), jsonb_build_object('situacao', 'cancelado', 'motivo', btrim(p_motivo)));
  PERFORM public._verificar_retorno_exames(e.atendimento_id);
END $$;

-- Vincula manualmente um exame a outro acompanhamento do mesmo animal (datas diferentes).
CREATE OR REPLACE FUNCTION public.exame_vincular(p_id int, p_atendimento int) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id); v_dest public.atendimentos;
BEGIN
  SELECT * INTO v_dest FROM public.atendimentos WHERE id = p_atendimento FOR UPDATE;
  IF v_dest.id IS NULL OR v_dest.animal_id <> e.animal_id THEN RAISE EXCEPTION 'Escolha um acompanhamento do mesmo paciente.'; END IF;
  IF v_dest.id = e.atendimento_id THEN RAISE EXCEPTION 'O exame já pertence a este acompanhamento.'; END IF;
  UPDATE public.exames SET atendimento_id = p_atendimento, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
   WHERE id = p_id;
  PERFORM public.registrar('exame_vinculado', 'Vinculou ' || public._exame_rotulo(e) || ' ao acompanhamento de '
    || public._d(v_dest.data_abertura), 'exame', p_id, e.animal_id, NULL,
    jsonb_build_object('atendimento_id', e.atendimento_id), jsonb_build_object('atendimento_id', p_atendimento));
  PERFORM public._verificar_retorno_exames(e.atendimento_id);
  PERFORM public._verificar_retorno_exames(p_atendimento);
END $$;

-- Correção de exame. Observações: recepção. Tipo, laboratório, datas e previsão: somente administrador.
CREATE OR REPLACE FUNCTION public.exame_corrigir(p_id int, p jsonb) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); e public.exames := public._carregar_exame(p_id); n public.exames; v_diff jsonb;
BEGIN
  IF (p ?| ARRAY['tipo_exame_id','laboratorio_id','data_realizacao','data_prevista']) AND u.perfil <> 'admin' THEN
    RAISE EXCEPTION 'Somente administradores podem corrigir tipo, laboratório, data de realização ou previsão.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'versao' AND (p->>'versao')::int <> e.versao THEN
    RAISE EXCEPTION 'Este exame foi alterado por outra pessoa. Recarregue e tente novamente.' USING ERRCODE = 'PAV01';
  END IF;
  UPDATE public.exames SET
    tipo_exame_id   = coalesce(nullif(p->>'tipo_exame_id', '')::int, tipo_exame_id),
    laboratorio_id  = coalesce(nullif(p->>'laboratorio_id', '')::int, laboratorio_id),
    data_realizacao = coalesce(nullif(p->>'data_realizacao', '')::date, data_realizacao),
    data_prevista   = coalesce(nullif(p->>'data_prevista', '')::date, data_prevista),
    observacoes     = CASE WHEN p ? 'observacoes' THEN public._txt(p->>'observacoes') ELSE observacoes END,
    atualizado_em = now(), atualizado_por = u.id, versao = versao + 1
  WHERE id = p_id RETURNING * INTO n;
  v_diff := public._diff(to_jsonb(e), to_jsonb(n),
    ARRAY['tipo_exame_id','laboratorio_id','data_realizacao','prazo_dias','data_prevista','observacoes']);
  IF v_diff IS NOT NULL THEN
    PERFORM public.registrar(CASE WHEN u.perfil = 'admin' THEN 'correcao_administrativa' ELSE 'exame_alterado' END,
      'Corrigiu o exame ' || public._exame_rotulo(e), 'exame', p_id, e.animal_id, NULL, v_diff->'antes', v_diff->'depois');
  END IF;
END $$;

-- =====================================================================
-- RPC — RETORNOS
-- =====================================================================
CREATE OR REPLACE FUNCTION public._retorno_rotulo(r public.retornos) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r.tipo WHEN 'clinico' THEN 'retorno clínico' WHEN 'exames' THEN 'retorno de avaliação de exames' ELSE 'retorno pós-alta' END
$$;
CREATE OR REPLACE FUNCTION public._status_nome(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s WHEN 'aguardando_agendamento' THEN 'Aguardando agendamento' WHEN 'tutor_contatado' THEN 'Tutor contatado'
    WHEN 'agendado' THEN 'Retorno agendado' WHEN 'realizado' THEN 'Retorno realizado' WHEN 'nao_compareceu' THEN 'Tutor não compareceu'
    WHEN 'recusou' THEN 'Tutor recusou' WHEN 'dispensado' THEN 'Retorno dispensado' WHEN 'suspenso_internacao' THEN 'Suspenso por internação'
    ELSE s END
$$;

CREATE OR REPLACE FUNCTION public.retorno_criar(p jsonb) RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); v_at public.atendimentos; v_animal public.animais; v_data date; v_id int;
BEGIN
  SELECT * INTO v_at FROM public.atendimentos WHERE id = nullif(p->>'atendimento_id', '')::int FOR UPDATE;
  IF v_at.id IS NULL THEN RAISE EXCEPTION 'Selecione o acompanhamento.'; END IF;
  v_data := nullif(p->>'data_prevista', '')::date;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data prevista do retorno.'; END IF;
  IF EXISTS (SELECT 1 FROM public.retornos WHERE atendimento_id = v_at.id AND tipo = 'clinico') THEN
    RAISE EXCEPTION 'Este acompanhamento já possui retorno clínico. Altere a data do retorno existente.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_animal FROM public.animais WHERE id = v_at.animal_id;
  INSERT INTO public.retornos (atendimento_id, animal_id, tipo, status, status_antes_suspensao, data_prevista, observacoes, criado_por, atualizado_por)
  VALUES (v_at.id, v_at.animal_id, 'clinico',
          CASE WHEN v_animal.internado THEN 'suspenso_internacao' ELSE 'aguardando_agendamento' END,
          CASE WHEN v_animal.internado THEN 'aguardando_agendamento' END, v_data, public._txt(p->>'observacoes'), u.id, u.id)
  RETURNING id INTO v_id;
  PERFORM public.registrar('retorno_criado', 'Criou retorno clínico previsto para ' || public._d(v_data), 'retorno', v_id, v_at.animal_id);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.retorno_alterar_previsao(p_id int, p_data date, p_versao int DEFAULT NULL) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); r public.retornos;
BEGIN
  SELECT * INTO r FROM public.retornos WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Retorno não encontrado.'; END IF;
  IF p_versao IS NOT NULL AND p_versao <> r.versao THEN
    RAISE EXCEPTION 'Este retorno foi alterado por % enquanto você editava. Recarregue e tente novamente.', public._nome(r.atualizado_por)
      USING ERRCODE = 'PAV01';
  END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a nova data prevista.'; END IF;
  IF r.status IN ('realizado','dispensado','recusou') THEN RAISE EXCEPTION 'Este retorno já foi encerrado.'; END IF;
  IF p_data = r.data_prevista THEN RETURN; END IF;
  UPDATE public.retornos SET data_prevista = p_data, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_id;
  PERFORM public.registrar('retorno_previsao_alterada', 'Alterou a data prevista do ' || public._retorno_rotulo(r) || ' de '
    || public._d(r.data_prevista) || ' para ' || public._d(p_data), 'retorno', p_id, r.animal_id, NULL,
    jsonb_build_object('data_prevista', r.data_prevista), jsonb_build_object('data_prevista', p_data));
END $$;

CREATE OR REPLACE FUNCTION public.retorno_acao(p_id int, p_acao text, p jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario(); r public.retornos; n public.retornos;
  v_ativos text[] := ARRAY['aguardando_agendamento','tutor_contatado','agendado'];
  v_desc text; v_acao_hist text; v_data date; v_hora time; v_internado boolean;
BEGIN
  SELECT * INTO r FROM public.retornos WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Retorno não encontrado.'; END IF;
  IF p ? 'versao' AND (p->>'versao')::int <> r.versao THEN
    RAISE EXCEPTION 'Este retorno foi atualizado por % (%). Confira a situação atual antes de continuar.',
      public._nome(r.atualizado_por), public._status_nome(r.status) USING ERRCODE = 'PAV01';
  END IF;
  SELECT internado INTO v_internado FROM public.animais WHERE id = r.animal_id;
  IF r.status = 'suspenso_internacao' AND p_acao <> 'dispensar' THEN
    RAISE EXCEPTION 'Retorno suspenso enquanto o paciente está internado. Ele volta a ficar disponível após a alta.';
  END IF;

  CASE p_acao
    WHEN 'contatado' THEN
      IF NOT (r.status = ANY (ARRAY['aguardando_agendamento','tutor_contatado','nao_compareceu'])) THEN
        RAISE EXCEPTION 'Não é possível registrar contato com o retorno na situação "%".', public._status_nome(r.status);
      END IF;
      UPDATE public.retornos SET status = 'tutor_contatado', data_contato = now() WHERE id = p_id;
      v_acao_hist := 'retorno_tutor_contatado'; v_desc := 'Registrou contato com o tutor sobre o ';
    WHEN 'agendar' THEN
      v_data := nullif(p->>'data_consulta', '')::date;
      v_hora := nullif(p->>'hora_consulta', '')::time;
      IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data agendada para a consulta.'; END IF;
      IF v_data < public.hoje() THEN RAISE EXCEPTION 'A data da consulta não pode estar no passado.'; END IF;
      IF NOT (r.status = ANY (v_ativos || ARRAY['nao_compareceu'])) THEN
        RAISE EXCEPTION 'Não é possível agendar o retorno na situação "%".', public._status_nome(r.status);
      END IF;
      UPDATE public.retornos SET status = 'agendado', data_agendamento = now(), data_consulta = v_data, hora_consulta = v_hora WHERE id = p_id;
      v_acao_hist := 'retorno_agendado';
      v_desc := 'Agendou para ' || public._d(v_data) || coalesce(' às ' || to_char(v_hora, 'HH24:MI'), '') || ' o ';
    WHEN 'realizado' THEN
      v_data := coalesce(nullif(p->>'data_realizado', '')::date, public.hoje());
      IF v_data > public.hoje() THEN RAISE EXCEPTION 'A data de realização não pode ser futura.'; END IF;
      IF NOT (r.status = ANY (v_ativos || ARRAY['nao_compareceu'])) THEN
        RAISE EXCEPTION 'Não é possível registrar comparecimento na situação "%".', public._status_nome(r.status);
      END IF;
      UPDATE public.retornos SET status = 'realizado', data_realizado = v_data WHERE id = p_id;
      v_acao_hist := 'retorno_realizado'; v_desc := 'Registrou o comparecimento (' || public._d(v_data) || ') no ';
    WHEN 'nao_compareceu' THEN
      IF r.status <> 'agendado' THEN RAISE EXCEPTION 'Só é possível registrar falta em um retorno agendado.'; END IF;
      UPDATE public.retornos SET status = 'nao_compareceu' WHERE id = p_id;
      v_acao_hist := 'retorno_falta'; v_desc := 'Registrou que o tutor não compareceu ao ';
    WHEN 'recusou' THEN
      IF NOT (r.status = ANY (v_ativos || ARRAY['nao_compareceu'])) THEN
        RAISE EXCEPTION 'Não é possível registrar recusa na situação "%".', public._status_nome(r.status);
      END IF;
      UPDATE public.retornos SET status = 'recusou', motivo = public._txt(p->>'motivo') WHERE id = p_id;
      v_acao_hist := 'retorno_recusado'; v_desc := 'Registrou que o tutor recusou o ';
    WHEN 'dispensar' THEN
      IF NOT (r.status = ANY (v_ativos || ARRAY['nao_compareceu','suspenso_internacao'])) THEN
        RAISE EXCEPTION 'Não é possível dispensar o retorno na situação "%".', public._status_nome(r.status);
      END IF;
      UPDATE public.retornos SET status = 'dispensado', motivo = public._txt(p->>'motivo'), status_antes_suspensao = NULL WHERE id = p_id;
      v_acao_hist := 'retorno_dispensado'; v_desc := 'Dispensou o ';
    WHEN 'reabrir' THEN
      IF r.status = ANY (v_ativos) THEN RAISE EXCEPTION 'Este retorno já está em aberto.'; END IF;
      UPDATE public.retornos SET
        status = CASE WHEN v_internado THEN 'suspenso_internacao' ELSE 'aguardando_agendamento' END,
        status_antes_suspensao = CASE WHEN v_internado THEN 'aguardando_agendamento' END,
        data_prevista = coalesce(nullif(p->>'data_prevista', '')::date, greatest(r.data_prevista, public.hoje())),
        data_realizado = NULL, motivo = NULL WHERE id = p_id;
      v_acao_hist := 'retorno_reaberto'; v_desc := 'Reabriu o ';
    ELSE
      RAISE EXCEPTION 'Ação inválida.';
  END CASE;

  UPDATE public.retornos SET atualizado_em = now(), atualizado_por = u.id, versao = versao + 1,
         observacoes = CASE WHEN public._txt(p->>'observacoes') IS NOT NULL THEN public._txt(p->>'observacoes') ELSE observacoes END
   WHERE id = p_id RETURNING * INTO n;
  PERFORM public.registrar(v_acao_hist, v_desc || public._retorno_rotulo(r)
    || coalesce('. Motivo: ' || public._txt(p->>'motivo'), ''), 'retorno', p_id, r.animal_id, NULL,
    jsonb_build_object('status', r.status, 'data_consulta', r.data_consulta),
    jsonb_build_object('status', n.status, 'data_consulta', n.data_consulta));
END $$;

-- =====================================================================
-- RPC — INTERNAÇÃO E ALTA
-- =====================================================================
CREATE OR REPLACE FUNCTION public.internar(p_animal int, p_observacoes text DEFAULT NULL) RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis := public._exigir_usuario(); a public.animais; v_id int; r public.retornos; v_n int := 0;
BEGIN
  SELECT * INTO a FROM public.animais WHERE id = p_animal FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.'; END IF;
  IF a.internado THEN RAISE EXCEPTION 'Este paciente já está internado.' USING ERRCODE = 'PAV01'; END IF;
  INSERT INTO public.internacoes (animal_id, iniciada_por, observacoes) VALUES (p_animal, u.id, public._txt(p_observacoes)) RETURNING id INTO v_id;
  UPDATE public.animais SET internado = true, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_animal;
  PERFORM public.registrar('internacao_iniciada', 'Ativou a internação de ' || a.nome, 'internacao', v_id, p_animal, NULL,
    jsonb_build_object('internado', false), jsonb_build_object('internado', true));
  FOR r IN SELECT * FROM public.retornos WHERE animal_id = p_animal
             AND status IN ('aguardando_agendamento','tutor_contatado','agendado') FOR UPDATE LOOP
    UPDATE public.retornos SET status_antes_suspensao = r.status, status = 'suspenso_internacao',
           atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = r.id;
    PERFORM public.registrar('retorno_suspenso', 'Suspendeu o ' || public._retorno_rotulo(r) || ' (previsto para '
      || public._d(r.data_prevista) || ') por internação', 'retorno', r.id, p_animal, NULL,
      jsonb_build_object('status', r.status), jsonb_build_object('status', 'suspenso_internacao'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.dar_alta(p_animal int, p_precisa_retorno boolean, p_data_retorno date DEFAULT NULL,
  p_observacoes text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario(); a public.animais; i public.internacoes; r public.retornos;
  v_reativados int := 0; v_dispensados int := 0; v_criado int; v_at int;
BEGIN
  IF p_precisa_retorno IS NULL THEN RAISE EXCEPTION 'Informe se o paciente precisará de retorno após a alta.'; END IF;
  IF p_precisa_retorno AND p_data_retorno IS NULL THEN RAISE EXCEPTION 'Informe a data prevista do retorno após a alta.'; END IF;
  IF p_precisa_retorno AND p_data_retorno < public.hoje() THEN RAISE EXCEPTION 'A data prevista do retorno não pode estar no passado.'; END IF;
  SELECT * INTO a FROM public.animais WHERE id = p_animal FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.'; END IF;
  SELECT * INTO i FROM public.internacoes WHERE animal_id = p_animal AND alta IS NULL FOR UPDATE;
  IF i.id IS NULL OR NOT a.internado THEN RAISE EXCEPTION 'Este paciente não está internado.' USING ERRCODE = 'PAV01'; END IF;

  UPDATE public.internacoes SET alta = now(), alta_por = u.id, precisa_retorno = p_precisa_retorno,
         observacoes = coalesce(public._txt(p_observacoes), observacoes) WHERE id = i.id;
  UPDATE public.animais SET internado = false, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = p_animal;
  PERFORM public.registrar('alta_registrada', 'Registrou a alta hospitalar de ' || a.nome || ' — '
    || CASE WHEN p_precisa_retorno THEN 'precisará de retorno em ' || public._d(p_data_retorno) ELSE 'sem necessidade de retorno' END,
    'internacao', i.id, p_animal, NULL, jsonb_build_object('internado', true),
    jsonb_build_object('internado', false, 'precisa_retorno', p_precisa_retorno, 'data_retorno', p_data_retorno));

  FOR r IN SELECT * FROM public.retornos WHERE animal_id = p_animal AND status = 'suspenso_internacao' FOR UPDATE LOOP
    IF p_precisa_retorno THEN
      UPDATE public.retornos SET status = 'aguardando_agendamento', status_antes_suspensao = NULL, data_prevista = p_data_retorno,
             data_consulta = NULL, hora_consulta = NULL, atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = r.id;
      PERFORM public.registrar('retorno_reativado', 'Reativou após a alta o ' || public._retorno_rotulo(r) || ', previsto para '
        || public._d(p_data_retorno), 'retorno', r.id, p_animal, NULL,
        jsonb_build_object('status', r.status, 'data_prevista', r.data_prevista),
        jsonb_build_object('status', 'aguardando_agendamento', 'data_prevista', p_data_retorno));
      v_reativados := v_reativados + 1;
    ELSE
      UPDATE public.retornos SET status = 'dispensado', status_antes_suspensao = NULL, motivo = 'Dispensado após alta hospitalar',
             atualizado_em = now(), atualizado_por = u.id, versao = versao + 1 WHERE id = r.id;
      PERFORM public.registrar('retorno_dispensado', 'Dispensou após a alta o ' || public._retorno_rotulo(r), 'retorno', r.id, p_animal,
        NULL, jsonb_build_object('status', r.status), jsonb_build_object('status', 'dispensado', 'motivo', 'Dispensado após alta hospitalar'));
      v_dispensados := v_dispensados + 1;
    END IF;
  END LOOP;

  -- Nenhum retorno suspenso para reativar: cria um único retorno pós-alta (sem duplicar).
  IF p_precisa_retorno AND v_reativados = 0 THEN
    SELECT id INTO v_at FROM public.atendimentos WHERE animal_id = p_animal ORDER BY data_abertura DESC, id DESC LIMIT 1;
    IF v_at IS NULL THEN
      v_at := public._criar_atendimento(p_animal, (i.inicio AT TIME ZONE 'America/Sao_Paulo')::date, 'Internação', 'internacao', false, NULL);
    END IF;
    INSERT INTO public.retornos (atendimento_id, animal_id, tipo, internacao_id, data_prevista, criado_por, atualizado_por)
    VALUES (v_at, p_animal, 'pos_alta', i.id, p_data_retorno, u.id, u.id)
    ON CONFLICT DO NOTHING RETURNING id INTO v_criado;
    IF v_criado IS NOT NULL THEN
      PERFORM public.registrar('retorno_criado', 'Criou retorno pós-alta previsto para ' || public._d(p_data_retorno), 'retorno', v_criado, p_animal);
    END IF;
  END IF;
  RETURN jsonb_build_object('reativados', v_reativados, 'dispensados', v_dispensados, 'criado', v_criado);
END $$;

-- =====================================================================
-- RPC — CENTRAL DA RECEPÇÃO E RELATÓRIOS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.painel_contadores() RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE ex jsonb; rt jsonb; v_int int;
BEGIN
  PERFORM public._exigir_usuario();
  SELECT jsonb_build_object(
    'atrasados', count(*) FILTER (WHERE classificacao = 'atrasado'),
    'vence_hoje', count(*) FILTER (WHERE classificacao = 'vence_hoje'),
    'no_prazo', count(*) FILTER (WHERE classificacao = 'no_prazo'),
    'aguardando_comunicacao', count(*) FILTER (WHERE aguardando_comunicacao),
    'precisa_cobranca', count(*) FILTER (WHERE precisa_cobranca)) INTO ex
  FROM public.v_exames WHERE situacao = 'ativo' AND (recebido_em IS NULL OR comunicado_em IS NULL);
  SELECT jsonb_build_object(
    'vencidos', count(*) FILTER (WHERE classificacao = 'vencido'),
    'hoje', count(*) FILTER (WHERE classificacao = 'hoje'),
    'proximos', count(*) FILTER (WHERE classificacao = 'proximo'),
    'aguardando', count(*) FILTER (WHERE status IN ('aguardando_agendamento','tutor_contatado') AND data_prevista <= public.hoje()),
    'agendados', count(*) FILTER (WHERE status = 'agendado'),
    'exames_pendentes', count(*) FILTER (WHERE exames_pendentes > 0 AND status IN ('aguardando_agendamento','tutor_contatado','agendado','suspenso_internacao')),
    'suspensos', count(*) FILTER (WHERE status = 'suspenso_internacao')) INTO rt
  FROM public.v_retornos WHERE status IN ('aguardando_agendamento','tutor_contatado','agendado','suspenso_internacao');
  SELECT count(*) INTO v_int FROM public.animais WHERE internado;
  RETURN jsonb_build_object('exames', ex, 'retornos', rt, 'internados', v_int, 'hoje', public.hoje());
END $$;

CREATE OR REPLACE FUNCTION public.relatorio_gerencial(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public._exigir_admin();
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  WITH ex AS (
    SELECT e.*, (e.recebido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dt_rec,
      (e.recebido_em IS NOT NULL AND (e.recebido_em AT TIME ZONE 'America/Sao_Paulo')::date > e.data_prevista)
        OR (e.recebido_em IS NULL AND e.data_prevista < public.hoje()) AS atrasou
    FROM public.exames e WHERE e.situacao = 'ativo' AND e.data_realizacao BETWEEN p_inicio AND p_fim
  ), rt AS (
    SELECT r.* FROM public.retornos r WHERE r.data_prevista BETWEEN p_inicio AND p_fim
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'exames', jsonb_build_object(
      'total', (SELECT count(*) FROM ex),
      'atrasados', (SELECT count(*) FROM ex WHERE atrasou),
      'percentual_atraso', (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE atrasou) / count(*), 1) END FROM ex),
      'aguardando_laudo', (SELECT count(*) FROM ex WHERE recebido_em IS NULL),
      'aguardando_comunicacao', (SELECT count(*) FROM ex WHERE recebido_em IS NOT NULL AND comunicado_em IS NULL),
      'cobrancas', (SELECT count(*) FROM public.cobrancas c WHERE c.data_cobranca BETWEEN p_inicio AND p_fim),
      'por_laboratorio', (SELECT coalesce(jsonb_agg(x ORDER BY x.atrasados DESC, x.nome), '[]') FROM (
          SELECT l.nome, count(*) AS total, count(*) FILTER (WHERE ex.atrasou) AS atrasados,
            round(100.0 * count(*) FILTER (WHERE ex.atrasou) / count(*), 1) AS percentual_atraso,
            round(avg(public.dias_uteis_entre(ex.data_realizacao, ex.dt_rec)) FILTER (WHERE ex.recebido_em IS NOT NULL), 1) AS media_dias_uteis,
            round(avg(ex.dt_rec - ex.data_realizacao) FILTER (WHERE ex.recebido_em IS NOT NULL), 1) AS media_dias_corridos,
            (SELECT count(*) FROM public.cobrancas c JOIN public.exames e2 ON e2.id = c.exame_id
              WHERE e2.laboratorio_id = l.id AND c.data_cobranca BETWEEN p_inicio AND p_fim) AS cobrancas
          FROM ex JOIN public.laboratorios l ON l.id = ex.laboratorio_id GROUP BY l.id, l.nome) x),
      'por_tipo', (SELECT coalesce(jsonb_agg(x ORDER BY x.total DESC, x.nome), '[]') FROM (
          SELECT te.nome, count(*) AS total, count(*) FILTER (WHERE ex.atrasou) AS atrasados,
            round(avg(public.dias_uteis_entre(ex.data_realizacao, ex.dt_rec)) FILTER (WHERE ex.recebido_em IS NOT NULL), 1) AS media_dias_uteis,
            round(avg(ex.dt_rec - ex.data_realizacao) FILTER (WHERE ex.recebido_em IS NOT NULL), 1) AS media_dias_corridos
          FROM ex JOIN public.tipos_exame te ON te.id = ex.tipo_exame_id GROUP BY te.id, te.nome) x)
    ),
    'retornos', jsonb_build_object(
      'previstos', (SELECT count(*) FROM rt),
      'agendados', (SELECT count(*) FROM rt WHERE data_agendamento IS NOT NULL),
      'realizados', (SELECT count(*) FROM rt WHERE status = 'realizado'),
      'nao_agendados', (SELECT count(*) FROM rt WHERE status IN ('aguardando_agendamento','tutor_contatado')),
      'vencidos', (SELECT count(*) FROM rt WHERE status IN ('aguardando_agendamento','tutor_contatado','agendado')
                     AND (CASE WHEN status = 'agendado' THEN coalesce(data_consulta, data_prevista) ELSE data_prevista END) < public.hoje()),
      'faltas', (SELECT count(*) FROM rt WHERE status = 'nao_compareceu'),
      'recusados', (SELECT count(*) FROM rt WHERE status = 'recusou'),
      'dispensados', (SELECT count(*) FROM rt WHERE status = 'dispensado'),
      'suspensos', (SELECT count(*) FROM rt WHERE status = 'suspenso_internacao'),
      'por_tipo', (SELECT coalesce(jsonb_object_agg(tipo, n), '{}') FROM (SELECT tipo, count(*) n FROM rt GROUP BY tipo) x)
    )
  ) INTO res;
  RETURN res;
END $$;

-- =====================================================================
-- RPC — CONTA DO USUÁRIO
-- =====================================================================
-- Chamado após o login: registra o acesso e ativa contas que acabaram de definir a senha.
CREATE OR REPLACE FUNCTION public.registrar_acesso() RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis;
BEGIN
  SELECT * INTO u FROM public.perfis WHERE id = auth.uid() FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Usuário sem cadastro na Central da Recepção. Procure a gestão.' USING ERRCODE = '42501'; END IF;
  IF u.situacao = 'bloqueado' THEN RAISE EXCEPTION 'Seu acesso está bloqueado. Procure a gestão.' USING ERRCODE = '42501'; END IF;
  IF u.situacao = 'inativo' THEN RAISE EXCEPTION 'Este usuário está desativado.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('id', u.id, 'nome_completo', u.nome_completo, 'login', u.login, 'perfil', u.perfil, 'situacao', u.situacao);
END $$;

CREATE OR REPLACE FUNCTION public.confirmar_login() RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis;
BEGIN
  SELECT * INTO u FROM public.perfis WHERE id = auth.uid() AND situacao = 'ativo';
  IF u.id IS NULL THEN RETURN; END IF;
  UPDATE public.perfis SET ultimo_acesso = now() WHERE id = u.id;
  PERFORM public.registrar('login', u.nome_completo || ' entrou no sistema', 'usuario');
END $$;

-- Após definir a senha pelo link: conta "pendente" passa a "ativa".
CREATE OR REPLACE FUNCTION public.ativar_minha_conta() RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.perfis;
BEGIN
  SELECT * INTO u FROM public.perfis WHERE id = auth.uid() FOR UPDATE;
  IF u.id IS NULL OR u.situacao IN ('bloqueado','inativo') THEN
    RAISE EXCEPTION 'Este acesso não está liberado. Procure a gestão.' USING ERRCODE = '42501';
  END IF;
  IF u.situacao = 'pendente' THEN UPDATE public.perfis SET situacao = 'ativo', atualizado_em = now() WHERE id = u.id; END IF;
  UPDATE public.solicitacoes_senha SET atendida_em = coalesce(atendida_em, now()) WHERE usuario_id = u.id AND atendida_em IS NULL;
  PERFORM public.registrar('senha_definida', u.nome_completo || ' definiu a própria senha pelo link de acesso', 'usuario');
END $$;

-- "Esqueci minha senha" (sem login): registra pedido para a gestão gerar um novo link.
CREATE OR REPLACE FUNCTION public.solicitar_redefinicao(p_login text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := lower(btrim(coalesce(p_login, ''))); v_uid uuid;
BEGIN
  IF v !~ '^[a-z0-9._-]{3,40}$' THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.solicitacoes_senha WHERE atendida_em IS NULL) > 50 THEN RETURN; END IF;
  SELECT id INTO v_uid FROM public.perfis WHERE lower(login) = v;
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.solicitacoes_senha WHERE usuario_id = v_uid AND atendida_em IS NULL) THEN
    INSERT INTO public.solicitacoes_senha (login_informado, usuario_id) VALUES (v, v_uid);
    PERFORM public.registrar('senha_solicitada', 'Pedido de redefinição de senha para o login ' || v, 'usuario');
  END IF;
END $$;

-- =====================================================================
-- RPC — GESTÃO DE USUÁRIOS (parte do banco; a parte de autenticação roda na Vercel)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_criar_perfil(p_id uuid, p_nome text, p_login text, p_perfil text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE adm public.perfis := public._exigir_admin(); v_login text := lower(btrim(p_login));
BEGIN
  IF public._txt(p_nome) IS NULL OR length(btrim(p_nome)) < 2 THEN RAISE EXCEPTION 'Informe o nome completo.'; END IF;
  IF v_login !~ '^[a-z0-9._-]{3,40}$' THEN
    RAISE EXCEPTION 'Login inválido: use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado (sem espaços nem acentos).';
  END IF;
  IF p_perfil NOT IN ('admin','recepcao') THEN RAISE EXCEPTION 'Perfil inválido.'; END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE lower(login) = v_login) THEN RAISE EXCEPTION 'Este login já está em uso.' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.perfis (id, nome_completo, login, perfil, situacao, criado_por) VALUES (p_id, btrim(p_nome), v_login, p_perfil, 'pendente', adm.id);
  PERFORM public.registrar('usuario_criado', 'Criou o usuário ' || btrim(p_nome) || ' (' || v_login || ') — '
    || CASE p_perfil WHEN 'admin' THEN 'Administrador' ELSE 'Recepção' END, 'usuario', NULL, NULL, NULL, NULL,
    jsonb_build_object('nome_completo', btrim(p_nome), 'login', v_login, 'perfil', p_perfil));
END $$;

CREATE OR REPLACE FUNCTION public._garantir_outro_admin(p_id uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.perfis WHERE perfil = 'admin' AND situacao = 'ativo' AND id <> p_id) THEN
    RAISE EXCEPTION 'É preciso manter pelo menos um administrador ativo.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_alterar_usuario(p_id uuid, p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE adm public.perfis := public._exigir_admin(); o public.perfis; n public.perfis; v_sit text; v_acao text; v_diff jsonb;
BEGIN
  SELECT * INTO o FROM public.perfis WHERE id = p_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  v_sit := coalesce(public._txt(p->>'situacao'), o.situacao);
  IF v_sit NOT IN ('pendente','ativo','bloqueado','inativo') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  IF v_sit IN ('bloqueado','inativo') AND p_id = adm.id THEN RAISE EXCEPTION 'Você não pode bloquear ou desativar o próprio acesso.'; END IF;
  IF o.perfil = 'admin' AND o.situacao = 'ativo'
     AND (v_sit <> 'ativo' OR coalesce(p->>'perfil', o.perfil) <> 'admin') THEN
    PERFORM public._garantir_outro_admin(p_id);
  END IF;
  IF p ? 'perfil' AND p->>'perfil' NOT IN ('admin','recepcao') THEN RAISE EXCEPTION 'Perfil inválido.'; END IF;
  UPDATE public.perfis SET
    nome_completo = coalesce(public._txt(p->>'nome_completo'), nome_completo),
    perfil = coalesce(public._txt(p->>'perfil'), perfil),
    situacao = v_sit, atualizado_em = now()
  WHERE id = p_id RETURNING * INTO n;
  v_diff := public._diff(to_jsonb(o), to_jsonb(n), ARRAY['nome_completo','perfil','situacao']);
  IF v_diff IS NULL THEN RETURN to_jsonb(n); END IF;
  v_acao := CASE
    WHEN n.situacao = 'bloqueado' AND o.situacao <> 'bloqueado' THEN 'usuario_bloqueado'
    WHEN n.situacao = 'inativo' AND o.situacao <> 'inativo' THEN 'usuario_desativado'
    WHEN n.situacao IN ('ativo','pendente') AND o.situacao IN ('bloqueado','inativo') THEN 'usuario_reativado'
    ELSE 'usuario_alterado' END;
  PERFORM public.registrar(v_acao, CASE v_acao
      WHEN 'usuario_bloqueado' THEN 'Bloqueou o acesso de ' WHEN 'usuario_desativado' THEN 'Desativou o usuário '
      WHEN 'usuario_reativado' THEN 'Reativou o usuário ' ELSE 'Alterou o cadastro do usuário ' END || n.nome_completo,
    'usuario', NULL, NULL, NULL, v_diff->'antes', v_diff->'depois');
  RETURN to_jsonb(n);
END $$;

CREATE OR REPLACE FUNCTION public.admin_registrar_link(p_id uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE adm public.perfis := public._exigir_admin(); o public.perfis;
BEGIN
  SELECT * INTO o FROM public.perfis WHERE id = p_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  IF o.situacao IN ('inativo','bloqueado') THEN RAISE EXCEPTION 'Reative o usuário antes de gerar um link de acesso.'; END IF;
  UPDATE public.solicitacoes_senha SET atendida_em = now(), atendida_por = adm.id WHERE usuario_id = p_id AND atendida_em IS NULL;
  PERFORM public.registrar('acesso_redefinido', 'Gerou link de definição de senha para ' || o.nome_completo, 'usuario');
END $$;

-- >>> supabase/migrations/0003_seguranca.sql
-- =====================================================================
-- 0003: segurança (RLS + permissões) e tempo real
-- Regra geral: o navegador LÊ por meio das visões/tabelas (somente usuários
-- ativos) e GRAVA somente por meio das funções RPC acima. Configurações
-- podem ser gravadas diretamente, mas apenas por administradores (RLS + trigger).
-- =====================================================================

-- ---------- Permissões de tabela: começa fechando tudo
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER TABLE public.perfis             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_senha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratorios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_exame        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prazos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animais            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atendimentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internacoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retornos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico          ENABLE ROW LEVEL SECURITY;

-- ---------- Leitura: somente funcionários ativos
CREATE POLICY leitura_ativos ON public.perfis       FOR SELECT TO authenticated USING (public.is_ativo() OR id = auth.uid());
CREATE POLICY leitura_ativos ON public.laboratorios FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.tipos_exame  FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.prazos       FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.feriados     FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.configuracoes FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.tutores      FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.animais      FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.atendimentos FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.exames       FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.cobrancas    FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.internacoes  FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.retornos     FOR SELECT TO authenticated USING (public.is_ativo());
-- Histórico: operacional para todos os ativos; eventos de acesso/usuários só para administradores.
CREATE POLICY leitura_ativos ON public.historico    FOR SELECT TO authenticated
  USING (public.is_ativo() AND (public.is_admin() OR entidade IS DISTINCT FROM 'usuario'));
CREATE POLICY leitura_admin  ON public.solicitacoes_senha FOR SELECT TO authenticated USING (public.is_admin());

-- ---------- Escrita direta: somente configurações, somente administradores
CREATE POLICY escrita_admin ON public.laboratorios  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.tipos_exame   FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.prazos        FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.feriados      FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.configuracoes FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.perfis, public.laboratorios, public.tipos_exame, public.prazos, public.feriados, public.configuracoes,
  public.tutores, public.animais, public.atendimentos, public.exames, public.cobrancas, public.internacoes, public.retornos,
  public.historico, public.solicitacoes_senha TO authenticated;
GRANT SELECT ON public.v_exames, public.v_retornos, public.v_internacoes TO authenticated;
GRANT INSERT, UPDATE ON public.laboratorios, public.tipos_exame, public.prazos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feriados TO authenticated;
GRANT UPDATE ON public.configuracoes TO authenticated;
GRANT USAGE ON SEQUENCE public.laboratorios_id_seq, public.tipos_exame_id_seq, public.prazos_id_seq TO authenticated;

-- ---------- Funções liberadas para o navegador
GRANT EXECUTE ON FUNCTION
  public.hoje(), public.eh_dia_util(date), public.soma_dias_uteis(date, int), public.proximo_dia_util(date),
  public.dias_uteis_entre(date, date), public.is_ativo(), public.is_admin(),
  public.salvar_tutor(jsonb), public.salvar_animal(jsonb), public.buscar_cadastros(text),
  public.criar_atendimento(jsonb), public.cadastrar_exames(jsonb),
  public.exame_receber(int), public.exame_desfazer_recebimento(int), public.exame_comunicar(int, text),
  public.exame_desfazer_comunicacao(int), public.exame_cobrar(int), public.exame_cancelar(int, text),
  public.exame_vincular(int, int), public.exame_corrigir(int, jsonb),
  public.retorno_criar(jsonb), public.retorno_alterar_previsao(int, date, int), public.retorno_acao(int, text, jsonb),
  public.internar(int, text), public.dar_alta(int, boolean, date, text),
  public.painel_contadores(), public.relatorio_gerencial(date, date),
  public.registrar_acesso(), public.confirmar_login(), public.ativar_minha_conta(),
  public.admin_criar_perfil(uuid, text, text, text), public.admin_alterar_usuario(uuid, jsonb), public.admin_registrar_link(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_redefinicao(text) TO anon, authenticated;

-- Funções criadas no futuro não ficam abertas por padrão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------- Tempo real: toda ação gera uma linha no histórico; as telas escutam essas inserções.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'historico') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.historico;
    END IF;
  END IF;
END $$;

-- >>> supabase/migrations/0004_hoje_seguro.sql
-- "app.hoje" (data simulada) só vale em conexões diretas de teste; nunca pelas requisições do site (authenticator).
CREATE OR REPLACE FUNCTION public.hoje() RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN session_user = 'authenticator' THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ELSE coalesce(nullif(current_setting('app.hoje', true), '')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) END
$$;
GRANT EXECUTE ON FUNCTION public.hoje() TO authenticated;
